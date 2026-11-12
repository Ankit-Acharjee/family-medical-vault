# Browser PDF text extraction — first AI-01 slice

Approved plan: `.tasks/p3-browser-pdf-text-plan.md`. Implements the embedded-text part of AI-01, source/unverified boundaries of AI-05, and cancellation/resilience for AI-06. It does not complete P3, OCR, clinical extraction/verification, persisted extraction or vault-wide full-text search.

## Delivery and review

An explicit PDF-only Extract text action reads the current VIEW-authorized preview endpoint. Independent export permission never enables extraction. Originals, native previews, upload, title editing and recovery retain their existing behavior. Extracted pages are plain React text, identified by source title, explicitly unverified, and held only in component memory.

The supervisor owns protected byte acquisition, current patient/list validation, cancellation and dependency integration. Actual OpenCode `opencode/glm-5.3-flash-free` supplied the presentation artifact from an OS-sandboxed, sanitized interface-only brief; no repository secrets, sessions or documents were supplied. Native Codex agents authored browser tests and independently reviewed lifecycle/security. The supervisor integrated and reviewed all changes, reused the shared Button, corrected copy and kept final policy decisions local.

PDF.js is pinned to 6.5.438 with publisher integrity in pnpm-lock.yaml. Apache-2.0 and Adobe/Foxit/Liberation distribution notices are included under public/licenses/pdfjs. Optional @napi-rs/canvas 1.1.1/platform packages are publisher transitives in the lockfile, not browser functionality. The browser production artifact contains the lazy parser, local worker and local font/CMap files; no native canvas service, external CDN or AI processing is used. Current production dependency audit reports zero advisories.

Parsing is text-only with XFA, rendering, font-face injection, worker fetches, WASM, range/stream loading and prefetch disabled. No scripting manager is created; version 6.5.438 has no obsolete isEvalSupported switch or dynamic function-evaluation path. Required CMap/font requests are restricted to exact publisher assets on the same origin. Metadata/annotations/actions are not rendered or executed. Parser diagnostics are silenced; no source text is logged or persisted.

Limits: 10 MiB actual input, 50 pages, 500,000 characters, 20 seconds including fetch/lazy-load/processing. Page/character limits produce an explicit partial result. Empty/scanned, malformed and password-protected files are honest unavailable states. Worker cancellation terminates the actual worker; initialization failure cleans it up. Revalidation immediately hides/clears output and aborts work; an explicit Retry is required after successful validation. Denied validation, patient/session changes and Trash remove the source-bound dialog. Late responses/imports/workers cannot republish results. Keyboard focus remains on the dialog heading during state changes and returns safely after context checks.

Independent review identified and corrected: stalled-import deadlines, cancellation generation ownership, worker-initialization cleanup and deferred focus restoration. Boundary tests identified PDF.js stream cancellation's required Error reason; the character-cap path now uses the documented runtime expectation.

## Exact changed paths

- `.tasks/p3-browser-pdf-text-plan.md` — approved scope and limits.
- `.tasks/p3-browser-pdf-text-report.md` — delivery/review/verification record.
- `apps/web/package.json`, `pnpm-lock.yaml` — approved exact dependency.
- `apps/web/src/features/documents/index.tsx` — authorized action/source lifetime and focus integration.
- `apps/web/src/features/documents/PdfExtractionDialog.tsx` — protected acquisition, input/deadline limits, cancellation and dialog lifecycle.
- `apps/web/src/features/documents/pdfText.ts` — lazy parser/owned worker, bounded plain text, local asset allowlist.
- `apps/web/src/features/documents/PdfTextContent.tsx` — shared-token loading/partial/empty/failure presentation.
- `apps/web/e2e/pdf-extraction.spec.ts` — synthetic PDFs and browser security/lifecycle/accessibility checks.
- `apps/web/public/licenses/pdfjs/{README.txt,LICENSE,LICENSE_CMAPS,LICENSE_FOXIT,LICENSE_LIBERATION}` — publisher distribution notices.

## Verification

- Final production build/typecheck passed. The parser remains a lazy chunk (~138 kB gzip); the actual local module worker loads correctly from the built asset path. Native canvas imports are absent from the browser artifact.
- Final production extraction suite: **44 passed**, desktop/mobile. Covers valid multi-page PDFs, plain-text injection resistance, no external requests/source logging/storage, export-only exclusion, VIEW denial/revocation, patient removal, cancellation/late replies, retries, scan/invalid/password gates, metadata/actual byte caps, page and character caps, fetch/import/worker deadlines, worker teardown/retry, deferred focus, both themes, 320px overflow and axe checks.
- Existing regression cases: **82 passed, 2 pre-existing skips** across browsing/title editing, original preview/download, upload queue/focus/retry/duplicates and Trash/restore. Of these, 70 passed against production assets; the 12 older document-vault tests import a development-only fixture and passed in their intended Vite development harness. An initial combined production invocation failed those 12 because `/src/.../test-fixture.tsx` is not deployed; rerunning the correct harness resolved all 12 without implementation changes.
- Total distinct passing browser checks: **126**, plus 2 pre-existing skipped redundant visual cases. No remaining failing product test.
- Scoped ESLint, Prettier and git diff checks passed; secret detection passed; production dependency audit reported zero vulnerabilities. No backend/database changes, so no Docker or hosted migration verification was needed.
- Actual production screenshots inspected by the supervisor: [mobile light](../.local/screenshots/pdf-text-light-mobile.png), [mobile dark](../.local/screenshots/pdf-text-dark-mobile.png), [desktop light](../.local/screenshots/pdf-text-light-desktop.png), [desktop dark](../.local/screenshots/pdf-text-dark-desktop.png). Synthetic fixture only, 320px mobile / 1440px desktop, consistent 1000px height, viewport captures. Shared dialog tokens, contrast, layering and wrapping retained.

## Limits / operational notes

No hosted migrations, Supabase/R2 writes, Docker or actual patient records were used. Browser automation uses synthetic PDFs and mocked authenticated endpoints; it is not live-provider acceptance. Static parser/worker assets add download size only when extraction is requested (parser about 138 kB gzip; worker about 2.25 MB uncompressed). Unusual fonts, malformed or unsupported PDFs may remain unavailable; originals remain independently available under current permission. Browser/Safari compatibility beyond the tested installed Chrome is not claimed. Memory-only output disappears on close or revalidation; no clinical facts are promoted or persisted.
