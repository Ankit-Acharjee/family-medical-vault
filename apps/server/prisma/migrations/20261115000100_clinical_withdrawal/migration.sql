BEGIN;
CREATE OR REPLACE FUNCTION fmv.clinical_items_valid(v JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item JSONB; src JSONB; f JSONB; k TEXT; names TEXT[]:=ARRAY['analyte','result','unit','reference','specimen','method','date','laboratory']; ids TEXT[]:=ARRAY[]::text[]; n INTEGER;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(v) NOT BETWEEN 0 AND 20 OR octet_length(v::text)>500000 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(v) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT item ?& ARRAY['source','fields'] OR (SELECT count(*) FROM jsonb_object_keys(item))<>2 THEN RETURN false; END IF;
  src:=item->'source';
  IF jsonb_typeof(src) IS DISTINCT FROM 'object' OR NOT src ?& ARRAY['id','page','fields','unverified','confidence'] OR (SELECT count(*) FROM jsonb_object_keys(src))<>5 OR src->'unverified' IS DISTINCT FROM 'true'::jsonb OR src->>'confidence' IS DISTINCT FROM 'unrated' THEN RETURN false; END IF;
  IF jsonb_typeof(src->'page') IS DISTINCT FROM 'number' OR (src->>'page') !~ '^[1-9][0-9]?$' THEN RETURN false; END IF;
  n:=(src->>'page')::integer;
  IF n>50 OR jsonb_typeof(src->'id') IS DISTINCT FROM 'string' OR (src->>'id') !~ ('^page-'||n||'-block-[0-9]{1,6}$') OR src->>'id'=ANY(ids) THEN RETURN false; END IF;
  ids:=array_append(ids,src->>'id');
  IF jsonb_typeof(src->'fields') IS DISTINCT FROM 'object' OR NOT (src->'fields') ?& names OR (SELECT count(*) FROM jsonb_object_keys(src->'fields'))<>8 THEN RETURN false; END IF;
  IF jsonb_typeof(item->'fields') IS DISTINCT FROM 'object' OR NOT (item->'fields') ?& names OR (SELECT count(*) FROM jsonb_object_keys(item->'fields'))<>8 THEN RETURN false; END IF;
  FOREACH k IN ARRAY names LOOP
   IF NOT fmv.clinical_value_valid(item->'fields'->k,k NOT IN ('analyte','result')) THEN RETURN false; END IF;
   f:=src->'fields'->k;
   IF f='null'::jsonb THEN IF k IN ('analyte','result') THEN RETURN false; END IF;
   ELSE
    IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR NOT f ?& ARRAY['value','excerpt'] OR (SELECT count(*) FROM jsonb_object_keys(f))<>2 OR NOT fmv.clinical_value_valid(f->'value',false) OR jsonb_typeof(f->'excerpt') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    IF char_length(f->>'excerpt')+char_length(regexp_replace(f->>'excerpt',U&'[^\+010000-\+10FFFF]','','g')) NOT BETWEEN 1 AND 240 OR strpos(f->>'excerpt',f->>'value')=0 THEN RETURN false; END IF;
   END IF;
  END LOOP;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION fmv.clinical_set_valid(active JSONB,withdrawn JSONB,kind TEXT) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE ids TEXT[]:=ARRAY[]::text[]; item JSONB; n INTEGER; w INTEGER;
BEGIN
 IF kind IS NULL OR kind NOT IN ('confirmation','withdrawal') THEN RETURN false; END IF;
 IF NOT fmv.clinical_items_valid(active) OR NOT fmv.clinical_items_valid(withdrawn) THEN RETURN false; END IF;
 n:=jsonb_array_length(active);w:=jsonb_array_length(withdrawn);
 IF n+w>20 OR NOT ((kind='confirmation' AND n>=1 AND w=0) OR (kind='withdrawal' AND w>=1)) THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(active||withdrawn) LOOP
  IF item->'source'->>'id'=ANY(ids) THEN RETURN false; END IF;
  ids:=array_append(ids,item->'source'->>'id');
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION fmv.clinical_set_valid(JSONB,JSONB,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.clinical_set_valid(JSONB,JSONB,TEXT) TO fmv_app;
ALTER TABLE fmv.document_clinical_reviews ADD COLUMN action TEXT NOT NULL DEFAULT 'confirmation', ADD COLUMN withdrawn_items JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE fmv.document_clinical_reviews ADD CONSTRAINT clinical_review_set_shape CHECK(fmv.clinical_set_valid(items,withdrawn_items,action));
CREATE OR REPLACE FUNCTION fmv.validate_clinical_review_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d RECORD; e RECORD; item JSONB; evidence JSONB; text_value TEXT; owner_id UUID; previous fmv.document_clinical_reviews%ROWTYPE; remaining JSONB; removed JSONB; ids TEXT[];
BEGIN
 SELECT state,deleted_at,sha256,extraction_lifecycle INTO d FROM fmv.documents WHERE id=NEW.document_id AND patient_id=NEW.patient_id FOR NO KEY UPDATE;
 SELECT owner_account_id INTO owner_id FROM fmv.persons WHERE id=NEW.patient_id;
 IF NOT FOUND OR d.state IS DISTINCT FROM 'ready' OR d.deleted_at IS NOT NULL OR NEW.source_sha256 IS DISTINCT FROM d.sha256 OR NEW.lifecycle_version IS DISTINCT FROM d.extraction_lifecycle OR owner_id IS DISTINCT FROM NEW.actor_account_id THEN RAISE EXCEPTION 'Invalid clinical review source' USING ERRCODE='23514'; END IF;
 IF NOT fmv.clinical_set_valid(NEW.items,NEW.withdrawn_items,NEW.action) THEN RAISE EXCEPTION 'Invalid clinical set' USING ERRCODE='23514'; END IF;
 SELECT * INTO previous FROM fmv.document_clinical_reviews WHERE document_id=NEW.document_id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>COALESCE(previous.revision,0)+1 THEN RAISE EXCEPTION 'Invalid clinical review revision' USING ERRCODE='23514'; END IF;
 IF NEW.action='withdrawal' THEN
  IF previous.revision IS NULL OR NEW.source_revision IS DISTINCT FROM previous.source_revision OR NEW.source_sha256 IS DISTINCT FROM previous.source_sha256 OR NEW.source_context IS DISTINCT FROM previous.source_context THEN RAISE EXCEPTION 'Invalid withdrawal source' USING ERRCODE='23514'; END IF;
  SELECT array_agg(value->'source'->>'id') INTO ids FROM jsonb_array_elements(NEW.withdrawn_items);
  SELECT COALESCE(jsonb_agg(value ORDER BY ordinal),'[]'::jsonb) INTO remaining FROM jsonb_array_elements(previous.items) WITH ORDINALITY p(value,ordinal) WHERE NOT (value->'source'->>'id'=ANY(ids));
  SELECT COALESCE(jsonb_agg(value ORDER BY ordinal),'[]'::jsonb) INTO removed FROM jsonb_array_elements(previous.items) WITH ORDINALITY p(value,ordinal) WHERE value->'source'->>'id'=ANY(ids);
  IF NEW.items IS DISTINCT FROM remaining OR NEW.withdrawn_items IS DISTINCT FROM removed THEN RAISE EXCEPTION 'Invalid withdrawal partition' USING ERRCODE='23514'; END IF;
  NEW.verified_at:=clock_timestamp();
  RETURN NEW;
 END IF;
 SELECT revision,source_sha256,result INTO e FROM fmv.document_extractions WHERE document_id=NEW.document_id AND patient_id=NEW.patient_id;
 IF NOT FOUND OR e.revision<>NEW.source_revision OR e.source_sha256<>NEW.source_sha256 OR NEW.source_context IS DISTINCT FROM (e.result-'pages') THEN RAISE EXCEPTION 'Invalid clinical review source' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.items) LOOP
  SELECT page->>'text' INTO text_value FROM jsonb_array_elements(e.result->'pages') page WHERE page->'page'=item->'source'->'page';
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid clinical evidence' USING ERRCODE='23514'; END IF;
  FOR evidence IN SELECT value FROM jsonb_each(item->'source'->'fields') WHERE value<>'null'::jsonb LOOP
   IF strpos(text_value,evidence->>'excerpt')=0 THEN RAISE EXCEPTION 'Invalid clinical evidence' USING ERRCODE='23514'; END IF;
  END LOOP;
 END LOOP;
 NEW.verified_at:=clock_timestamp();
 RETURN NEW;
END $$;
ALTER TABLE fmv.document_events DROP CONSTRAINT document_events_kind_check;
ALTER TABLE fmv.document_events ADD CONSTRAINT document_events_kind_check CHECK(kind IN ('document.uploaded','document.viewed','document.exported','document.renamed','document.trashed','document.restored','document.extraction_saved','document.metadata_saved','document.clinical_verified','document.clinical_withdrawn'));
COMMIT;
