BEGIN;
-- Independent storage namespaces reveal neither names nor permanent Person IDs.
-- Existing object keys and bytes are intentionally left untouched.
ALTER TABLE fmv.persons
 ADD COLUMN storage_namespace UUID NOT NULL DEFAULT gen_random_uuid(),
 ADD CONSTRAINT persons_storage_namespace_key UNIQUE(storage_namespace);

CREATE FUNCTION fmv.guard_storage_namespace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.storage_namespace IS DISTINCT FROM OLD.storage_namespace THEN
  RAISE EXCEPTION 'Storage identity transition denied' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION fmv.guard_storage_namespace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.guard_storage_namespace() TO fmv_app;
CREATE TRIGGER guard_storage_namespace BEFORE UPDATE OF storage_namespace ON fmv.persons
 FOR EACH ROW EXECUTE FUNCTION fmv.guard_storage_namespace();

ALTER TABLE fmv.documents DROP CONSTRAINT documents_object_key_check;
ALTER TABLE fmv.documents ADD CONSTRAINT documents_object_key_format CHECK (
 (length(object_key)=32 AND object_key ~ '^[a-f0-9]{32}$') OR (
  length(object_key)=111 AND object_key ~ '^originals/v1/[a-f0-9]{32}/[a-f0-9]{32}/[a-f0-9]{32}$'
  AND split_part(object_key,'/',4)=replace(id::text,'-','')
 )
);
ALTER TABLE fmv.document_object_attempts DROP CONSTRAINT document_object_attempts_object_key_check;
ALTER TABLE fmv.document_object_attempts ADD CONSTRAINT object_attempt_key_format CHECK (
 (length(object_key)=32 AND object_key ~ '^[a-f0-9]{32}$') OR (
  length(object_key)=111 AND object_key ~ '^originals/v1/[a-f0-9]{32}/[a-f0-9]{32}/[a-f0-9]{32}$'
  AND split_part(object_key,'/',4)=replace(document_id::text,'-','')
 )
);
COMMIT;
