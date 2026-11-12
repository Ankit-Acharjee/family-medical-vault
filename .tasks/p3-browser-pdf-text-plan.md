# Next feature: on-demand browser PDF text extraction — first AI-01 slice

Status: approved by the user on 12 November 2026. Base: develop at 946e8d1. The secure vault baseline is implemented; live integration acceptance and production backup/purge readiness remain separate gates.
Read: AGENTS.md; docs/domains/extraction.md; docs/domains/documents.md; docs/security/access-control.md; canonical design/UX guidance.

## Scope and dependency approval
- Add an explicit on-demand Extract text action for digital PDFs that the current user may view. Use the existing authorized original-byte endpoint and run parsing locally; upload, preview, export and recovery remain independent of extraction.
- Proposed single dependency: `pdfjs-dist@6.5.438`, pinned exactly in apps/web. Mozilla's [stable release documentation](https://mozilla.github.io/pdf.js/getting_started/) and the [publisher's npm metadata](https://registry.npmjs.org/pdfjs-dist/6.5.438) identify this version. Review its license, integrity, browser compatibility and optional native canvas transitive packages before integration; no Node canvas functionality or new framework is needed for browser parsing. This plan requests approval for the dependency and its reviewed lockfile changes.
- Lazy-load the parser and self-host its worker/required static assets; no CDN, external AI, document upload to another service or background extraction by default.
- Render extracted text as plain untrusted/unverified source text grouped by page, bound to the original document identity. Do not infer diagnoses, doses, dates, lab values, verification or clinical equivalence.
- First-slice limits: at most 10 MiB for extraction, 50 pages, 500,000 output characters and a 20-second processing deadline. Clearly mark unsupported/partial/failed output; larger originals remain stored and viewable. Never silently truncate while claiming completion.
- Scans, images, encrypted/unsupported PDFs and extraction failures receive honest unavailable/retry states. OCR, password-entry workflows and automatic metadata suggestions are outside this slice.

## Privacy and lifecycle
- Current **view** permission is mandatory; edit/upload/manage or export alone does not confer permission to inspect extracted text. Keep bytes/output in session-bound memory only; no localStorage, IndexedDB, analytics, source-content logs or server persistence.
- Cancel and clear parsing/output on document/patient/session changes, denied revalidation or Trash. A late worker result cannot republish inaccessible content. Reuse existing protected preview and focus patterns without replacing the native original viewer.
- Disable PDF scripting/evaluation and unnecessary network fetches. Treat embedded instructions and malformed files as untrusted data; worker failure never changes original-document state.

## Delegation and checks
1. Supervisor freezes source/permission/cancellation/resource bounds, reviews the dependency and owns request/session integration.
2. OpenCode GLM/DeepSeek implements bounded worker-wrapper and extracted-text presentation tasks in a sanitized export. Workers never receive real records, secrets or provider sessions; independently review all output.
3. Native Codex tests/review where quota permits, with supervisor verification regardless: valid synthetic multi-page PDFs, scans/no text, corrupt/encrypted files, limits/timeouts, cancellation, late results, revoked view/export-only denial, no external requests/content logs, both themes and mobile keyboard/focus/reflow.
4. Validate build/typecheck/lint, meaningful parser/browser tests and secret detection. No Docker or hosted writes/migrations are expected. Commit and push to develop after acceptance under standing authorization.

This is a per-document browser extraction foundation, not vault-wide full-text search, persisted extraction lifecycle, OCR, fact verification, AI consent infrastructure or completion of P3. Those remain subsequent reviewed slices.
