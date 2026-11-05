# P0.4 disposable PostgreSQL integration tests
User approved P0.4; Codex-native worker. Edit ONLY apps/server/test/integration/database.test.mjs.
Read AGENTS.md and apps/server/prisma/{schema.prisma,migrations/*/migration.sql}.
Use node:test/assert, pg Client, child_process.spawnSync. No installs/git/network commands/actual tests; supervisor runs inside container.
Env TEST_DATABASE_URL is migration owner; TEST_RUNTIME_URL is restricted fmv_app. Must fail closed unless both hostnames are 'postgres', database pathname '/fmv_dev', expected users fmv_owner/fmv_app.
Tests run in a fresh uniquely owned Compose project; no pre-existing data.
CLI package prisma 7.10.1. cwd apps/server. Spawn pnpm exec prisma migrate deploy with DATABASE_MIGRATION_URL from TEST_DATABASE_URL only in env (not argv). Capture stdout/stderr; on failure print generic assertion message, never captured output/env/URLs.
Verify initial migration applies, _prisma_migrations has one successfully completed row in vault, repeated deploy succeeds without adding rows.
Verify schema vault not publicly usable; current baseline has no business tables.
Verify runtime role connects and is nonsuperuser/nonbypassrls/nocreatedb/nocreaterole; attempts CREATE TABLE vault.probe and SELECT vault._prisma_migrations fail with 42501. Do not grant privileges.
Verify wrong-password connection fails (generic code28P01), cleanup connections.
Verify failed migration is transactionally safe, then resolvable/retryable. Do this ONLY in a temporary copy of prisma/migrations (node fs mkdtemp /tmp); never mutate source migrations.
Create temp prisma.config.mjs using resolved absolute prisma/config module (createRequire(import.meta.url).resolve('prisma/config') converted to file URL), schema points at actual schema, migrations points at temp copy, datasource.url env DATABASE_MIGRATION_URL.
Add temp 20261105000200_failure_probe/migration.sql BEGIN; CREATE TABLE vault.integration_probe(id integer); SELECT nonexistent_probe_function(); COMMIT; -- deliberately fails.
Run deploy --config temp, assert nonzero and no integration_probe via to_regclass. Resolve failed temp migration with migrate resolve --rolled-back 20261105000200_failure_probe --config temp; replace temp migration with valid transactional CREATE TABLE, redeploy and assert success. These are disposable test tables only.
Use try/finally cleanup tempfiles and clients; no real or medical fixtures, no credentials in logs. Tests can be one top-level sequential lifecycle test with subtests to avoid races.
Return FILES CHANGED, CHECKS, BLOCKERS, <=5 lines.
