# Next feature: document browsing and title editing

Status: APPROVED by user on 12 November 2026. Base: develop at 84c8cd8.
Requirements: P2 work package 4; metadata-only portion of DOC-05; ACCESS-04/05.

## Scope
- Add patient-scoped filename/title search, existing-category and upload-date filters to Documents, with clear/reset and useful no-results states.
- Allow display-title editing for READY documents only with current independent edit permission. Preserve original bytes, original filename, object key and upload timestamp.
- Do not change document categories in this slice: recategorization changes category-scoped access and needs its own reviewed policy.
- No clinical dates, OCR/full-text extraction, duplicate detection, deletion, new categories, new screens, Overview redesign or provider writes.

## Delegation
1. Supervisor freezes validated query/edit contracts, current-authorization checks, atomic metadata/audit writes and any narrowly necessary runtime database grants. Inspect canonical screen/interaction guidance before changes.
2. OpenCode GLM implements bounded filter/title-edit presentation in a sanitized isolated source export, following existing Documents components and tokens. No secrets, provider access, installs, Git operations or authorization implementation.
3. Native Codex independently tests API denials/validation, stale patient/session responses, save failure/retry, keyboard focus, both themes and mobile layout; review worker changes before integration.

## Acceptance
- Filters never expose documents outside the current independently authorized view/export list; upload-only users receive no document metadata.
- Title edits require edit permission and exact server-resolved patient/document context, including after revocation; edit alone does not imply view/export access.
- Empty/invalid queries, long titles, stale responses, failed saves and audit rollback are tested. No filename/clinical content appears in logs.
- Preserve preview, export, upload and patient switching. Run focused API/browser tests, typecheck/lint, disposable database checks if grants change, and secret detection.
- After review and passing verification, commit with a concise explanatory body and push to develop under standing user authorization.
- Hosted migrations/provider writes/deployment remain separately gated; present any such required action concretely before execution.
