# MED-01/MED-02 — owner-recorded medication reconciliation backend

## Delivered

- Separate explicit reconciliation of an owner-attested prescription source into owner-recorded current/historical context. Owner-only corrections preserve every prior revision. Literal fields/unknowns are retained without dosing, date or treatment-status inference; no schedules, reminders, inventory or prescribing behavior.
- GET `/api/patients/:patientId/medication-reconciliations`: latest records, keyset pages of 20 ordered by latest recording time/identity. GET `/:medicationId`: separate always-current record plus revision history pages of 20. PUT `/:medicationId`: explicit confirmation, exact source binding, revision CAS and semantic request idempotency.
- Reads require patient-wide View and current View of each source; owner always allowed, including retained records for Trash. Delegates see no entries for unavailable sources and document/category-only grants cannot read the list/history. Metadata pointers precede source locking/authorization and medical field loading. Final authorization after audit catches expiry during disclosure.
- Exact source/review revisions, SHA, original/extraction/review lifecycle and still-attested candidate must match for trusted use and new writes. New source review, withdrawal, replacement extraction or Trash/Restore invalidates old bindings; recorded current/historical status and immutable history remain unchanged. Re-review alone does not reconcile a record again.
- Canonical patient/resource locks serialize changes. New immutable runtime INSERT/SELECT tables use FORCE RLS, invoker guards, owner/source/revision validation and atomic value-free audit. Ordinary access events expire after 90 days; critical-event retention/cleanup remains P6.

## Files

- `packages/contracts/src/medication-reconciliation.ts`: bounded list/history/cursor validation and contradictory current/history rejection.
- `apps/server/src/medications/medication-reconciliation.{service,controller}.ts`, `apps/server/src/auth/auth.module.ts`: protected transactional endpoints and module wiring.
- `apps/server/prisma/schema.prisma`, migration `20261117000200_medication_reconciliation/migration.sql`: ledger/events, SQL field/source/transition guards and restricted grants.
- `apps/server/test/medication-reconciliation-{api,contracts}.test.mjs`, `test/support/medication-reconciliation-database.mjs`, clinical database fixture and migration/table inventory: focused and regression verification.
- Canonical medication/security domains: approved list-read policy. Task plan/report: delivery status.

## Verification and limits

351 server API/contract tests and the complete 24-test disposable PostgreSQL suite passed, applying all 22 migrations. Final focused clinical/medication database verification also passed after tightening history's authorization-before-field-load order. Coverage includes owner/delegate/document-only scope, semantic retries/CAS races, literal history, bounded pagination, forged actor/source/revision attempts, unavailable/withdrawn/restored sources, runtime UPDATE/DELETE denial, server-owned timestamps, atomic audit failure and grant expiry during audited disclosure. Workspace typecheck, server/contract build, lint, formatting and secret checks passed; OpenAPI generation checked separately.

Read-only hosted preflight passed: dedicated development project, verified TLS, UTC, restricted runtime, all 21 applied checksums and exactly migration22 pending. No hosted medical rows were read and no hosted writes occurred. Hosted migration remains separately approval-gated. No frontend or existing Overview changes in this backend slice. Corrections retain the same prescription document identity; a different prescription document starts a separate record. There is no medication removal/withdrawal feature: owners record current/historical context, while source withdrawal remains separate.

Supervisor implementation/review; native workers/Astra remain quota-limited and no OpenCode or external fallback was used. No independent unavailable-model signoff or hosted authenticated end-to-end verification is claimed. Next: source-linked Meds interface with draft/revalidation, confirmation/history and both-theme responsive/browser checks.
