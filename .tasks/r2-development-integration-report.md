# Private R2 integration — local delivery, 11 November 2026

Base: develop d122a73, already pushed. This R2 increment remains uncommitted. User approved the plan and `@aws-sdk/client-s3`; version 3.1166.0 is pinned with its lockfile. No UI or API-contract changes were made; development request forwarding was corrected during live verification.

## Delivered

- Server-only R2 adapter with explicit credentials, a derived HTTPS endpoint, region auto, bounded 8-second command/stream deadlines, no mutation retries, supported MIME/25 MiB validation, bounded GET streams and sanitized failures. No public/presigned URLs, default AWS credential chain or startup provider requests. Nest shutdown cancels IO and closes the SDK client.
- Strict configuration and honest disabled/unconfigured behavior; environment examples and module wiring. Configured readiness is not a claim that credentials, bucket privacy or provider health are verified.
- Durable per-attempt object generations. Retries preserve document/upload/idempotency identity but never reuse a key. Reservations commit before PUT and irreversible retirement commits before DELETE, independently of the outer transaction. Old delayed deletes cannot erase a newer READY generation; late/failed writes retain exact-key recovery information.
- Additive `20261111000100_object_generations` migration, preserving existing keys and identities, with a deferred document/manifest ownership FK, FORCE RLS, narrow column grants and one-way retirement trigger. A temporary owner-only backfill policy is created/dropped within the migration transaction, supporting non-BYPASSRLS owners without leaving a committed access expansion.
- A gated synthetic R2 probe with an explicit target fingerprint/write flag. Exact-key recovery reservations and directory entries are fsynced before IO; immutable private journals survive uncertain outcomes. The probe never changes application database rows or accepts arbitrary object keys.
- Operator guide: [R2 development runbook](../docs/operations/r2-development.md).

## Actual verification

| Check | Result |
| --- | --- |
| Full server unit/API/SDK/tool tests | 132 passed |
| Disposable PostgreSQL lifecycle | 16 passed |
| Build and typecheck | Passed for the workspace |
| ESLint, formatting, diff checks | Passed |
| Secret detection | Passed; no scanner allowlist or gate weakening |
| Production dependency audit | No known vulnerabilities reported |

SDK transport tests exercise real SDK signing/serialization through an injected synthetic HTTP handler, with no sockets/provider writes. Cases include exact bytes, checksum compatibility settings, truncated/missing/oversized/stalled streams, late headers, aborts, cleanup and lifecycle. CLI tests use a temporary script copy with only the adapter replaced to exercise actual private journal/fsync behavior without provider IO.

Database tests include legacy READY backfill, current and immutable ownership constraints, rollback with durable reservations/retirements, delayed DELETE after retry publication, simultaneous upload-pool saturation, one-way retirement and READY-key protection. The final test executes the actual migration SQL in an isolated schema under a non-superuser/non-BYPASSRLS owner with forced RLS, proving the old row is initially invisible, backfill succeeds, the temporary policy disappears and the real migration ledger remains unchanged. Temporary PostgreSQL clusters were stopped/removed; Docker was not started.

The existing 96-browser-test baseline belongs to the preceding pushed batch. Frontend code is unchanged in this increment; those browser tests were not rerun for the server-only adapter work.

## Read-only hosted development preflight

Configured project: `nyjkrcznezyrgntwvpjj.supabase.co`.

- Owner/runtime connections match that project and database with TLS verification; both accept the UTC startup setting and report UTC.
- Runtime is `fmv_app`, with no superuser, BYPASSRLS, database/role creation, schema creation, privileged membership or application-object ownership.
- Before deployment, two migrations were applied; the Person table was absent. The user explicitly approved the five pending development migrations on 11 November 2026.
- Saved a private baseline metadata snapshot, rechecked the exact project/owner/runtime target and checksums, and applied those five migrations successfully. The hosted schema now has seven successful migrations, twelve application tables and zero Persons; no existing Person identities existed or were regenerated.
- Post-migration runtime verification passed: FORCE RLS on all twelve tables, narrow insert/select/column-update privileges, valid deferred generation ownership FK, no temporary backfill policy, and no `anon`/`authenticated` schema access.
- Preflight and post-verification probes used READ ONLY transactions and printed only sanitized metadata. Hosted DDL was executed only after explicit approval. Hosted login/profile/application-document tests remain unverified.

## Remaining gates

### Patient-selector integration correction

The user created their personal profile but the selector could not load it. A read-only backend-store check confirmed that the supplied profile was linked correctly and listed with all five owner capabilities. The defect was Vite forwarding only `/api/auth`; patient, document and caregiver requests fell through to the SPA rather than reaching Nest.

The proxy now forwards `/api` while preserving Host, Origin and cookies. A real HTTP/Vite regression reproduces the old HTML response and passes after the correction, including auth, patient, caregiver POST and binary-upload forwarding. It runs before browser tests through `test:proxy`. All twelve focused patient-context browser checks pass using an isolated server/cache; scoped lint, formatting and web typecheck also pass. The user's existing dev server was not stopped and returned stale optimizer errors in browser tests; restart `pnpm dev` and hard-refresh the browser. No session credentials, names or Person IDs were placed in diagnostics or this report.

The user confirmed a private dedicated development bucket exists and configured the four server-only settings locally. Configuration validation and private `.env` permissions passed without printing values. The target fingerprint was checked before the user-approved provider probe; no existing `.env` was changed by the agent.

The hosted migration gate is complete. The user then explicitly approved one synthetic R2 upload/read/delete roundtrip. It passed exact-byte comparison and acknowledged cleanup of only its generated test key; the private recovery journal remains retained. Application storage remains disabled (`R2_ENABLED=false`), as stated before the probe. The user can now enable it and restart development to perform the separate authenticated application flow with non-medical test data.

Retired/unreferenced manifests and uncertain probe journals are retained; automatic orphan cleanup is not implemented. Any later cleanup must use the upload lock and refuse READY/current keys. The probe's direct synthetic-key cleanup is not an application document-deletion feature. Hosted login/profile/caregiver/app-upload end-to-end verification remains separate from local mocks and the SDK transport probe. Backup/restore readiness remains required before real medical records.

## Exact changed paths

- `.env.example`
- `.tasks/r2-development-integration-plan.md`
- `.tasks/r2-development-integration-report.md`
- `.tasks/r2-generation-contract.md`
- `apps/server/.env.example`
- `apps/server/package.json`
- `apps/server/prisma/migrations/20261111000100_object_generations/migration.sql`
- `apps/server/prisma/schema.prisma`
- `apps/server/src/auth/auth.module.ts`
- `apps/server/src/documents/document.store.ts`
- `apps/server/src/documents/intake.ts`
- `apps/server/src/documents/object-store.ts`
- `apps/server/src/documents/r2-object-store.ts`
- `apps/server/src/documents/storage.config.ts`
- `apps/server/test/document-intake.test.mjs`
- `apps/server/test/integration/database.test.mjs`
- `apps/server/test/r2-object-store.test.mjs`
- `apps/server/test/r2-smoke.test.mjs`
- `apps/server/test/storage-config.test.mjs`
- `apps/server/test/storage-module.test.mjs`
- `apps/server/test/support/document-fixture.mjs`
- `apps/server/tools/r2-smoke.mjs`
- `docs/operations/r2-development.md`
- `pnpm-lock.yaml`
- `apps/web/package.json`
- `apps/web/vite.config.ts`
- `apps/web/test/api-proxy.test.mjs`
