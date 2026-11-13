# Next slice: selected-page scanned-PDF OCR

Status: approved by the user's “go ahead to the next feature” instruction; include Astra in the pipeline.
Requirements: AI-01/AI-05/AI-06. Preserve DOC-02, SEC-02/SEC-05 and existing approved design/UX flows.

## Scope
- Extend the explicit OCR action to a currently VIEW-authorized PDF; let the user choose one page before starting. State the page number and original title beside unverified text.
- Reuse pinned PDF.js 6.5.438 and the current local English Tesseract/model; no new dependencies, external services, server persistence or migrations proposed.
- Preserve fast embedded-text extraction as a separate action; never silently OCR all pages or replace the native viewer. Upload, original preview/download, titles and Trash remain independent.
- First checkpoint: prove responsive, bounded rendering of a synthetic selected PDF page using the installed PDF.js renderer APIs and self-hosted assets. Stop and report if the constraints below cannot be met; do not move rendering to a cloud provider or add a dependency implicitly.

## Bounds and lifecycle
- Original at most 10 MiB, document at most 50 pages, selected raster at most 2 megapixels/2000px per edge, OCR output at most 100,000 characters, total selected-page attempt at most 60 seconds including acquisition/render/init/recognition.
- Use PDF workers and cancellable/cooperative rendering so page rasterization does not block navigation or cancellation. Terminate PDF resources before starting the single OCR engine worker where feasible; never start a parallel page batch.
- Keep document/page source binding and exact current VIEW checks. Hide/clear on patient/session/source change, denied revalidation or Trash. Own renderer/parser/OCR cancellation during initialization and discard late results.
- Disable PDF scripting/XFA and any unnecessary external fetches; self-host required publisher font/CMap/renderer assets. Unsupported encodings/encryption/decoders yield honest unavailable states. Rendering may require additional assets from the already pinned package; review sizes/licenses before use.
- Raster, bytes and text remain memory-only; no medical-content logs, analytics, IndexedDB or server persistence. Preserve initial English/accuracy disclosure, explicit Start, progress, Cancel, Retry and focus restoration.
- Label page-specific results and downsizing; do not imply the rest of the PDF was recognized, or that text is verified clinical data.

## Delegation and acceptance
1. Supervisor owns PDF rendering architecture, bounds, current permission and lifetime integration; first validate the feasibility checkpoint without changing the existing embedded-text helper's guarantees.
   Native Astra reviews rendering feasibility and security/lifecycle risks before implementation; Sol integrates, bounded workers implement/test, and Astra reviews the resulting boundary before release.
2. OpenCode GLM handles interface-only page-selection/progress presentation briefs; no confidential source or records sent. Codex agents handle synthetic PDF fixtures/tests/review if available; supervisor verifies independently regardless of quota.
3. Test actual scanned-page rendering/OCR and page selection; invalid/out-of-range page, encrypted/unsupported PDFs, caps, cancellation at render/init/recognition, late results, lost VIEW/export-only/Trash, no external requests/persistent medical caches, both themes/mobile/keyboard/focus.
4. Run existing image OCR/PDF/vault regressions and production asset/build/type/lint/security checks. Capture both themes at mobile/desktop and report observed resource/timing results without universal device claims.
5. Commit and push develop only after reviewed verification under standing workflow authorization. Full-document batching, multilingual/handwriting recognition, persisted full-text search and clinical fact extraction remain outside this slice.
