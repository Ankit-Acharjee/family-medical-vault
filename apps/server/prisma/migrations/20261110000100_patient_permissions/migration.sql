BEGIN;
CREATE TABLE fmv.access_grants (
  id UUID PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES fmv.persons(id) ON DELETE RESTRICT,
  grantee_account_id UUID NOT NULL REFERENCES fmv.app_accounts(id) ON DELETE RESTRICT,
  issuer_account_id UUID NOT NULL REFERENCES fmv.app_accounts(id) ON DELETE RESTRICT,
  actions TEXT[] NOT NULL CHECK (cardinality(actions) BETWEEN 1 AND 5 AND array_position(actions, NULL) IS NULL
    AND actions <@ ARRAY['view','upload','edit','export','manage']::TEXT[]),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('patient','category','document')),
  category_id UUID,
  document_id UUID,
  expires_at TIMESTAMPTZ(3),
  revoked_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT statement_timestamp(),
  CHECK ((scope_kind = 'patient' AND category_id IS NULL AND document_id IS NULL)
      OR (scope_kind = 'category' AND category_id IS NOT NULL AND document_id IS NULL)
      OR (scope_kind = 'document' AND document_id IS NOT NULL AND category_id IS NULL)),
  CHECK (expires_at IS NULL OR expires_at > created_at)
);
CREATE INDEX access_grants_lookup ON fmv.access_grants(patient_id, grantee_account_id);
CREATE INDEX access_grants_recipient ON fmv.access_grants(grantee_account_id);
CREATE TABLE fmv.access_events (
  id UUID PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES fmv.persons(id) ON DELETE RESTRICT,
  actor_account_id UUID NOT NULL REFERENCES fmv.app_accounts(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('grant.created','grant.revoked')),
  grant_id UUID REFERENCES fmv.access_grants(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ(3) NOT NULL DEFAULT statement_timestamp()
);
REVOKE ALL ON fmv.access_grants, fmv.access_events FROM PUBLIC;
ALTER TABLE fmv.access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.access_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE fmv.access_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.access_events FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON fmv.access_grants, fmv.access_events TO fmv_app;
GRANT UPDATE(revoked_at) ON fmv.access_grants TO fmv_app;
CREATE POLICY backend_grants_read ON fmv.access_grants FOR SELECT TO fmv_app USING (true);
CREATE POLICY backend_grants_insert ON fmv.access_grants FOR INSERT TO fmv_app WITH CHECK (true);
CREATE POLICY backend_grants_revoke ON fmv.access_grants FOR UPDATE TO fmv_app USING (true) WITH CHECK (true);
CREATE POLICY backend_access_events_read ON fmv.access_events FOR SELECT TO fmv_app USING (true);
CREATE POLICY backend_access_events_insert ON fmv.access_events FOR INSERT TO fmv_app WITH CHECK (true);
COMMIT;
