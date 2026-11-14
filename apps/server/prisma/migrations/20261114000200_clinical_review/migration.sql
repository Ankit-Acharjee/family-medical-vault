BEGIN;
CREATE FUNCTION fmv.clinical_value_valid(v JSONB,nullable BOOLEAN) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN v='null'::jsonb THEN nullable WHEN jsonb_typeof(v)='string' THEN char_length(v#>>'{}')+char_length(regexp_replace(v#>>'{}',U&'[^\+010000-\+10FFFF]','','g')) BETWEEN 1 AND 120 AND (v#>>'{}') ~ U&'[^\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]' ELSE false END
$$;
REVOKE ALL ON FUNCTION fmv.clinical_value_valid(JSONB,BOOLEAN) FROM PUBLIC;
CREATE FUNCTION fmv.clinical_items_valid(v JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item JSONB; src JSONB; f JSONB; k TEXT; names TEXT[]:=ARRAY['analyte','result','unit','reference','specimen','method','date','laboratory']; ids TEXT[]:=ARRAY[]::text[]; n INTEGER;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(v) NOT BETWEEN 1 AND 20 OR octet_length(v::text)>500000 THEN RETURN false; END IF;
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
REVOKE ALL ON FUNCTION fmv.clinical_items_valid(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.clinical_value_valid(JSONB,BOOLEAN),fmv.clinical_items_valid(JSONB) TO fmv_app;
CREATE TABLE fmv.document_clinical_reviews (
 id UUID PRIMARY KEY,
 document_id UUID NOT NULL,
 patient_id UUID NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),
 source_revision INTEGER NOT NULL CHECK(source_revision>0),
 source_sha256 TEXT NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 lifecycle_version INTEGER NOT NULL CHECK(lifecycle_version>=0),
 request_id UUID NOT NULL,
 payload_hash TEXT NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 actor_account_id UUID NOT NULL REFERENCES fmv.app_accounts(id) ON DELETE RESTRICT,
 rule_version TEXT NOT NULL DEFAULT 'labeled-lab-blocks-v1' CHECK(rule_version='labeled-lab-blocks-v1'),
 source_context JSONB NOT NULL CHECK(jsonb_typeof(source_context)='object'),
 items JSONB NOT NULL CHECK(fmv.clinical_items_valid(items)),
 verified_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT clinical_review_source FOREIGN KEY(patient_id,document_id) REFERENCES fmv.documents(patient_id,id) ON DELETE CASCADE,
 UNIQUE(document_id,revision),
 UNIQUE(document_id,request_id)
);
CREATE FUNCTION fmv.validate_clinical_review_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d RECORD; e RECORD; item JSONB; evidence JSONB; text_value TEXT; owner_id UUID;
BEGIN
 SELECT state,deleted_at,sha256,extraction_lifecycle INTO d FROM fmv.documents WHERE id=NEW.document_id AND patient_id=NEW.patient_id FOR NO KEY UPDATE;
 SELECT owner_account_id INTO owner_id FROM fmv.persons WHERE id=NEW.patient_id;
 IF NOT FOUND OR d.state IS DISTINCT FROM 'ready' OR d.deleted_at IS NOT NULL OR NEW.source_sha256 IS DISTINCT FROM d.sha256 OR NEW.lifecycle_version IS DISTINCT FROM d.extraction_lifecycle OR owner_id IS DISTINCT FROM NEW.actor_account_id THEN RAISE EXCEPTION 'Invalid clinical review source' USING ERRCODE='23514'; END IF;
 SELECT revision,source_sha256,result INTO e FROM fmv.document_extractions WHERE document_id=NEW.document_id AND patient_id=NEW.patient_id;
 IF NOT FOUND OR e.revision<>NEW.source_revision OR e.source_sha256<>NEW.source_sha256 OR NEW.source_context IS DISTINCT FROM (e.result-'pages') THEN RAISE EXCEPTION 'Invalid clinical review source' USING ERRCODE='23514'; END IF;
 IF NEW.revision<>(SELECT COALESCE(max(revision),0)+1 FROM fmv.document_clinical_reviews WHERE document_id=NEW.document_id) THEN RAISE EXCEPTION 'Invalid clinical review revision' USING ERRCODE='23514'; END IF;
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
REVOKE ALL ON FUNCTION fmv.validate_clinical_review_source() FROM PUBLIC;
CREATE TRIGGER clinical_review_source_guard BEFORE INSERT ON fmv.document_clinical_reviews FOR EACH ROW EXECUTE FUNCTION fmv.validate_clinical_review_source();
ALTER TABLE fmv.document_clinical_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.document_clinical_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fmv.document_clinical_reviews FROM PUBLIC;
GRANT SELECT,INSERT ON fmv.document_clinical_reviews TO fmv_app;
CREATE POLICY backend_clinical_read ON fmv.document_clinical_reviews FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_clinical_insert ON fmv.document_clinical_reviews FOR INSERT TO fmv_app WITH CHECK(true);
ALTER TABLE fmv.document_events DROP CONSTRAINT document_events_kind_check;
ALTER TABLE fmv.document_events ADD CONSTRAINT document_events_kind_check CHECK(kind IN ('document.uploaded','document.viewed','document.exported','document.renamed','document.trashed','document.restored','document.extraction_saved','document.metadata_saved','document.clinical_verified'));
COMMIT;
