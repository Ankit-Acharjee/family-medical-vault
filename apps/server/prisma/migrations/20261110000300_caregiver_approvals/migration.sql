BEGIN;
ALTER TABLE fmv.access_grants ADD CONSTRAINT access_grants_patient_identity UNIQUE(patient_id,id);
CREATE TABLE fmv.access_grant_dependencies (
 patient_id UUID NOT NULL,
 grant_id UUID NOT NULL,
 parent_grant_id UUID NOT NULL,
 PRIMARY KEY(grant_id,parent_grant_id),
 CHECK(grant_id<>parent_grant_id),
 FOREIGN KEY(patient_id,grant_id) REFERENCES fmv.access_grants(patient_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(patient_id,parent_grant_id) REFERENCES fmv.access_grants(patient_id,id) ON DELETE RESTRICT
);
ALTER TABLE fmv.access_grant_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.access_grant_dependencies FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fmv.access_grant_dependencies FROM PUBLIC;
GRANT SELECT,INSERT ON fmv.access_grant_dependencies TO fmv_app;
CREATE POLICY backend_dependencies_read ON fmv.access_grant_dependencies FOR SELECT TO fmv_app USING (true);
CREATE POLICY backend_dependencies_insert ON fmv.access_grant_dependencies FOR INSERT TO fmv_app WITH CHECK(true);
CREATE TABLE fmv.access_invitations (
 id UUID PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 kind TEXT NOT NULL CHECK (kind IN ('invitation','request')),
 patient_id UUID REFERENCES fmv.persons(id) ON DELETE RESTRICT,
 issuer_account_id UUID NOT NULL REFERENCES fmv.app_accounts(id) ON DELETE RESTRICT,
 recipient_account_id UUID REFERENCES fmv.app_accounts(id) ON DELETE RESTRICT,
 actions TEXT[] NOT NULL CHECK (cardinality(actions) BETWEEN 1 AND 5 AND array_position(actions,NULL) IS NULL AND actions <@ ARRAY['view','upload','edit','export','manage']::TEXT[]),
 scope_kind TEXT NOT NULL CHECK (scope_kind IN ('patient','category','document')),
 -- Requests carry untrusted desired resource IDs. Resolve them only during
 -- authorized approval; a foreign-key oracle would reveal private existence.
 category_id UUID,
 document_id UUID,
 state TEXT NOT NULL CHECK (state IN ('pending','claimed','accepted','revoked')),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT statement_timestamp(),
 expires_at TIMESTAMPTZ(3) NOT NULL CHECK (expires_at>created_at),
 CHECK ((kind='invitation' AND patient_id IS NOT NULL) OR (kind='request' AND recipient_account_id=issuer_account_id)),
 CHECK ((scope_kind='patient' AND category_id IS NULL AND document_id IS NULL) OR (scope_kind='category' AND category_id IS NOT NULL AND document_id IS NULL) OR (scope_kind='document' AND document_id IS NOT NULL AND category_id IS NULL))
);
CREATE INDEX access_invitations_patient ON fmv.access_invitations(patient_id);
ALTER TABLE fmv.access_events DROP CONSTRAINT access_events_kind_check;
ALTER TABLE fmv.access_events ADD CONSTRAINT access_events_kind_check CHECK (kind IN ('grant.created','grant.revoked','invitation.created','invitation.claimed','invitation.revoked','request.created'));
ALTER TABLE fmv.access_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.access_invitations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fmv.access_invitations FROM PUBLIC;
GRANT SELECT,INSERT ON fmv.access_invitations TO fmv_app;
GRANT UPDATE(state,recipient_account_id,patient_id) ON fmv.access_invitations TO fmv_app;
CREATE POLICY backend_invitations_read ON fmv.access_invitations FOR SELECT TO fmv_app USING (true);
CREATE POLICY backend_invitations_insert ON fmv.access_invitations FOR INSERT TO fmv_app WITH CHECK (true);
CREATE POLICY backend_invitations_transition ON fmv.access_invitations FOR UPDATE TO fmv_app USING (true) WITH CHECK (true);
COMMIT;
