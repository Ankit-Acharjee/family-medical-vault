BEGIN;
CREATE TABLE fmv.document_object_attempts (
 object_key TEXT PRIMARY KEY CHECK(length(object_key)=32 AND object_key ~ '^[a-f0-9]{32}$'),
 document_id UUID NOT NULL REFERENCES fmv.documents(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT statement_timestamp(),
 retired_at TIMESTAMPTZ(3),
 CONSTRAINT document_object_attempts_identity UNIQUE(document_id,object_key)
);
CREATE INDEX document_object_attempts_document ON fmv.document_object_attempts(document_id);
-- Preserve every existing key and immutable document/Person identity.
-- A schema owner need not have BYPASSRLS. This transaction-local policy is
-- created and removed before commit, so it never becomes visible to other sessions.
CREATE POLICY migration_object_backfill ON fmv.documents FOR SELECT TO CURRENT_USER USING(true);
INSERT INTO fmv.document_object_attempts(object_key,document_id,created_at)
 SELECT object_key,id,created_at FROM fmv.documents;
DROP POLICY migration_object_backfill ON fmv.documents;
ALTER TABLE fmv.documents ADD CONSTRAINT documents_current_object_fk
 FOREIGN KEY(id,object_key) REFERENCES fmv.document_object_attempts(document_id,object_key)
 ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE fmv.document_object_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.document_object_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fmv.document_object_attempts FROM PUBLIC;
GRANT SELECT,INSERT ON fmv.document_object_attempts TO fmv_app;
GRANT UPDATE(retired_at) ON fmv.document_object_attempts TO fmv_app;
GRANT UPDATE(object_key) ON fmv.documents TO fmv_app;
CREATE POLICY backend_object_attempts_read ON fmv.document_object_attempts FOR SELECT TO fmv_app USING (true);
CREATE POLICY backend_object_attempts_insert ON fmv.document_object_attempts FOR INSERT TO fmv_app WITH CHECK(true);
CREATE POLICY backend_object_attempts_retire ON fmv.document_object_attempts FOR UPDATE TO fmv_app USING (true) WITH CHECK(true);
-- Retirement is one-way even if a future backend query attempts to undo it.
CREATE FUNCTION fmv.guard_object_retirement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
  RAISE EXCEPTION 'Object generation transition denied' USING ERRCODE='23514';
 END IF;
 IF NEW.retired_at IS NOT NULL AND EXISTS(
   SELECT 1 FROM fmv.documents d WHERE d.id=NEW.document_id AND d.object_key=NEW.object_key AND d.state='ready'
 ) THEN
  RAISE EXCEPTION 'Object generation transition denied' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION fmv.guard_object_retirement() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.guard_object_retirement() TO fmv_app;
CREATE TRIGGER guard_object_retirement BEFORE UPDATE OF retired_at ON fmv.document_object_attempts
 FOR EACH ROW EXECUTE FUNCTION fmv.guard_object_retirement();
COMMIT;
