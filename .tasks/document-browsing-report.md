# Document browsing and display titles — DOC-05 / ACCESS-04/05

Approved 12 November 2026. Base: develop at 84c8cd8. Implementation is local; hosted title migration has not been applied.

## Delivered
- Documents filters the current server-authorized list by display title/original filename, existing category and inclusive local upload dates. Searches stay in component memory, never URL parameters or persistent browser storage. Existing list order is chronological; no OCR/full-text claim is made.
- Current independent edit permission controls display-title changes for READY originals. The API validates one bounded title field; update and a content-free `document.renamed` audit event commit atomically, with authorization checked again inside the transaction. Edit alone does not disclose document lists or grant view/export.
- A nullable `display_title` keeps original upload declarations, filenames, object keys, hashes, sizes and timestamps unchanged, including idempotent upload retries. Categories remain unchanged to preserve category-scoped authorization.
- The title dialog preserves its draft and keyboard focus through same-patient access revalidation, disables saving while pending, clears on lost/changed context, retains drafts after retryable failures, restores focus after close, and falls back to search when filtering removes a renamed row.
- The existing disabled global search placeholder is omitted only on Documents, where real filters replace it. Other screens and the approved Overview design are unchanged.

## Verification
- Full server suite: 145 passed. Native disposable PostgreSQL suite: 17 passed, including fresh/repeat nine-migration deployment, audit/authorization rollback, runtime column privileges, unchanged originals and idempotency.
- Final dedicated browser suite: 14 passed across Chrome desktop/mobile, including post-save focus and filter-disappearing rows. Affected upload/document/patient regressions: 37 passed, one pre-existing redundant mobile visual case skipped. Narrow filter/title-editor and desktop dialog accessibility checks passed in both themes.
- Builds/typechecks, targeted ESLint, formatting and secret detection passed. Independent native Codex review identified and verified correction of a focus-revalidation issue; no further actionable findings remained.
- Actual synthetic-fixture screenshots: `.local/screenshots/documents-browsing-{light,dark}-{320,390,1440}-{desktop,mobile}.png`. Mocked browser checks establish client behavior, not live provider integration.

## Migration review and target
`apps/server/prisma/migrations/20261112000100_document_display_titles/migration.sql` adds only nullable `fmv.documents.display_title` (bounded text), grants runtime UPDATE on that new column, and permits the `document.renamed` audit kind. It does not rewrite original metadata or stored files, modify access grants, change provider-managed schemas, or perform R2 operations.

Read-only hosted preflight verified dedicated development project `nyjkrcznezyrgntwvpjj`, matching owner/runtime targets, verify-full TLS, UTC, restricted runtime role and exact checksums of eight existing applied migrations. Exactly this ninth migration is pending. Owner credentials and real metadata remained private. Applying it needs separate target-specific authorization under the approved R2 workflow; restarting the updated server before migration would make document listing fail closed because the new column is absent.

## Delegation and limits
OpenCode `glm-5.3-flash-free` generated the bounded filter/title-form presentation artifact from a synthetic props brief within an OS sandbox denying project/home data. The supervisor reviewed and integrated it, fixed local Button API/focus details, and retained authorization/schema ownership. Native GPT-6.1 Sol independently implemented API/database/browser tests and reviewed the integrated change. No external worker received repository secrets or medical records.

This is metadata-only browsing. Server pagination, extracted full-text search, recategorization, deduplication, deletion, audit-history presentation and new clinical features are not implemented. No dependencies were added. No Docker was used.
