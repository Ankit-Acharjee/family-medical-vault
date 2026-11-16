# Bounded selected-range PDF OCR — 16 November 2026

Implements AI-01/02/03/05/06: explicit local OCR for one to five consecutive PDF pages within pages1–50. The existing single-page path and source authorization remain intact. Sequential processing shares one operation lease and a60-second deadline including original acquisition. Cancel, failure or lost access discards the unpublished batch; explicit Save replaces the latest unverified text using existing SHA/revision/lifecycle/CAS checks. Blank page provenance is preserved. Aggregate100000-character truncation stops further pages without splitting a surrogate pair. No provider, external processing, dependency or medical interpretation was added.

## Verification and review

- Native Astra reviewed architecture/contracts and source provenance, added TS/SQL vectors and native persistence checks, and identified an upstream Unicode truncation issue. Two Terra workers implemented scoped UI/execution and browser checks. Root fixed publisher/defensive Unicode boundaries, integrated/reviewed final changes and completed verification after workers reached usage limits. No independent final Astra re-review of that last fix is claimed; no OpenCode fallback was used.
- API321 tests and disposable native PostgreSQL22 tests passed, including legacy formats, TS/SQL parity, stale source/lifecycle/permissions, audit rollback and downstream review provenance. No Docker or hosted medical rows were used.
- Built Chrome desktop/mobile PDF/image OCR regression168 passed; saved range reopen/blank provenance2 passed; focused theme/accessibility screenshots6 passed. OCR publisher boundary unit check passed. Build, types, lint, formatting, secret and whitespace checks passed.
- Actual range-control screenshots inspected in Arctic Blue and Obsidian at320/390px mobile and1440px desktop; keyboard/focus, reduced motion, axe and no horizontal overflow checked. Synthetic real two-page OCR, cancellation/timeout, engine cleanup/lease, explicit Save and character/Unicode boundaries covered. Existing UI toolchain/primitives reused; MCP browser/Context7 tools were not exposed in this session.

## Rollout and limitations

Migration20261116000100_pdf_pages_ocr changes only the existing extraction-result validator to accept the bounded new method. Hosted read-only TLS/UTC/runtime-role/all18-checksum preflight passed; migration19 is NOT applied and requires separate user approval. Deploy it before using shared saved range results against development. Existing saved formats remain valid. No whole-file/background job, handwriting/clinical accuracy guarantee, external fallback or authenticated hosted end-to-end verification is claimed.

Next readiness work: review P3 organization/grouping requirements and remaining gaps before choosing another narrowly bounded implementation; do not treat unverified suggestions as canonical document organization or clinical facts.
