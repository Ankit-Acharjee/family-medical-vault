BEGIN;
CREATE TABLE fmv.app_accounts (
  id UUID PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  CONSTRAINT app_accounts_provider_key UNIQUE (issuer, subject)
);
CREATE TABLE fmv.persons (
  id UUID PRIMARY KEY,
  owner_account_id UUID NOT NULL UNIQUE REFERENCES fmv.app_accounts(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100 AND display_name = btrim(display_name))
);
REVOKE ALL ON fmv.app_accounts, fmv.persons FROM PUBLIC;
ALTER TABLE fmv.app_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.app_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE fmv.persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.persons FORCE ROW LEVEL SECURITY;
-- Backend-only identity mapping. Requests must resolve the current session's
-- issuer/subject server-side; no client-supplied account or Person selector.
GRANT SELECT, INSERT ON fmv.app_accounts, fmv.persons TO fmv_app;
CREATE POLICY backend_accounts_read ON fmv.app_accounts FOR SELECT TO fmv_app USING (true);
CREATE POLICY backend_accounts_insert ON fmv.app_accounts FOR INSERT TO fmv_app WITH CHECK (true);
CREATE POLICY backend_persons_read ON fmv.persons FOR SELECT TO fmv_app USING (true);
CREATE POLICY backend_persons_insert ON fmv.persons FOR INSERT TO fmv_app WITH CHECK (true);
COMMIT;
