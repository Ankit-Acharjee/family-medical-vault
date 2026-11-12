# Browser image OCR — AI-01 continuation

Approved: `.tasks/p3-browser-image-ocr-plan.md`, user approval 12 November 2026. Base `7b64fe1` on develop. This delivers image OCR within AI-01 and the unverified/source/cancellation boundaries of AI-05/AI-06, not persisted extraction, clinical fact verification, full-text search or completion of P3.

## Behavior and integration

JPEG, PNG and WebP records with current VIEW permission offer **Recognize text (OCR)**. Opening the dialog explains local processing and English printed-text limitations; only **Start OCR** fetches/processes the protected original. Output is plain unverified text, bound to the original title. Empty, unsupported, invalid, too-large, timeout and retry states remain independent of saving/opening the original.

The existing PDF dialog became `DocumentTextDialog.tsx`: shared protected byte acquisition, cancellation, deadline, revalidation, source identity and focus behavior are reused. PDF extraction retains its original 20-second/50-page/500,000-character bounds. Image OCR has a 60-second total deadline, 10 MiB input, predecode source limits of 16 megapixels/8192px per edge, raster limits of 2 megapixels/2000px per edge, and 100,000 characters. Source dimensions/container structure are checked before decoding. Resize occurs in a disposable raster worker; reductions are disclosed. Animated/unsupported containers and unavailable browser decode APIs fail honestly. These are allocation/input ceilings, not a guarantee of a fixed memory footprint on every browser.

Only one OCR attempt runs per application realm. The raster worker is terminated before the engine worker starts. Workers are owned immediately, including initialization: the app uses the exact pinned publisher worker message protocol (`load`, `loadLanguage`, `initialize`, `recognize`) instead of relying on `createWorker()` to reveal an already-initializing hidden worker. This adapter is version-coupled and must be reviewed and tested on dependency upgrades. Deadline/cancel/close/context invalidation terminates current work; late results cannot republish. Originals and current permission are still enforced by the existing preview endpoint. Export/edit/upload/manage alone do not grant OCR access; Trash or denied list revalidation removes the dialog.

The worker bootstrap suppresses diagnostics, emits only generic progress/rejections and capped plain text, restricts fetch/importScripts to exact same-origin engine/model assets, and disables XMLHttpRequest. No scripting or instructions from recognized text are interpreted. Pixels, protected bytes and output stay in memory; no model/source IndexedDB cache is created (`cacheMethod:none`). Ordinary HTTP caching of public static assets is independent of protected data. No external AI, CDN fallback, provider write, migration or Docker was used.

## Dependencies, assets and resource measurements

Pinned packages: `tesseract.js@7.0.0`, `tesseract.js-core@7.0.0`, `@tesseract.js-data/eng@1.0.0`; integrity is recorded in pnpm-lock.yaml. Public worker/core/model files and publisher notices are emitted reproducibly by the Vite plugin from those exact packages, not committed as opaque model binaries. The English LSTM data uses the smaller `4.0.0_best_int` variant. The local bootstrap is the only wrapper; vendor assets remain unchanged. Wrapper/core Apache licenses, bundled third-party notices, English package MIT metadata and the [trained-data publisher's Apache license](https://github.com/naptha/tessdata/blob/gh-pages/LICENSE) are distributed with the build.

A cold loopback production measurement serving actual built files without HTTP compression observed these OCR asset response bodies:

| Requested public asset | Bytes |
| --- | ---: |
| Owned bootstrap | 2,433 |
| Publisher engine worker | 111,307 |
| Selected relaxed-SIMD LSTM core (embedded WASM) | 3,905,767 |
| English model gzip | 2,952,873 |
| **Engine/model asset total** | **6,972,380** |

Small lazy adapter/raster-worker chunks are additional. The publisher core selects one compatible variant; other generated variants are not all downloaded on first use. The largest emitted variant is under 4.7 MB, below the documented [25 MiB Pages per-file limit](https://developers.cloudflare.com/pages/platform/limits/#file-size); the build enforces that ceiling. The simple 1200×300 printed synthetic fixture completed in 862 ms in the separate cold measurement on this Mac/Chrome. Production suite observations were 859 ms desktop and 833 ms mobile emulation. These are observed synthetic timings, not real phone benchmarks or medical-document accuracy guarantees. Slow networks/devices can reach the explicit timeout.

Production dependency audit: zero info/low/moderate/high/critical advisories at verification time. Postinstall scripts remained disabled; no new install-script approval was needed.

## Delegation and review

Actual OpenCode `opencode/glm-5.3-flash-free` produced the interface-only presentation artifact inside the OS sandbox; it received no private repository source, records, sessions or credentials. The supervisor corrected its default-export assumptions, reused existing Buttons and PDF text presentation, and integrated the common dialog. Native Codex workers created the synthetic browser suite and bounded dimension parser/tests before reaching their quota. The supervisor completed the tests, reviewed parser/worker/lifecycle code locally, and independently ran verification. Automatic approval review rejected a later proposed repository-source submission for external review; it was not retried or sent. No external source-code review is claimed.

Review corrections included explicit timeout wording, shared lifecycle reuse instead of duplicated dialogs, safe worker initialization ownership, generic fatal handling, unavailable-browser states, publisher notice retention and deterministic output/network gates. Tests use real OCR for normal PNG/JPEG/WebP recognition; clearly labeled publisher-protocol stubs cover adversarial output size and blocked transports, without claiming those stub cases validate recognition accuracy.

## Verification

- **50 production OCR browser checks passed** (desktop/mobile, one worker): real printed-image recognition, blank/corrupt images, explicit disclosure/start, no external traffic/source logs/IndexedDB cache, VIEW denial/export-only exclusion, source caps, cancellation/deadline/late replies, worker initialization teardown and retry, missing local model, denied revalidation, patient removal, deferred focus, downsize disclosure, capped partial output and blocked worker transports.
- **114 production regression checks passed, 2 existing skips**: embedded PDF extraction, document browsing/title editing, protected Trash/restore, upload focus/queue/retry/duplicates. The two skips are existing redundant mobile visual cases.
- **12 development-fixture vault checks passed** in their intended Vite harness; they import a development-only fixture and are deliberately run separately from deployed assets.
- **176 distinct browser checks passed** overall, plus the focused measurement rerun and **8 dimension-parser unit tests**. Both canonical themes passed 320px overflow/axe checks and focus behavior; reduced motion retains the existing shared CSS behavior (no new animation).
- Production build/typecheck, scoped ESLint/Prettier, diff validation, secret detection and dependency audit passed. No backend/database changes required container or hosted checks.
- Actual production screenshots captured and visually inspected: [mobile light](../.local/screenshots/image-ocr-light-mobile.png), [mobile dark](../.local/screenshots/image-ocr-dark-mobile.png), [desktop light](../.local/screenshots/image-ocr-light-desktop.png), [desktop dark](../.local/screenshots/image-ocr-dark-desktop.png). Synthetic records only; 320px mobile/1440px desktop, 1000px viewport height. Shared tokens, dialog bounds and wrapping remain intact.

## Changed files

- `.tasks/p3-browser-image-ocr-plan.md`, `.tasks/p3-browser-image-ocr-report.md`: approved scope and verification.
- `.tasks/p3-selected-page-pdf-ocr-plan.md`: proposed follow-up only; not implementation authorization.
- `apps/web/package.json`, `pnpm-lock.yaml`: three approved exact packages and reviewed transitives.
- `apps/web/vite.config.ts`, `apps/web/ocr-assets.ts`: reproducible local development/production static assets.
- `apps/web/src/features/documents/DocumentTextDialog.tsx` (replaces `PdfExtractionDialog.tsx`): common protected source/result lifecycle, with explicit image OCR start.
- `apps/web/src/features/documents/index.tsx`: VIEW-only image action and source-bound shared dialog.
- `apps/web/src/features/documents/{OcrTextContent.tsx,ocrTypes.ts,imageOcr.ts}`: presentation, states/limits and owned worker adapter.
- `apps/web/src/features/documents/{imageDimensions.ts,ocrRaster.worker.ts,ocrEngine.bootstrap.js}`: predecode gates, bounded raster and restricted local engine bootstrap.
- `apps/web/e2e/image-ocr.spec.ts`, `apps/web/test/image-dimensions.test.mjs`: synthetic browser/parser checks.
- `apps/web/public/licenses/ocr/{README.txt,LICENSE_TRAINEDDATA}`: publisher attribution.

## Remaining scope / limitations

Scanned PDFs require a separate selected-page rendering slice; no PDF OCR or automatic batch is implied here. Handwriting/multilingual recognition, persisted full-text search and structured clinical facts/verification are unimplemented. Browser tests ran installed Chrome and mobile emulation, not Safari/real mobile hardware. Live-provider acceptance was not performed, and no real medical documents were used. Poor image quality, orientation, downsampling and unsupported encodings can reduce recognition quality; source retrieval remains the authoritative path.
