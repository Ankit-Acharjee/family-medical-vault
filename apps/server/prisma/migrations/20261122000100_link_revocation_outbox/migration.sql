BEGIN;
-- Shadow capture only: no independent receipt or completion is asserted here.
-- Deliberately no source FKs: evidence must not disappear with source-row cleanup.
CREATE TABLE fmv.restore_ledger_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 patient_id uuid NOT NULL,
 resource_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind='link.revoked'),
 occurred_at timestamptz(3) NOT NULL CHECK(isfinite(occurred_at)),
 recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 CONSTRAINT restore_ledger_event_source UNIQUE(kind,resource_id)
);
-- This is a work-list index, NOT a gap-free sequence or proof of commit ordering.
CREATE INDEX restore_ledger_events_recorded ON fmv.restore_ledger_events(recorded_at,id);
ALTER TABLE fmv.restore_ledger_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.restore_ledger_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fmv.restore_ledger_events FROM PUBLIC,fmv_app;
GRANT SELECT ON fmv.restore_ledger_events TO fmv_app;
CREATE POLICY restore_ledger_backend_read ON fmv.restore_ledger_events FOR SELECT TO fmv_app USING(true);
-- A non-superuser/non-bypass function owner must work under FORCE RLS too.
-- Resolve actual table ownership dynamically so a no-owner restore stays portable.
CREATE POLICY restore_ledger_capture_insert ON fmv.restore_ledger_events FOR INSERT TO PUBLIC
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid='fmv.restore_ledger_events'::pg_catalog.regclass)));
-- Source revoked_at is the durable pending intent. Capture is deliberately
-- separate: evidence-store failure must never roll back a committed local denial.
CREATE FUNCTION fmv.capture_temporary_link_revocation(source_link_id uuid) RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 INSERT INTO fmv.restore_ledger_events(patient_id,resource_id,kind,occurred_at)
 SELECT patient_id,id,'link.revoked',revoked_at FROM fmv.temporary_links
 WHERE id=source_link_id AND revoked_at IS NOT NULL
 ON CONFLICT(kind,resource_id) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION fmv.capture_temporary_link_revocation(uuid) FROM PUBLIC,fmv_app;
GRANT EXECUTE ON FUNCTION fmv.capture_temporary_link_revocation(uuid) TO fmv_app;
-- The source remains FORCE RLS even for its non-bypass owner. Admit only
-- the explicitly trusted capture-function owner and only revoked intents.
CREATE POLICY temporary_link_restore_capture_read ON fmv.temporary_links FOR SELECT TO PUBLIC
 USING(revoked_at IS NOT NULL AND current_user=pg_catalog.pg_get_userbyid(
 (SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid='fmv.capture_temporary_link_revocation(uuid)'::pg_catalog.regprocedure)));
CREATE POLICY restore_ledger_capture_read ON fmv.restore_ledger_events FOR SELECT TO PUBLIC
 USING(current_user=pg_catalog.pg_get_userbyid(
 (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid='fmv.restore_ledger_events'::pg_catalog.regclass)));
-- Pending intents cannot disappear through explicit or parent-cascade DELETE.
-- No independent confirmation mechanism exists yet, so retain every revoked row.
CREATE FUNCTION fmv.preserve_temporary_link_restore_intent() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF OLD.revoked_at IS NOT NULL THEN
  RAISE EXCEPTION 'Restore protection is pending' USING ERRCODE='23514';
 END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION fmv.preserve_temporary_link_restore_intent() FROM PUBLIC,fmv_app;
CREATE TRIGGER temporary_link_restore_intent_retention BEFORE DELETE ON fmv.temporary_links
 FOR EACH ROW EXECUTE FUNCTION fmv.preserve_temporary_link_restore_intent();
-- No cleanup/retention job is enabled for source intents or captured evidence.
-- Neither source state nor this local copy constitutes independent confirmation.
COMMIT;
