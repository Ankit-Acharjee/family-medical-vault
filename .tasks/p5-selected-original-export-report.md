# SHARE-01 — selected-original ZIP export

## Delivered behavior

Documents now offers a separate original-export dialog. The user explicitly selects permitted originals, reviews a fresh server-confirmed patient/selection/count/size, acknowledges private irreversible copies and downloads a ZIP. No document is selected automatically; derived text, summaries and unselected files are excluded. Limits: 20 files, 32 MiB combined original bytes, 34 MiB delivered archive, one active original archive per application instance. Larger selections remain individually downloadable under their existing permissions.

The API first prepares a current authorized selection, returning bounded public metadata and an opaque SHA-256 snapshot fingerprint. Download reconstructs that exact selection and rechecks permission, object identity, title, source hash, size and Trash/Restore lifecycle. It fetches originals sequentially through the existing authenticated, integrity-checked and audited document-read path, builds the ZIP outside database locks, then performs one final current snapshot/permission check. Any stale, denied, missing, corrupt, oversized or unavailable member rejects the whole archive. No partial archive is disclosed. The snapshot fingerprint is an optimistic concurrency fence, never authorization.

Original Export remains independent of View and patient-wide permissions. Native tests prove a document-scoped Export-only delegate can use this feature while a View request is denied. Existing source events record original access for export; they do not promise a complete batch or delivery to disk. No new audit semantics/schema, hosted migration, external provider or dependency was introduced.

Archive entry names use validated UUID/MIME-derived paths, not user filenames. The manifest maps paths to exact Unicode display/original titles, MIME, byte size and SHA-256. It includes patient identity but no storage keys, account IDs, extracted medical fields or unrelated records. Original bytes are unchanged. Rendering is memory-bounded, uses the installed yazl writer with stored entries and fixed paths, and writes no plaintext temporary production files or persisted/public artifact. Local browser object URLs expire after one minute. Request/session/Origin/CSRF and private no-store/nosniff/CSP/attachment headers are enforced.

The existing Radix dialog/Button/semantic themes/Lucide conventions are retained. Selection drafts survive same-context rechecks, protected content is hidden while access is pending, previews/consent reset before a newly authorized review, and removed/revoked source selections are discarded. Cancel/close/context loss abort pending delivery and ignore late responses. Recoverable failures require another review/consent, conflicts refresh the current selection, and denied sources clear sensitive dialog context. The user sees browser-download initiation rather than a fabricated disk-delivery success. Keyboard focus returns to the entry control. Overview and existing upload/search/preview/Trash flows remain intact.

## Files

- Shared contract: `packages/contracts/src/original-export.ts`, index export.
- Server: `apps/server/src/documents/original-export.service.ts`, `original-export.controller.ts`; registration in `apps/server/src/auth/auth.module.ts`.
- Reuse: `apps/server/src/archives/zip.ts`, called by existing `summaries/summary-archive.ts`; `apps/web/src/lib/private-archive.ts`, reused by existing summary download client.
- UI: `apps/web/src/features/documents/OriginalExportDialog.tsx`, `original-export-api.ts`, scoped entry/context handling in Documents `index.tsx`.
- Tests: server `original-export.test.mjs`, `support/original-export-database.mjs`, invocation from the existing medication/clinical native fixture; browser `original-export.spec.ts`.
- Task context: selected-original plan and this report. No database schema/lockfile/dependency changes.

## Validation

- Server regression **376 passed**; focused original/archive checks passed again after distinct-ID count, oversize and internal-key rejection cases were added. Independent system unzip tests verify safe archive paths, exact original bytes, UTF-8 manifest and valid ZIP structure; all content is synthetic and temporary test archives are deleted.
- Full disposable native PostgreSQL **24 passed**, with all 26 existing migrations. Cases include Export-only/no View, unauthorized/mixed/other-patient selections, stale fingerprint, rename during rendering, revocation after generation, ordinary audit failure, corrupted read bytes, per-instance concurrency saturation and pre-aborted delivery. Focused native lifecycle also passed. No Docker or hosted data changes.
- Frontend unit/proxy **66 passed**. Workspace/server/web builds and types passed. Lint, OpenAPI generation, secret detection and dependency gate passed; final formatting/diff checks passed. The previously approved exact development picomatch exception remains active until 25 November00:00UTC, with production unfiltered and no new dependency.
- Browser baseline after initial implementation: 56 existing document/summary cases passed, while 6 new cases exposed a strict preview field-count mistake. The validator was corrected; no failed build was pushed. A fresh original-only run passed all6. Final full run passed **64 browser tests**, including the 8 original-export cases across desktop/mobile plus existing document browsing, Trash and summary cases. Same-context selection retention, removal after revoked source access and confirmation reset passed.

Actual synthetic screenshots are `.local/screenshots/original-export-{desktop,mobile}-{light,dark}.png` at desktop1440×1000/mobile390×844 CSS pixels. Mobile320px cancellation/scrolling is tested separately. All four final screenshots were recaptured and visually inspected after correcting singular-file wording and tiny byte-size formatting. Existing Vite config-loader/bundle-size warnings remain; no speculative profiling/refactor or performance claim was introduced.

Supervisor implementation/review only: native worker/Astra quota remained unavailable and OpenCode stayed disabled. Existing project UI toolchain/canonical design conventions were reused; browser verification uses installed Playwright/axe. No live R2 export, hosted authenticated delivery, Safari/native OS picker/download, archival encryption or confirmed disk delivery is claimed. No separate migration approval is needed for this slice because no hosted/schema write is part of delivery.
