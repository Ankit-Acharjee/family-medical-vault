BEGIN;
CREATE SCHEMA IF NOT EXISTS "vault";
REVOKE ALL ON SCHEMA "vault" FROM PUBLIC;
-- No domain tables or blanket runtime grants: P1 introduces reviewed per-table policies.
COMMIT;
