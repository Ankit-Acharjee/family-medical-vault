BEGIN;
CREATE FUNCTION fmv.metadata_suggestions_valid(v JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item JSONB; k TEXT; n INTEGER;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(v)>12 OR octet_length(v::text)>24000 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(v) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  k:=item->>'kind';
  IF k IS NULL OR k NOT IN ('type','date','provider','label') OR NOT item ?& ARRAY['kind','value','confidence','page','excerpt'] THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(item))<>(CASE WHEN k='date' THEN 6 ELSE 5 END) THEN RETURN false; END IF;
  IF k='date' AND (item->>'dateRole' IS NULL OR item->>'dateRole' NOT IN ('Report date','Collection date')) THEN RETURN false; END IF;
  IF k<>'date' AND item ? 'dateRole' THEN RETURN false; END IF;
  IF jsonb_typeof(item->'value') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'excerpt') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'confidence') IS DISTINCT FROM 'string' OR item->>'confidence' NOT IN ('explicit','tentative') THEN RETURN false; END IF;
  IF char_length(item->>'value') + char_length(regexp_replace(item->>'value',U&'[^\+010000-\+10FFFF]','','g')) NOT BETWEEN 1 AND 120 OR char_length(item->>'excerpt') + char_length(regexp_replace(item->>'excerpt',U&'[^\+010000-\+10FFFF]','','g')) NOT BETWEEN 1 AND 240 THEN RETURN false; END IF;
  IF (item->>'value') !~ U&'[^\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]' OR (item->>'excerpt') !~ U&'[^\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]' THEN RETURN false; END IF;
  IF jsonb_typeof(item->'page') IS DISTINCT FROM 'number' OR (item->>'page') !~ '^[1-9][0-9]?$' THEN RETURN false; END IF;
  n:=(item->>'page')::integer; IF n>50 THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION fmv.metadata_suggestions_valid(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.metadata_suggestions_valid(JSONB) TO fmv_app;
CREATE TABLE fmv.document_metadata_snapshots (
 document_id UUID PRIMARY KEY,
 patient_id UUID NOT NULL,
 source_revision INTEGER NOT NULL CHECK(source_revision>0),
 source_sha256 TEXT NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 lifecycle_version INTEGER NOT NULL CHECK(lifecycle_version>=0),
 revision INTEGER NOT NULL CHECK(revision>0),
 request_id UUID NOT NULL,
 payload_hash TEXT NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 actor_account_id UUID NOT NULL REFERENCES fmv.app_accounts(id) ON DELETE RESTRICT,
 rule_version TEXT NOT NULL CHECK(rule_version='explicit-lines-v1'),
 suggestions JSONB NOT NULL CHECK(fmv.metadata_suggestions_valid(suggestions)),
 saved_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT document_metadata_source FOREIGN KEY(patient_id,document_id) REFERENCES fmv.documents(patient_id,id) ON DELETE CASCADE,
 UNIQUE(patient_id,document_id)
);
CREATE FUNCTION fmv.validate_metadata_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d RECORD; e RECORD; item JSONB;
BEGIN
 SELECT state,deleted_at,sha256,extraction_lifecycle INTO d FROM fmv.documents WHERE id=NEW.document_id AND patient_id=NEW.patient_id FOR NO KEY UPDATE;
 IF NOT FOUND OR d.state<>'ready' OR d.deleted_at IS NOT NULL OR NEW.source_sha256<>d.sha256 OR NEW.lifecycle_version<>d.extraction_lifecycle THEN RAISE EXCEPTION 'Invalid metadata source' USING ERRCODE='23514'; END IF;
 SELECT revision,source_sha256,result INTO e FROM fmv.document_extractions WHERE document_id=NEW.document_id AND patient_id=NEW.patient_id;
 IF NOT FOUND OR e.revision<>NEW.source_revision OR e.source_sha256<>NEW.source_sha256 THEN RAISE EXCEPTION 'Invalid metadata source' USING ERRCODE='23514'; END IF;
 IF (TG_OP='INSERT' AND NEW.revision<>1) OR (TG_OP='UPDATE' AND NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'Invalid metadata revision' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.suggestions) LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.result->'pages') page WHERE page->'page'=item->'page' AND strpos(page->>'text',item->>'excerpt')>0 AND strpos(item->>'excerpt',item->>'value')>0) THEN RAISE EXCEPTION 'Invalid metadata evidence' USING ERRCODE='23514'; END IF;
 END LOOP;
 NEW.saved_at:=clock_timestamp();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.validate_metadata_source() FROM PUBLIC;
CREATE TRIGGER document_metadata_source_guard BEFORE INSERT OR UPDATE ON fmv.document_metadata_snapshots FOR EACH ROW EXECUTE FUNCTION fmv.validate_metadata_source();
ALTER TABLE fmv.document_metadata_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.document_metadata_snapshots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fmv.document_metadata_snapshots FROM PUBLIC;
GRANT SELECT,INSERT ON fmv.document_metadata_snapshots TO fmv_app;
GRANT UPDATE(source_revision,source_sha256,lifecycle_version,revision,request_id,payload_hash,actor_account_id,rule_version,suggestions) ON fmv.document_metadata_snapshots TO fmv_app;
CREATE POLICY backend_metadata_read ON fmv.document_metadata_snapshots FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_metadata_insert ON fmv.document_metadata_snapshots FOR INSERT TO fmv_app WITH CHECK(true);
CREATE POLICY backend_metadata_update ON fmv.document_metadata_snapshots FOR UPDATE TO fmv_app USING(true) WITH CHECK(true);
ALTER TABLE fmv.document_events DROP CONSTRAINT document_events_kind_check;
ALTER TABLE fmv.document_events ADD CONSTRAINT document_events_kind_check CHECK(kind IN ('document.uploaded','document.viewed','document.exported','document.renamed','document.trashed','document.restored','document.extraction_saved','document.metadata_saved'));
COMMIT;
