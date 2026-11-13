BEGIN;
ALTER TABLE fmv.documents ADD COLUMN extraction_lifecycle INTEGER NOT NULL DEFAULT 0 CHECK (extraction_lifecycle >= 0);
CREATE FUNCTION fmv.bump_extraction_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
  NEW.extraction_lifecycle := OLD.extraction_lifecycle + 1;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.bump_extraction_lifecycle() FROM PUBLIC;
CREATE TRIGGER documents_extraction_lifecycle BEFORE UPDATE OF deleted_at ON fmv.documents FOR EACH ROW EXECUTE FUNCTION fmv.bump_extraction_lifecycle();

CREATE FUNCTION fmv.extraction_result_valid(v JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item JSONB; m TEXT; reason TEXT; t TEXT; n INTEGER; previous INTEGER := 0; total INTEGER := 0; has_text BOOLEAN := false; is_partial BOOLEAN;
BEGIN
 IF jsonb_typeof(v) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(v)) <> 6 OR NOT v ?& ARRAY['method','engineVersion','pages','partial','partialReason','downsized'] THEN RETURN false; END IF;
 m := v->>'method'; reason := v->>'partialReason';
 IF m NOT IN ('pdf-text','image-ocr','pdf-page-ocr') OR m IS NULL THEN RETURN false; END IF;
 IF v->>'engineVersion' IS DISTINCT FROM (CASE m WHEN 'pdf-text' THEN 'pdfjs-6.5.438' WHEN 'image-ocr' THEN 'tesseract-7.0.0+eng-1.0.0' ELSE 'pdfjs-6.5.438+tesseract-7.0.0+eng-1.0.0' END) THEN RETURN false; END IF;
 IF jsonb_typeof(v->'partial') <> 'boolean' OR jsonb_typeof(v->'downsized') <> 'boolean' OR jsonb_typeof(v->'pages') <> 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(v->'pages') NOT BETWEEN 1 AND 50 OR octet_length(v::text) > 3100000 THEN RETURN false; END IF;
 is_partial := (v->>'partial')::boolean;
 IF is_partial <> (reason IS NOT NULL) THEN RETURN false; END IF;
 IF m='pdf-text' THEN
  IF (v->>'downsized')::boolean OR (reason IS NOT NULL AND reason NOT IN ('pages','characters')) OR (reason='pages' AND jsonb_array_length(v->'pages')<>50) THEN RETURN false; END IF;
 ELSE
  IF jsonb_array_length(v->'pages')<>1 THEN RETURN false; END IF;
  IF m='image-ocr' AND reason IS NOT NULL AND reason<>'characters' THEN RETURN false; END IF;
  IF m='pdf-page-ocr' AND (NOT is_partial OR reason NOT IN ('selected-page','characters')) THEN RETURN false; END IF;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(v->'pages') LOOP
  IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>2 OR NOT item ?& ARRAY['page','text'] THEN RETURN false; END IF;
  IF jsonb_typeof(item->'page')<>'number' OR (item->>'page') !~ '^[1-9][0-9]?$' OR jsonb_typeof(item->'text')<>'string' THEN RETURN false; END IF;
  n := (item->>'page')::integer; t := item->>'text';
  IF n>50 OR n<=previous OR (m='pdf-text' AND n<>previous+1) OR (m='image-ocr' AND n<>1) THEN RETURN false; END IF;
  previous := n;
  -- PostgreSQL counts code points; include supplementary characters a second
  -- time to enforce the same UTF-16 bound as the browser/contract validator.
  total := total + char_length(t) + char_length(regexp_replace(t,U&'[^\+010000-\+10FFFF]','','g'));
  IF total > (CASE WHEN m='pdf-text' THEN 500000 ELSE 100000 END) THEN RETURN false; END IF;
  has_text := has_text OR t ~ '[^[:space:]]';
 END LOOP;
 RETURN has_text;
END $$;
REVOKE ALL ON FUNCTION fmv.extraction_result_valid(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.extraction_result_valid(JSONB) TO fmv_app;

CREATE TABLE fmv.document_extractions (
 document_id UUID PRIMARY KEY,
 patient_id UUID NOT NULL,
 source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
 lifecycle_version INTEGER NOT NULL CHECK (lifecycle_version>=0),
 revision INTEGER NOT NULL CHECK (revision>0),
 request_id UUID NOT NULL,
 payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
 actor_account_id UUID NOT NULL REFERENCES fmv.app_accounts(id) ON DELETE RESTRICT,
 result JSONB NOT NULL CHECK (fmv.extraction_result_valid(result)),
 saved_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT document_extractions_source FOREIGN KEY(patient_id,document_id) REFERENCES fmv.documents(patient_id,id) ON DELETE CASCADE,
 UNIQUE(patient_id,document_id)
);
CREATE FUNCTION fmv.validate_extraction_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d RECORD;
BEGIN
 SELECT state,deleted_at,mime_type,sha256,extraction_lifecycle INTO d FROM fmv.documents WHERE id=NEW.document_id AND patient_id=NEW.patient_id FOR NO KEY UPDATE;
 IF NOT FOUND OR d.state<>'ready' OR d.deleted_at IS NOT NULL OR NEW.source_sha256<>d.sha256 OR NEW.lifecycle_version<>d.extraction_lifecycle OR ((NEW.result->>'method'='image-ocr') = (d.mime_type='application/pdf')) THEN
  RAISE EXCEPTION 'Invalid extraction source' USING ERRCODE='23514';
 END IF;
 IF (TG_OP='INSERT' AND NEW.revision<>1) OR (TG_OP='UPDATE' AND NEW.revision<>OLD.revision+1) THEN
  RAISE EXCEPTION 'Invalid extraction revision' USING ERRCODE='23514';
 END IF;
 NEW.saved_at := clock_timestamp();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.validate_extraction_source() FROM PUBLIC;
CREATE TRIGGER document_extractions_source_guard BEFORE INSERT OR UPDATE ON fmv.document_extractions FOR EACH ROW EXECUTE FUNCTION fmv.validate_extraction_source();
ALTER TABLE fmv.document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.document_extractions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fmv.document_extractions FROM PUBLIC;
GRANT SELECT,INSERT ON fmv.document_extractions TO fmv_app;
GRANT UPDATE(source_sha256,lifecycle_version,revision,request_id,payload_hash,actor_account_id,result) ON fmv.document_extractions TO fmv_app;
CREATE POLICY backend_extractions_read ON fmv.document_extractions FOR SELECT TO fmv_app USING (true);
CREATE POLICY backend_extractions_insert ON fmv.document_extractions FOR INSERT TO fmv_app WITH CHECK (true);
CREATE POLICY backend_extractions_update ON fmv.document_extractions FOR UPDATE TO fmv_app USING (true) WITH CHECK (true);
ALTER TABLE fmv.document_events DROP CONSTRAINT document_events_kind_check;
ALTER TABLE fmv.document_events ADD CONSTRAINT document_events_kind_check CHECK(kind IN ('document.uploaded','document.viewed','document.exported','document.renamed','document.trashed','document.restored','document.extraction_saved'));
COMMIT;
