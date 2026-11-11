# Parallel functional delivery — 11 November 2026

Approved base: develop, 5986cab. Implementation remains uncommitted and local. No hosted migrations, provider writes, deployments or dependency additions occurred.

## Implemented slices

| Workflow | Local result | Boundary |
| --- | --- | --- |
| A — Permissions | Current-state owner/grant policy; five independent actions; patient/category/document scopes; authorized patient list; expiry and exact dependency revocation | Backend checks remain authoritative; capability hints confer no access |
| B — Original documents | Recoverable begin/content/finalize lifecycle; 25 MiB PDF/JPEG/PNG/WebP validation; SHA256 integrity; opaque object keys; retry/idempotency; chronological list, preview and explicit export; access audit writes | Production uses an unavailable object adapter until real private R2 integration is reviewed/configured; memory objects are test-only |
| C — Patient context | Functional selector; session-bound state; no patient persistence; stale-response guards; selection cleared on denied/failed refresh; Documents/upload integration | Search, trends and medications remain unavailable; no clinical fixtures in production |
| D — Caregiver access | Secure invitation/request links; inspection; claim grants nothing; explicit approval; stable Person ID confirmation; hashed one-time secrets; scoped grant/expiry checks; atomic grants, dependencies and audit; revocation | Manual link sharing only; real SMTP delivery is not claimed |

Relevant requirements: ACCESS-01 through ACCESS-06; DOC-01/02/07 and the chronological-list portion of DOC-05; SEC-02/03/05/06 boundaries. This is not blanket completion of all referenced requirements. Search/extraction, audit-history presentation and full audit-retention operations remain outside this delivered slice.

## Security/integration decisions

- Grant authority comes from current verified provider issuer/subject and database state. Recovery/unverified/revoked sessions and infrastructure roles confer no patient rights.
- View and export remain independent, including export-only listing/download without preview. Upload-only grants receive storage readiness and allowed categories, without other document metadata.
- An explicit approver issues the resulting grant. Manager-approved grants depend on the exact supporting manage/action grants; expiry cannot exceed supporting authority. Owner-approved grants are independent direct owner authority. Revocation preserves unrelated grants for the same caregiver.
- Approval requires showing exact actions, scope, expiry and the participant's permanent Person ID. Display names are not legal identity verification; confirmation through another channel remains necessary.
- Document operations recheck permission after object IO. Private object keys and reusable object-read URLs are never returned. Audit persistence fails closed before releasing bytes. Preview delivers bytes and cannot promise prevention of saving.
- Fixed runtime unknown-scope/action bypasses during independent review. Fixed misleading invitation-revoke audit events for accepted/already-revoked invitations.
- Native PostgreSQL verification exposed timezone-dependent Prisma timestamp handling. Pools now select UTC, and raw date writes use explicit ISO timestamptz values. Hosted session-pooler UTC startup support still needs verification.
- Account responses include an opaque session context ID; missing context fails closed. Patient state is destroyed when that context changes, even when email is unchanged. Business operations renew inactivity within the existing absolute lifetime; liveness probes do not.
- Access-link tokens are scrubbed from URL fragments and retained only in memory. After Google navigation, or choosing a patient for a request, reopen the original link. Opening a link never grants or claims access automatically.

## Verification evidence

| Check | Result |
| --- | --- |
| API/unit/HTTP integration | 90 passed |
| Disposable PostgreSQL lifecycle | 14 passed, with many nested assertions |
| Complete browser regressions | 96 passed across desktop/mobile using installed Chrome |
| Builds and TypeScript checks | Passed; final web build repeated after scoped responsiveness fixes |
| ESLint, Prettier, git diff checks | Passed |
| Infrastructure unit tests | 4 passed |
| Secret detection | Passed |

Database verification covered fresh deployment/repeatability, a retained P1.2 identity upgrade, unchanged Person IDs, runtime privileges/FORCE RLS, real row/advisory locks, idempotency, exact UTC timestamps, approval/claim/revocation races, split manage/action support and expiry limits, independent-grant preservation, rollback when audit insertion fails, and failed-migration resolution/retry. It used a private temporary Postgres.app cluster with generated credentials, stopped/removed in cleanup. Docker Desktop was not started.

Browser verification includes authentication/account regressions, same-email session replacement, patient switching and delayed responses, current permission denials, export-only behavior, retry with the same idempotency key, sandboxed blob preview, explicit access approval, both themes and existing accessibility checks. Added long-filename reflow checks at 320/390/430px; corrected the native file input's width without global style changes. Browser APIs/providers are mocked and do not establish live hosted integration.

Actual delegation: native GPT-6.1 Sol for intake/helpers/security tests/reviews and GPT-6.1 Terra for frontend interactions/browser tests, with supervisor-owned policy, schema, migrations and final integration. OpenCode remained paused. Independent review found and corrected concrete boundary issues before acceptance.

## Remaining gates and next step

1. Review/apply the new migrations to the dedicated development Supabase project with separate owner/runtime connections, and verify pooler UTC/TLS/privileges plus live own-profile and caregiver flows. No hosted migration was applied in this batch.
2. Implement/configure the real private R2 adapter, reviewing any SDK dependency first. Verify live original-byte upload/retry/download and provider failure behavior. Live uploads currently stay disabled honestly; synthetic adapters are not a production fallback.
3. Ordinary document events have a 90-day deadline, but a production purge schedule and separately justified critical-event retention remain open. Patient-visible audit history and a fuller denied-attempt ledger are not implemented here; status-only request logging must not be described as that feature.
4. Backup/restore readiness remains required before real medical records. Managed profiles/representative authority, search, extraction/OCR, AI, trends, medications and further visual redesign were not added.

Commit, push and hosted changes still require their separate approvals under the approved workflow. Recommended next functional work is the reviewed development migration and private R2 integration, rather than adding more clinical features onto an unverified storage boundary.

## Exact changed-file inventory

The inventory below includes the plan/report, implementation, tests, migrations and narrowly relevant documentation for this uncommitted batch.

- `.tasks/parallel-functional-delivery-plan.md`
- `.tasks/parallel-functional-delivery-report.md`
- `.tasks/workflows/caregiver-access.md`
- `.tasks/workflows/document-intake.md`
- `.tasks/workflows/frozen-contracts.md`
- `.tasks/workflows/patient-context.md`
- `.tasks/workflows/patient-permissions.md`
- `apps/server/prisma/migrations/20261110000100_patient_permissions/migration.sql`
- `apps/server/prisma/migrations/20261110000200_document_intake/migration.sql`
- `apps/server/prisma/migrations/20261110000300_caregiver_approvals/migration.sql`
- `apps/server/prisma/schema.prisma`
- `apps/server/src/access/access.store.ts`
- `apps/server/src/access/caregiver.controller.ts`
- `apps/server/src/access/caregiver.service.ts`
- `apps/server/src/access/invitation.ts`
- `apps/server/src/access/patients.controller.ts`
- `apps/server/src/access/permission.service.ts`
- `apps/server/src/app.module.ts`
- `apps/server/src/application.ts`
- `apps/server/src/auth/auth.http.ts`
- `apps/server/src/auth/auth.module.ts`
- `apps/server/src/auth/auth.service.ts`
- `apps/server/src/auth/auth.store.ts`
- `apps/server/src/documents/document.store.ts`
- `apps/server/src/documents/documents.controller.ts`
- `apps/server/src/documents/documents.service.ts`
- `apps/server/src/documents/intake.ts`
- `apps/server/src/documents/memory-object-store.ts`
- `apps/server/src/documents/object-store.ts`
- `apps/server/test/access.test.mjs`
- `apps/server/test/api.test.mjs`
- `apps/server/test/auth.test.mjs`
- `apps/server/test/caregiver.test.mjs`
- `apps/server/test/document-intake.test.mjs`
- `apps/server/test/documents.test.mjs`
- `apps/server/test/integration/database.test.mjs`
- `apps/server/test/invitation.test.mjs`
- `apps/server/test/support/access-fixture.mjs`
- `apps/server/test/support/document-fixture.mjs`
- `apps/web/e2e/account-visual.spec.ts`
- `apps/web/e2e/auth.spec.ts`
- `apps/web/e2e/document-vault.spec.ts`
- `apps/web/e2e/family-access.spec.ts`
- `apps/web/e2e/overview-polish.spec.ts`
- `apps/web/e2e/patient-context.spec.ts`
- `apps/web/e2e/person.spec.ts`
- `apps/web/e2e/shell.spec.ts`
- `apps/web/e2e/states.spec.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/features/access/incoming-link.ts`
- `apps/web/src/features/access/index.tsx`
- `apps/web/src/features/access/test-fixture.tsx`
- `apps/web/src/features/auth/AuthRoot.tsx`
- `apps/web/src/features/documents/index.tsx`
- `apps/web/src/features/documents/test-fixture.tsx`
- `apps/web/src/features/patients/index.tsx`
- `apps/web/src/features/patients/test-fixture.tsx`
- `docs/architecture/auth-sessions.md`
- `docs/security/access-control.md`
- `infra/README.md`
- `infra/scripts/test-db-native.mjs`
- `packages/contracts/src/index.ts`
