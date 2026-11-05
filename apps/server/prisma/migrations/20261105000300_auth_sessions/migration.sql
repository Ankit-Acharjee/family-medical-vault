BEGIN;

CREATE TABLE fmv.auth_sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT,
  payload TEXT NOT NULL,
  expires_at TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX auth_sessions_user_id_idx ON fmv.auth_sessions(user_id);
CREATE INDEX auth_sessions_expires_at_idx ON fmv.auth_sessions(expires_at);

CREATE TABLE fmv.auth_rate_limits (
  id TEXT PRIMARY KEY,
  count INTEGER NOT NULL CHECK (count > 0),
  expires_at TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX auth_rate_limits_expires_at_idx ON fmv.auth_rate_limits(expires_at);

REVOKE ALL ON fmv.auth_sessions, fmv.auth_rate_limits FROM PUBLIC;
ALTER TABLE fmv.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.auth_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE fmv.auth_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.auth_rate_limits FORCE ROW LEVEL SECURITY;

-- Backend-only role. Never grant these policies to anon/authenticated or expose
-- the fmv schema through the Supabase Data API. No patient access is granted.
GRANT USAGE ON SCHEMA fmv TO fmv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fmv.auth_sessions, fmv.auth_rate_limits TO fmv_app;
CREATE POLICY backend_sessions ON fmv.auth_sessions TO fmv_app USING (true) WITH CHECK (true);
CREATE POLICY backend_limits ON fmv.auth_rate_limits TO fmv_app USING (true) WITH CHECK (true);

COMMIT;
