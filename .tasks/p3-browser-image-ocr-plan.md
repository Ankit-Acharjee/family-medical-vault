# Next feature: on-demand browser image OCR — AI-01 continuation

Status: approved by the user on 12 November 2026. Base: develop at 7b64fe1. This plan is implementation-ready; no packages installed or application code changed during planning.

## Scope and user flow
- First OCR slice: already stored JPEG, PNG and WebP originals with current VIEW permission. Explicit **Recognize text (OCR)** action; no automatic work on upload/open and no background batch.
- Reuse the Documents source-bound dialog, semantic theme tokens, protected preview endpoint, bounded text presentation and focus/revalidation patterns. Original preview/download/upload/Trash remain independent.
- English printed-text recognition first, clearly labeled before starting. No handwriting or other-language accuracy promises, diagnosis/classification, clinical fact extraction, verification, or persisted/full-vault search.
- Scanned-PDF OCR is a subsequent slice: the engine does not accept PDFs directly; rendering selected PDF pages adds a separate resource/security boundary. Existing embedded PDF text extraction remains intact. Do not silently rasterize an entire PDF.

## Exact dependency and asset approval requested
- Pin `tesseract.js@7.0.0`, `tesseract.js-core@7.0.0` and English data `@tesseract.js-data/eng@1.0.0`; audit the resolved transitives, lockfile integrity and publisher licenses before integration. The explicit core pin supplies compatible self-hosted assets; its npm latest tag currently points to 6.1.2 even though version 7.0.0 is published and required by wrapper 7.0.0.
- Sources: [wrapper metadata](https://registry.npmjs.org/tesseract.js/7.0.0), [core metadata](https://registry.npmjs.org/tesseract.js-core/7.0.0), [English data metadata](https://registry.npmjs.org/@tesseract.js-data%2feng/1.0.0), [publisher API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md), [local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md).
- Lazy-load and self-host the exact worker, core/WASM variants and English model; no runtime CDN defaults or external document processing. Generate reproducible build assets from pinned packages rather than committing large opaque model binaries. Preserve distribution notices.
- Measure actual first-use transferred bytes and selected WASM/model sizes in production; package unpacked size is not a browser download estimate. Stop and report if the required asset violates the static hosting per-file limit or cannot be deployed without another service.

## Resource, privacy and correctness gates
- One document and one OCR worker at a time. Proposed limits: 10 MiB input, source dimensions at most 16 megapixels/8192px per edge, raster at most 2 megapixels/2000px per edge, 100,000 output characters, 60-second total deadline including initialization and asset loads.
- Validate supported format dimensions before large raster allocation; bound decode/resize and clean up bitmaps/canvases. Limits are ceilings, not a guarantee of fitting every device. If safe bounded decoding is not feasible, report unavailable rather than silently relaxing limits.
- Show initialization/recognition progress, Cancel, honest empty/unsupported/failed/timeout states and explicit Retry. Label downsizing and truncated output; never imply a partial/low-quality result is complete or clinically verified. Test that UI remains responsive.
- VIEW only: export/edit/upload/manage alone confer no OCR access. Recheck current server permission through the existing endpoint; hide/clear stale output on patient/session/document changes, denied revalidation or Trash. Late initialization/results cannot republish content.
- Original bytes, rasters and output remain memory-only; no IndexedDB/localStorage source caches, analytics, document logs or server persistence. Explicitly disable the library's default IndexedDB language caching with cacheMethod:none; ordinary HTTP caching may apply only to public static engine/model assets.
- Own termination even during initialization, not merely after createWorker resolves. No external image URLs; accept only acquired bytes/derived rasters. Suppress raw engine logs/errors; whitelist generic progress fields.

## Delegation and implementation sequence
1. Supervisor: dependency/asset review, secure byte acquisition, dimensions/limits, worker ownership/cancellation, permission integration and release review.
2. OpenCode GLM/DeepSeek: bounded OCR presentation/progress adapter and deterministic synthetic image fixtures from a sanitized OS-sandboxed brief; no secrets, real images, provider sessions or installs by workers.
3. Native Codex agents: independent browser tests and lifecycle/security review in parallel with bounded presentation. Supervisor inspects every artifact and fixes integration.
4. Synthetic browser tests: real OCR of clear printed text; empty/corrupt/unsupported image; byte/dimension/output limits; asset/init/recognition failure and timeout; cancellation/late replies; retry; revoked VIEW/export-only/Trash; no external requests/content logs/persistent source caches; both themes/mobile/keyboard/focus/overflow/reduced motion.
5. Verify production self-hosted assets and actual worker teardown, record measured latency/asset size on this machine without claiming universal device performance. Run relevant existing vault/PDF regressions, build/types/lint/secrets/dependency audit and capture desktop/mobile screenshots in both themes. Docker/hosted writes/migrations are unnecessary.
6. After checks/review, commit with implementation context and push develop under standing authorization. Report remaining OCR limitations and propose selected-page scanned-PDF OCR separately.

Documentation note: architecture/decisions.md retains a deprecated monochrome UX table row; existing AGENTS.md and canonical design documentation explicitly establish Arctic Blue/Obsidian. This task preserves the approved current themes and does not change design documents.
