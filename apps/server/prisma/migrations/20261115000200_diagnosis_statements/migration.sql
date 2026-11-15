BEGIN;
CREATE FUNCTION fmv.diagnosis_statements_valid(v JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item JSONB; f JSONB; ids TEXT[]:=ARRAY[]::text[]; n INTEGER; raw TEXT;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(v)>20 OR octet_length(v::text)>50000 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(v) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT item ?& ARRAY['id','page','field','unverified','confidence'] OR (SELECT count(*) FROM jsonb_object_keys(item))<>5 OR item->'unverified' IS DISTINCT FROM 'true'::jsonb OR item->>'confidence' IS DISTINCT FROM 'unrated' THEN RETURN false; END IF;
  IF jsonb_typeof(item->'page') IS DISTINCT FROM 'number' OR (item->>'page') !~ '^[1-9][0-9]?$' THEN RETURN false; END IF;
  n:=(item->>'page')::integer;
  IF n>50 OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string' OR (item->>'id') !~ ('^page-'||n||'-diagnosis-(0|[1-9][0-9]{0,5})$') OR item->>'id'=ANY(ids) THEN RETURN false; END IF;
  ids:=array_append(ids,item->>'id'); f:=item->'field';
  IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR NOT f ?& ARRAY['value','excerpt'] OR (SELECT count(*) FROM jsonb_object_keys(f))<>2 OR NOT fmv.clinical_value_valid(f->'value',false) OR jsonb_typeof(f->'excerpt') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  raw:=f->>'excerpt';
  IF strpos(raw,E'\n')>0 OR left(raw,10)<>'Diagnosis:' OR char_length(raw)+char_length(regexp_replace(raw,U&'[^\+010000-\+10FFFF]','','g'))>240 THEN RETURN false; END IF;
  raw:=substring(raw from 11);IF left(raw,1)=' ' THEN raw:=substring(raw from 2); END IF;
  IF raw IS DISTINCT FROM f->>'value' THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION fmv.diagnosis_set_valid(active JSONB,withdrawn JSONB,kind TEXT) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item JSONB; ids TEXT[]:=ARRAY[]::text[]; n INTEGER; w INTEGER;
BEGIN
 IF kind IS NULL OR kind NOT IN ('confirmation','withdrawal') OR NOT fmv.diagnosis_statements_valid(active) OR NOT fmv.diagnosis_statements_valid(withdrawn) THEN RETURN false; END IF;
 n:=jsonb_array_length(active);w:=jsonb_array_length(withdrawn);
 IF n+w>20 OR NOT ((kind='confirmation' AND n>=1 AND w=0) OR (kind='withdrawal' AND w>=1)) THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(active||withdrawn) LOOP
  IF item->>'id'=ANY(ids) THEN RETURN false; END IF;ids:=array_append(ids,item->>'id');
 END LOOP;
 RETURN true;
END $$;
-- Exact physical line and UTF-16 source offset, including CRLF and astral characters.
CREATE FUNCTION fmv.diagnosis_statement_matches(item JSONB,text_value TEXT,drop_last BOOLEAN) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE excerpt TEXT; cursor_pos INTEGER:=1; hit INTEGER; relative_hit INTEGER; prefix TEXT; target INTEGER; units INTEGER; next_lf INTEGER; line_end INTEGER; content TEXT;
BEGIN
 IF text_value IS NULL OR NOT fmv.diagnosis_statements_valid(jsonb_build_array(item)) THEN RETURN false; END IF;
 excerpt:=item->'field'->>'excerpt';target:=split_part(item->>'id','-',4)::integer;
 -- Literal C-level search avoids walking hundreds of thousands of blank lines
 -- in PL/pgSQL; exact UTF-16 offset and full physical line are still required.
 LOOP
  relative_hit:=strpos(substring(text_value from cursor_pos),excerpt);
  IF relative_hit=0 THEN RETURN false; END IF;
  hit:=cursor_pos+relative_hit-1;prefix:=left(text_value,hit-1);
  units:=char_length(prefix)+char_length(regexp_replace(prefix,U&'[^\+010000-\+10FFFF]','','g'));
  IF units>target THEN RETURN false; END IF;
  IF units=target THEN
   IF hit>1 AND substring(text_value from hit-1 for 1)<>E'\n' THEN RETURN false; END IF;
   next_lf:=strpos(substring(text_value from hit),E'\n');
   line_end:=CASE WHEN next_lf=0 THEN char_length(text_value)+1 ELSE hit+next_lf-1 END;
   content:=substring(text_value from hit for line_end-hit);
   IF next_lf>0 AND right(content,1)=E'\r' THEN content:=left(content,char_length(content)-1); END IF;
   RETURN content=excerpt AND NOT (COALESCE(drop_last,false) AND (next_lf=0 OR line_end=char_length(text_value)));
  END IF;
  cursor_pos:=hit+1;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION fmv.diagnosis_statements_valid(JSONB),fmv.diagnosis_set_valid(JSONB,JSONB,TEXT),fmv.diagnosis_statement_matches(JSONB,TEXT,BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.diagnosis_statements_valid(JSONB),fmv.diagnosis_set_valid(JSONB,JSONB,TEXT),fmv.diagnosis_statement_matches(JSONB,TEXT,BOOLEAN) TO fmv_app;
CREATE TABLE fmv.document_diagnosis_reviews (
 id UUID PRIMARY KEY,
 document_id UUID NOT NULL,patient_id UUID NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),source_revision INTEGER NOT NULL CHECK(source_revision>0),
 source_sha256 TEXT NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),lifecycle_version INTEGER NOT NULL CHECK(lifecycle_version>=0),
 request_id UUID NOT NULL,payload_hash TEXT NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 actor_account_id UUID NOT NULL REFERENCES fmv.app_accounts(id) ON DELETE RESTRICT,
 rule_version TEXT NOT NULL DEFAULT 'explicit-diagnosis-lines-v1' CHECK(rule_version='explicit-diagnosis-lines-v1'),
 meaning TEXT NOT NULL DEFAULT 'source-statement-only' CHECK(meaning='source-statement-only'),
 source_context JSONB NOT NULL CHECK(jsonb_typeof(source_context)='object'),
 action TEXT NOT NULL CHECK(action IN ('confirmation','withdrawal')),
 statements JSONB NOT NULL,withdrawn_statements JSONB NOT NULL DEFAULT '[]'::jsonb,
 confirmed_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT diagnosis_set_shape CHECK(fmv.diagnosis_set_valid(statements,withdrawn_statements,action)),
 CONSTRAINT diagnosis_review_source FOREIGN KEY(patient_id,document_id) REFERENCES fmv.documents(patient_id,id) ON DELETE CASCADE,
 UNIQUE(document_id,revision),UNIQUE(document_id,request_id)
);
CREATE FUNCTION fmv.validate_diagnosis_review_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d RECORD; e RECORD; prev fmv.document_diagnosis_reviews%ROWTYPE; item JSONB; text_value TEXT; last_page JSONB; owner_id UUID; ids TEXT[]; kept JSONB; removed JSONB;
BEGIN
 SELECT state,deleted_at,sha256,extraction_lifecycle INTO d FROM fmv.documents WHERE id=NEW.document_id AND patient_id=NEW.patient_id FOR NO KEY UPDATE;
 SELECT owner_account_id INTO owner_id FROM fmv.persons WHERE id=NEW.patient_id;
 IF NOT FOUND OR d.state IS DISTINCT FROM 'ready' OR d.deleted_at IS NOT NULL OR NEW.source_sha256 IS DISTINCT FROM d.sha256 OR NEW.lifecycle_version IS DISTINCT FROM d.extraction_lifecycle OR owner_id IS DISTINCT FROM NEW.actor_account_id THEN RAISE EXCEPTION 'Invalid diagnosis review source' USING ERRCODE='23514'; END IF;
 IF NOT fmv.diagnosis_set_valid(NEW.statements,NEW.withdrawn_statements,NEW.action) THEN RAISE EXCEPTION 'Invalid diagnosis set' USING ERRCODE='23514'; END IF;
 SELECT * INTO prev FROM fmv.document_diagnosis_reviews WHERE document_id=NEW.document_id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>COALESCE(prev.revision,0)+1 THEN RAISE EXCEPTION 'Invalid diagnosis review revision' USING ERRCODE='23514'; END IF;
 IF NEW.action='withdrawal' THEN
  IF prev.revision IS NULL OR NEW.source_revision IS DISTINCT FROM prev.source_revision OR NEW.source_sha256 IS DISTINCT FROM prev.source_sha256 OR NEW.source_context IS DISTINCT FROM prev.source_context THEN RAISE EXCEPTION 'Invalid diagnosis withdrawal source' USING ERRCODE='23514'; END IF;
  SELECT array_agg(value->>'id') INTO ids FROM jsonb_array_elements(NEW.withdrawn_statements);
  SELECT COALESCE(jsonb_agg(value ORDER BY ordinal),'[]'::jsonb) INTO kept FROM jsonb_array_elements(prev.statements) WITH ORDINALITY p(value,ordinal) WHERE NOT (value->>'id'=ANY(ids));
  SELECT COALESCE(jsonb_agg(value ORDER BY ordinal),'[]'::jsonb) INTO removed FROM jsonb_array_elements(prev.statements) WITH ORDINALITY p(value,ordinal) WHERE value->>'id'=ANY(ids);
  IF NEW.statements IS DISTINCT FROM kept OR NEW.withdrawn_statements IS DISTINCT FROM removed THEN RAISE EXCEPTION 'Invalid diagnosis withdrawal partition' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT revision,source_sha256,result INTO e FROM fmv.document_extractions WHERE document_id=NEW.document_id AND patient_id=NEW.patient_id;
  IF NOT FOUND OR e.revision IS DISTINCT FROM NEW.source_revision OR e.source_sha256 IS DISTINCT FROM NEW.source_sha256 OR NEW.source_context IS DISTINCT FROM (e.result-'pages') THEN RAISE EXCEPTION 'Invalid diagnosis review extraction' USING ERRCODE='23514'; END IF;
  last_page:=(e.result->'pages')->-1;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.statements) LOOP
   SELECT page->>'text' INTO text_value FROM jsonb_array_elements(e.result->'pages') page WHERE page->'page'=item->'page';
   IF NOT FOUND OR NOT fmv.diagnosis_statement_matches(item,text_value,(e.result->>'partialReason'='characters') IS TRUE AND item->'page'=last_page->'page') THEN RAISE EXCEPTION 'Invalid diagnosis evidence' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 NEW.confirmed_at:=clock_timestamp();RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.validate_diagnosis_review_source() FROM PUBLIC;
CREATE TRIGGER diagnosis_review_source_guard BEFORE INSERT ON fmv.document_diagnosis_reviews FOR EACH ROW EXECUTE FUNCTION fmv.validate_diagnosis_review_source();
ALTER TABLE fmv.document_diagnosis_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.document_diagnosis_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fmv.document_diagnosis_reviews FROM PUBLIC;
GRANT SELECT,INSERT ON fmv.document_diagnosis_reviews TO fmv_app;
CREATE POLICY backend_diagnosis_read ON fmv.document_diagnosis_reviews FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_diagnosis_insert ON fmv.document_diagnosis_reviews FOR INSERT TO fmv_app WITH CHECK(true);
ALTER TABLE fmv.document_events DROP CONSTRAINT document_events_kind_check;
ALTER TABLE fmv.document_events ADD CONSTRAINT document_events_kind_check CHECK(kind IN ('document.uploaded','document.viewed','document.exported','document.renamed','document.trashed','document.restored','document.extraction_saved','document.metadata_saved','document.clinical_verified','document.clinical_withdrawn','document.diagnosis_confirmed','document.diagnosis_withdrawn'));
COMMIT;
