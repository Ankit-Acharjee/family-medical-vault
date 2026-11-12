# Protected document Trash and recovery — DEL-01

Approved 12 November 2026, including the explicit edit-right policy. Base: develop at 5c86cb7. The user separately approved the development migration; it was applied and verified on 12 November 2026.

## Delivered behavior
- Owner authority or a current exact-scope edit grant can move a READY original to Trash or restore it within 30 days. Upload/manage alone never permits either operation. Trash metadata additionally requires independent view or export permission for each record.
- Database-generated deletion time anchors the recovery deadline. Repeated Trash operations cannot extend it; repeated completed transitions do not duplicate events. Restore checks the database clock after acquiring the row lock and after authorization waits; the exact expiry boundary denies recovery.
- Trash/restore metadata and content-free audit events commit atomically. No file bytes, original declarations, hashes, keys, Person IDs or existing grant scopes are rewritten. No R2 operations are part of Trash or recovery.
- Active lists/search, preview/export, title editing, duplicate detection and upload replays exclude trashed originals. A private internal metadata/edit mode supports recovery without granting original-byte access. Existing caregiver grants remain visible/revocable under current manage authority; new document-scoped grants cannot be created or approved while the file is in Trash.
- Documents now has Active documents/Trash controls and explicit patient/document confirmations. Failed requests retain their confirmation for retry; denied requests clear protected state. A confirmed mutation cannot be dismissed while pending, and an unconfirmed network result releases that state after 30 seconds without claiming success or automatically resubmitting. Recovery deadlines and expired states are explicit without claiming physical purge. Focus returns to the original control or selected view after a row disappears. Already-delivered bytes cannot be recalled.
- Preview blobs remain stable through successful same-patient access revalidation, are cleared on loss of current view rights or Trash, and return keyboard focus to their trigger when closed. This avoids native PDF focus events prematurely dismissing the preview.

## Migration review
`20261112000200_document_trash` adds nullable `fmv.documents.deleted_at` with a READY-only constraint, grants runtime UPDATE only on that new column, and extends permitted audit event kinds. Existing rows remain active with null deletion times. It does not delete/copy/move objects, change identities or grants, alter provider-managed schemas, or deploy a purge job.

Read-only hosted preflight verified dedicated development project `nyjkrcznezyrgntwvpjj`, matching owner/runtime targets, verify-full TLS, UTC, restricted runtime role and checksums of nine existing migrations. Exactly the Trash migration is pending. The user then gave target-specific approval. The owner-run migration succeeded and the checked ledger now contains ten applied migrations. Private before/after digests verified unchanged Person/account identities, storage namespaces, original document metadata, object-generation manifests and access grants. Runtime UPDATE on deleted_at is enabled while original-title UPDATE and document DELETE remain denied. Existing document states are unchanged and deletion times are null. No R2 operations occurred; the updated server can now run against the migrated development schema.

## Verification and review
- Full server suite: 174 passed, including seven independent Trash API scenarios with multiple permission, deadline, retry, rollback, original-preservation, duplicate-exclusion and in-flight-read assertions.
- Final disposable PostgreSQL suite: 18 passed. Covers ten-migration fresh/repeat deployment, runtime privileges, database-relative expiry and expiry while awaiting authorization, idempotent transitions, audit/authorization rollback, read/rename/restore locking, immutable originals and grant visibility/revocation while trashed.
- Row locking uses `FOR NO KEY UPDATE`, serializing document operations without blocking the separate durable manifest transaction's foreign-key checks. A stronger initial lock exposed a self-blocking reservation path in the native suite and was corrected. See PostgreSQL's [row-lock compatibility reference](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS).
- Final combined Chrome browser suite: 82 passed; two existing redundant mobile visual cases skipped. Includes Trash, title editing/search, document access, uploads, duplicate warnings, stale contexts, 320/390/1440px layouts, both themes and axe. A stalled-mutation test verifies a bounded 30-second unknown-result state, no false success and explicit safe retry. Repeated desktop/mobile preview-to-confirmation keyboard checks also passed after resolving a close-focus race.
- Persistent actual-browser screenshots: `.local/screenshots/document-trash-{light,dark}-{320,390,1440}-{desktop,mobile}.png` for Trash, with `-move-`/`-restore-` confirmation variants. Images were inspected for readable patient attribution, wrapping and clipping; modal captures use the actual viewport. API mocks and local PostgreSQL establish implementation behavior, not live hosted application verification.
- Build/typecheck, scoped ESLint, formatting, diff checks and secret detection passed. No Docker or dependencies were added.

## Delegation
OpenCode `glm-5.3-flash-free` generated only the bounded view-switcher, confirmation and row presentation from a synthetic interface brief inside an OS sandbox blocking project/home data. The supervisor reviewed and integrated the artifact, adapted local Button treatments and owns all authorization/schema/lifecycle logic. Native GPT-6.1 Sol workers independently prepared API, database and actual-App browser tests before reaching a usage limit; the supervisor completed integration, ran the tests, corrected invalid test assumptions and reviewed the combined result. No worker received secrets, provider connections or real medical records.

## Limits
Physical purge, legal exceptions, separately protected deletion evidence/backup reconciliation and production retention operations remain DEL-02/DEL-03 work. This development feature does not claim those milestones. No new sharing, OCR, clinical features or permanent-delete controls were added.

## Changed files

- `.tasks/document-trash-plan.md`
- `.tasks/document-trash-report.md`
- `apps/server/prisma/migrations/20261112000200_document_trash/migration.sql`
- `apps/server/prisma/schema.prisma`
- `apps/server/src/access/access.store.ts`
- `apps/server/src/access/caregiver.service.ts`
- `apps/server/src/access/permission.service.ts`
- `apps/server/src/auth/auth.module.ts`
- `apps/server/src/documents/document.store.ts`
- `apps/server/src/documents/documents.controller.ts`
- `apps/server/src/documents/documents.service.ts`
- `apps/server/src/documents/intake.ts`
- `apps/server/test/document-trash.test.mjs`
- `apps/server/test/integration/database.test.mjs`
- `apps/server/test/support/document-fixture.mjs`
- `apps/web/e2e/document-trash.spec.ts`
- `apps/web/src/features/documents/DocumentTrashPresentation.tsx`
- `apps/web/src/features/documents/index.tsx`
- `docs/operations/r2-development.md`
- `docs/security/access-control.md`
- `packages/contracts/src/index.ts`
