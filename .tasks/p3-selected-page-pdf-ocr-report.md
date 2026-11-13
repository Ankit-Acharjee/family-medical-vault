# Selected-page scanned-PDF OCR

Approved scope: `.tasks/p3-selected-page-pdf-ocr-plan.md`; AI-01/AI-05/AI-06, preserving DOC-02 and current VIEW authorization. This is one-page browser OCR, not completion of P3 or persisted/full-vault text search.

## Behavior and boundaries

VIEW-authorized PDFs now offer explicit **Recognize text (OCR)** alongside embedded **Extract text**. Choose a page, read the local English/accuracy disclosure, then start. Changing the page clears output and requires another explicit start. Results retain original title, page number and unverified labeling. Upload, preview, download and original bytes remain independent.

The common dialog retains protected acquisition, the 60-second total deadline, focus restoration, retry and context/access invalidation. Original input is limited to 10 MiB, PDFs to 50 pages, rendered output to 2 megapixels/2000px per edge, and OCR output to 100,000 characters. The selected page is rendered in owned PDF workers; parser/renderer resources are terminated before the existing local OCR engine starts. Unsupported worker rendering fails rather than falling back to main-thread page drawing. Embedded PDF text extraction retains its separate configuration and limits.

The pinned PDF.js parser may skip invalid image objects or let asynchronous image failures escape `stopAtErrors`. A small owned module-worker bootstrap installs generic failure handlers and a readiness handshake before importing the unchanged publisher worker. Parser diagnostics, failed operator-stream packets and null-image protocol packets reject the attempt without forwarding diagnostic arguments or recognizing an incomplete blank raster. This conservative policy can reject otherwise partly readable PDFs. The adapter and protocol checks are version-coupled and require review on PDF.js upgrades.

Only existing pinned PDF.js/Tesseract packages and self-hosted publisher assets are used; no dependency, backend, schema, hosted write or external AI was added. PDF scripting/XFA and worker resource fetches are disabled; fonts/CMaps use an exact local asset map and unsupported decoder attempts remain same-origin. Bytes, pixels and text stay memory-only. These input/per-image/output limits and cancellable workers are not a guarantee of a fixed total browser heap footprint.

## Delegation and review

Native Astra performed feasibility/renderer implementation and identified the decoder-null failure boundary before its quota was exhausted. Native Sol workers provided independent integration review, synthetic browser coverage and the parser guard; the supervisor integrated and reviewed the changes and ran verification. OpenCode `opencode/glm-5.3-flash-free` produced only a sanitized interface-only page-field artifact, adapted to the existing shared Input. No records, credentials or private repository source were sent to OpenCode. Astra final sign-off is not claimed; Sol and supervisor review are the disclosed fallback.

The user-approved autonomous workflow and model routing are persisted in `AGENTS.md`; routine development continues through review, verification and develop pushes without repeated plan approval. Separate hosted/deployment/destructive gates remain intact.

## Verification

- 228 distinct production browser checks passed across the main run and focused rerun; two existing redundant mobile visual cases remain skipped. Coverage includes 64 new PDF OCR cases plus existing image OCR, embedded PDF text, browsing/title, Trash/restore and upload picker/duplicate flows. The main run passed 226 checks; two corrupt-PDF assertions expected “unsupported” but omitted the equivalent “not supported” wording. Only that assertion was corrected and both cases rerun.
- Selected-page coverage includes real scanned-page recognition, page/source binding, page/count/size caps, oversized and malformed embedded images, renderer fallback prevention, initialization cancellation, active recognition cancellation/VIEW loss, total deadlines during acquisition/render/recognition, late-result suppression, partial output inheritance, local-only processing, and both themes/axe/overflow/focus.
- All nine web proxy/dimension unit tests, workspace typecheck, root lint, scoped formatting, production web build, secret detection and diff checks passed. No backend/database changes required Docker or hosted verification.
- The additional unchanged publisher renderer asset is 245,736 bytes; parser worker is 2,248,830 bytes and the owned parser bootstrap is 551 bytes in this build. Existing engine/model assets remain unchanged.

Synthetic fixtures only; Chrome desktop/mobile emulation, not real-phone or Safari acceptance. No medical-document accuracy guarantee is implied.

Screenshots: `.local/screenshots/pdf-ocr-{light,dark}-{desktop,mobile}.png` (320px mobile and 1440px desktop, height 1000px). Both themes were visually inspected for dialog bounds, wrapping, page/source labeling and token parity; automated axe/focus/overflow checks complement visual inspection.

## Files

- `AGENTS.md`, `.tasks/p3-selected-page-pdf-ocr-{plan,report}.md`: routing, workflow, approved scope and evidence.
- `apps/web/src/features/documents/{DocumentTextDialog.tsx,PdfOcrPageField.tsx,OcrTextContent.tsx,PdfTextContent.tsx,index.tsx,ocrTypes.ts}`: page selection, source-bound integration and honest states.
- `apps/web/src/features/documents/{pdfOcr.ts,pdf.worker.bootstrap.ts}`: bounded selected-page rendering, parser failure guard and owned lifetimes.
- `apps/web/e2e/{pdf-ocr.spec.ts,image-ocr.spec.ts}`: synthetic regression/acceptance coverage and PDF action expectation.
- `apps/web/public/licenses/pdfjs/README.txt`: renderer attribution alongside existing notices.

Remaining scope: multilingual/handwriting support, whole-document OCR batching, persisted extraction/indexing, metadata suggestions and clinical fact verification. Existing originals remain the authoritative source when recognition is unsupported or inaccurate.
