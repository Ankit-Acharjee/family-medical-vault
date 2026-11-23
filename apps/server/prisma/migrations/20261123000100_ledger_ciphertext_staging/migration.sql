BEGIN;
-- Capability only. No login, active staging membership, policy or publisher enabled.
-- Do not implicitly activate a creator's staging privileges on PG16+.
SET LOCAL createrole_self_grant='';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='fmv_ledger_stager') THEN
  CREATE ROLE fmv_ledger_stager NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='fmv_ledger_stager' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m
 WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='fmv_ledger_stager')
 OR (m.roleid=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='fmv_ledger_stager')
 AND NOT(m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
 AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option))) THEN
  RAISE EXCEPTION 'Staging role requires isolated bootstrap review' USING ERRCODE='23514';
 END IF;
END $$;
GRANT USAGE ON SCHEMA fmv TO fmv_ledger_stager;
CREATE TABLE fmv.restore_ledger_policies (
 id uuid PRIMARY KEY,
 ledger_id text NOT NULL CHECK(ledger_id ~ '^[a-f0-9]{32}$'),
 environment text NOT NULL CHECK(environment='development'),
 recipient text NOT NULL CHECK(recipient ~ '^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$'),
 recipient_sha256 text NOT NULL CHECK(recipient_sha256=encode(sha256(convert_to(recipient,'UTF8')),'hex')),
 enabled boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX restore_ledger_active_policy ON fmv.restore_ledger_policies(enabled) WHERE enabled;
CREATE TABLE fmv.restore_ledger_publications (
 event_id uuid PRIMARY KEY REFERENCES fmv.restore_ledger_events(id) ON DELETE RESTRICT,
 policy_id uuid NOT NULL REFERENCES fmv.restore_ledger_policies(id) ON DELETE RESTRICT,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 ciphertext bytea NOT NULL CHECK(octet_length(ciphertext) BETWEEN 128 AND 65536 AND position(convert_to(E'age-encryption.org/v1\n','UTF8') in ciphertext)=1),
 ciphertext_bytes integer NOT NULL CHECK(ciphertext_bytes=octet_length(ciphertext)),
 ciphertext_sha256 text NOT NULL CHECK(ciphertext_sha256=encode(sha256(ciphertext),'hex')),
 staged_at timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(staged_at))
);
ALTER TABLE fmv.restore_ledger_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.restore_ledger_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE fmv.restore_ledger_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.restore_ledger_publications FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fmv.restore_ledger_policies,fmv.restore_ledger_publications FROM PUBLIC,fmv_app,fmv_ledger_stager;
GRANT SELECT ON fmv.restore_ledger_policies,fmv.restore_ledger_publications,fmv.restore_ledger_events TO fmv_ledger_stager;
CREATE POLICY ledger_policy_stager_read ON fmv.restore_ledger_policies FOR SELECT TO fmv_ledger_stager USING(true);
CREATE POLICY ledger_publication_stager_read ON fmv.restore_ledger_publications FOR SELECT TO fmv_ledger_stager USING(true);
CREATE POLICY ledger_event_stager_read ON fmv.restore_ledger_events FOR SELECT TO fmv_ledger_stager USING(true);
CREATE POLICY ledger_policy_owner ON fmv.restore_ledger_policies FOR ALL TO PUBLIC
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid='fmv.restore_ledger_policies'::pg_catalog.regclass)))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid='fmv.restore_ledger_policies'::pg_catalog.regclass)));
CREATE POLICY ledger_publication_owner ON fmv.restore_ledger_publications FOR ALL TO PUBLIC
 USING(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid='fmv.restore_ledger_publications'::pg_catalog.regclass)))
 WITH CHECK(current_user=pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid='fmv.restore_ledger_publications'::pg_catalog.regclass)));
CREATE FUNCTION fmv.guard_ledger_staging() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND TG_RELID='fmv.restore_ledger_policies'::pg_catalog.regclass AND
    (to_jsonb(NEW)-'enabled')=(to_jsonb(OLD)-'enabled') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Immutable ledger staging history' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION fmv.guard_ledger_staging() FROM PUBLIC,fmv_app,fmv_ledger_stager;
CREATE TRIGGER ledger_policy_history BEFORE UPDATE OR DELETE ON fmv.restore_ledger_policies FOR EACH ROW EXECUTE FUNCTION fmv.guard_ledger_staging();
CREATE TRIGGER ledger_publication_history BEFORE UPDATE OR DELETE ON fmv.restore_ledger_publications FOR EACH ROW EXECUTE FUNCTION fmv.guard_ledger_staging();
-- Explicit, fixed-order UTF8 encoding. Epoch milliseconds do not depend on timezone.
CREATE FUNCTION fmv.restore_event_source_bytes(event_uuid uuid) RETURNS bytea
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT convert_to('{"eventId":'||to_json(e.id::text)::text||',"patientId":'||to_json(e.patient_id::text)::text||',"resourceId":'||to_json(e.resource_id::text)::text||',"kind":'||to_json(e.kind)::text||',"lifecycle":null,"occurredAt":'||((extract(epoch FROM e.occurred_at)*1000)::bigint)::text||'}','UTF8')
 FROM fmv.restore_ledger_events e WHERE e.id=event_uuid;
$$;
CREATE FUNCTION fmv.prepare_restore_event(event_uuid uuid, policy_uuid uuid) RETURNS bytea
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT convert_to('{"format":"fmv-restore-event-v1","environment":"development","ledgerId":'||to_json(p.ledger_id)::text||',"recipientSha256":'||to_json(p.recipient_sha256)::text||',"event":','UTF8')||fmv.restore_event_source_bytes(event_uuid)||convert_to('}','UTF8')
 FROM fmv.restore_ledger_policies p WHERE p.id=policy_uuid;
$$;
REVOKE ALL ON FUNCTION fmv.restore_event_source_bytes(uuid),fmv.prepare_restore_event(uuid,uuid) FROM PUBLIC,fmv_app;
GRANT EXECUTE ON FUNCTION fmv.restore_event_source_bytes(uuid),fmv.prepare_restore_event(uuid,uuid) TO fmv_ledger_stager;
CREATE FUNCTION fmv.stage_restore_event(event_uuid uuid, policy_uuid uuid, expected_payload_sha256 text, encrypted bytea)
 RETURNS fmv.restore_ledger_publications LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
 result fmv.restore_ledger_publications;
 policy fmv.restore_ledger_policies;
 source_bytes bytea;
 payload bytea;
 source_hash text;
BEGIN
 -- The authoritative source must exist; the FK rechecks concurrent deletion.
 PERFORM id FROM fmv.restore_ledger_events WHERE id=event_uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown ledger event' USING ERRCODE='23514'; END IF;
 source_bytes:=fmv.restore_event_source_bytes(event_uuid);
 source_hash:=encode(sha256(source_bytes),'hex');
 SELECT * INTO result FROM fmv.restore_ledger_publications WHERE event_id=event_uuid;
 IF FOUND THEN
  IF result.policy_id IS DISTINCT FROM policy_uuid OR result.payload_sha256 IS DISTINCT FROM expected_payload_sha256 OR result.source_sha256 IS DISTINCT FROM source_hash OR result.ciphertext_sha256 IS DISTINCT FROM encode(sha256(result.ciphertext),'hex') THEN
   RAISE EXCEPTION 'Ledger staging source conflict' USING ERRCODE='23514'; END IF;
  -- Retry the original pin/digest. Retrieve existing publications before
  -- preparing new ciphertext after default-recipient rotation.
  RETURN result;
 END IF;
 SELECT * INTO policy FROM fmv.restore_ledger_policies WHERE id=policy_uuid AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Inactive staging policy' USING ERRCODE='23514'; END IF;
 payload:=fmv.prepare_restore_event(event_uuid,policy_uuid);
 IF expected_payload_sha256 IS NULL OR expected_payload_sha256 IS DISTINCT FROM encode(sha256(payload),'hex') THEN
  RAISE EXCEPTION 'Stale staging payload' USING ERRCODE='23514'; END IF;
 INSERT INTO fmv.restore_ledger_publications(event_id,policy_id,source_sha256,payload_sha256,ciphertext,ciphertext_bytes,ciphertext_sha256)
 VALUES(event_uuid,policy_uuid,source_hash,expected_payload_sha256,encrypted,octet_length(encrypted),encode(sha256(encrypted),'hex'))
 ON CONFLICT(event_id) DO NOTHING;
 -- A separate statement sees the committed concurrent winner at READ COMMITTED.
 SELECT * INTO result FROM fmv.restore_ledger_publications WHERE event_id=event_uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Retry ledger staging' USING ERRCODE='40001'; END IF;
 IF result.policy_id IS DISTINCT FROM policy_uuid OR result.payload_sha256 IS DISTINCT FROM expected_payload_sha256 OR result.source_sha256 IS DISTINCT FROM source_hash THEN
  RAISE EXCEPTION 'Ledger staging source conflict' USING ERRCODE='23514'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION fmv.stage_restore_event(uuid,uuid,text,bytea) FROM PUBLIC,fmv_app;
GRANT EXECUTE ON FUNCTION fmv.stage_restore_event(uuid,uuid,text,bytea) TO fmv_ledger_stager;
COMMIT;
