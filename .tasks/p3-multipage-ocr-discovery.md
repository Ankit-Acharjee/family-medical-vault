# Next P3 functional slice — multi-page PDF OCR discovery

Status: read-only discovery begun after consent UI and fixed scan-quality coverage. No runtime change or product capability is claimed here. Native Codex workers are currently usage-limited; independent architecture review must resume before a material extraction-contract/schema change. OpenCode remains disabled.

Roadmap P3 work package1/2: current pdf-page-ocr accepts one selected page. packages/contracts/src/extractions.ts explicitly requires exactly one OCR page and uses selected-page/characters provenance; PDF.js local extraction separately supports up to50pages. pdfOcr.ts enforces page1–50, file limits and a16MP embedded-image bound. Existing source/revision/lifecycle, owner/View and no-external-processing gates must remain intact.

Proposed narrow implementation to review:
- An explicit foreground selected-page range, processed sequentially with a single owned local worker; preserve page numbers and exact source SHA. No background-delivery promise, silent whole-file job or external fallback.
- Reuse existing PDF acquisition/raster/OCR/save primitives and cancellation/retry/source-context logic. Preserve one-page operation and all existing stored extraction formats. Bound aggregate characters/pages and total work; define truthful partial/cancel outcomes and avoid replacing a saved result on failure.
- Review the batch contract/method/provenance and SQL extraction validator together. A new reviewed migration, if needed, requires separate hosted approval. Do not weaken the existing single-page contract in place without backward-compatibility and source-safety tests.
- Resolve batching deadlines, sequential worker ownership, OCR partial-page semantics and initial range affordance against existing canonical UX and weak-device constraints. These are architecture/feasibility items for review, not permission to guess new clinical facts or enable processing providers.
- Verify actual multi-page synthetic scans plus incomplete/corrupt pages, cancellation, lost View, Trash/Restore, stale source, unchanged originals and safe persistence. Keep one browser worker and no Docker for local verification.
