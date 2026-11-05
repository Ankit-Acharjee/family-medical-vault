BEGIN;
CREATE SCHEMA IF NOT EXISTS "fmv";
REVOKE ALL ON SCHEMA "fmv" FROM PUBLIC;
-- No domain tables or blanket runtime grants: P1 introduces reviewed per-table policies.
COMMIT;
