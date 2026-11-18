BEGIN;
-- A managed Person has no login owner. Existing owned Persons and immutable IDs remain intact.
ALTER TABLE fmv.persons ALTER COLUMN owner_account_id DROP NOT NULL;
CREATE TABLE fmv.managed_profile_creations (
 patient_id uuid PRIMARY KEY REFERENCES fmv.persons(id) ON DELETE CASCADE,
 creator_account_id uuid NOT NULL REFERENCES fmv.app_accounts(id),
 request_id uuid NOT NULL,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 initial_grant_id uuid NOT NULL UNIQUE REFERENCES fmv.access_grants(id),
 created_at timestamptz(3) NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(creator_account_id,request_id)
);
CREATE FUNCTION fmv.guard_managed_creation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE account uuid; grant_row fmv.access_grants%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('managed-create:'||NEW.creator_account_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('access-patient:'||NEW.patient_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM fmv.persons WHERE owner_account_id=NEW.creator_account_id) THEN RAISE EXCEPTION 'Personal profile required' USING ERRCODE='23514'; END IF;
 SELECT owner_account_id INTO account FROM fmv.persons WHERE id=NEW.patient_id;
 IF NOT FOUND OR account IS NOT NULL THEN RAISE EXCEPTION 'Managed profile must be unowned' USING ERRCODE='23514'; END IF;
 SELECT * INTO grant_row FROM fmv.access_grants WHERE id=NEW.initial_grant_id;
 IF NOT FOUND OR grant_row.patient_id<>NEW.patient_id OR grant_row.grantee_account_id<>NEW.creator_account_id OR grant_row.issuer_account_id<>NEW.creator_account_id OR grant_row.scope_kind<>'patient' OR grant_row.category_id IS NOT NULL OR grant_row.document_id IS NOT NULL OR grant_row.expires_at IS NOT NULL OR grant_row.revoked_at IS NOT NULL OR cardinality(grant_row.actions)<>5 OR NOT(grant_row.actions @> ARRAY['view','upload','edit','export','manage']::text[]) THEN RAISE EXCEPTION 'Invalid initial caregiver grant' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.guard_managed_creation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.guard_managed_creation() TO fmv_app;
CREATE TRIGGER managed_creation_guard BEFORE INSERT ON fmv.managed_profile_creations FOR EACH ROW EXECUTE FUNCTION fmv.guard_managed_creation();
REVOKE ALL ON fmv.managed_profile_creations FROM PUBLIC,fmv_app;
GRANT SELECT ON fmv.managed_profile_creations TO fmv_app;
GRANT INSERT(patient_id,creator_account_id,request_id,payload_sha256,initial_grant_id) ON fmv.managed_profile_creations TO fmv_app;
ALTER TABLE fmv.managed_profile_creations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.managed_profile_creations FORCE ROW LEVEL SECURITY;
CREATE POLICY managed_creation_read ON fmv.managed_profile_creations FOR SELECT TO fmv_app USING(true);
CREATE POLICY managed_creation_insert ON fmv.managed_profile_creations FOR INSERT TO fmv_app WITH CHECK(true);
CREATE FUNCTION fmv.guard_unowned_person_creation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM fmv.managed_profile_creations WHERE patient_id=NEW.id) THEN RAISE EXCEPTION 'Unowned profile requires atomic caregiver creation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.guard_unowned_person_creation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.guard_unowned_person_creation() TO fmv_app;
CREATE CONSTRAINT TRIGGER unowned_person_creation_guard AFTER INSERT ON fmv.persons DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.owner_account_id IS NULL) EXECUTE FUNCTION fmv.guard_unowned_person_creation();
COMMIT;
