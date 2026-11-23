-- Dedicated development operator only. Execute via a verified development
-- owner connection after separate hosted approval. No password/login enabled.
BEGIN;
SET LOCAL statement_timeout='5s';
SET LOCAL createrole_self_grant='';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='fmv_ledger_worker') THEN
  RAISE EXCEPTION 'Existing staging operator requires review' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='fmv_ledger_stager' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolinherit AND NOT rolreplication)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m
 WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='fmv_ledger_stager')
 OR (m.roleid=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='fmv_ledger_stager')
 AND NOT(m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
 AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)))
 OR (SELECT count(*) FROM fmv.restore_ledger_policies)<>1
 OR (SELECT count(*) FROM fmv.restore_ledger_policies WHERE enabled)<>1 THEN
  RAISE EXCEPTION 'Verified initial staging pin required' USING ERRCODE='23514';
 END IF;
 CREATE ROLE fmv_ledger_worker NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 2;
 GRANT fmv_ledger_stager TO fmv_ledger_worker WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
END $$;
COMMIT;
-- Set its password privately with psql \password; only then, under the same
-- explicit operator-activation approval, ALTER ROLE fmv_ledger_worker LOGIN.
-- Never grant staging authority to fmv_app or copy an owner URL into a job.
