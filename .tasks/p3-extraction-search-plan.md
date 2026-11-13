# P3 — Search saved extraction (DOC-05, AI-01/AI-02/AI-05/AI-06)

Status: implemented, reviewed and locally verified; see `p3-extraction-search-report.md`. Authorized by the standing automated workflow. No routine plan approval needed; hosted migration application remains separately gated.

- Benchmark native PostgreSQL search locally on synthetic normal and adversarial saved results before selecting an index. No Docker, secrets or hosted benchmark.
- Extend existing active Documents search: union current title/original filename substring matches with server-side saved-text term matches. No new routes/screens, external AI, snippets, invented metadata or clinical verification.
- POST `/api/patients/:patientId/documents/search` JSON avoids search terms in URLs. Strict `{query, categoryId?, uploadedFrom?, uploadedBefore?}`; query trimmed 1–200 UTF-16 units, valid Unicode/no NUL. Optional UUID category and UTC ISO millisecond instants; start inclusive/end exclusive. Browser computes local midnights, preserving existing calendar-date filters and DST.
- Response `{documentIds: string[], truncated: boolean}`, at most 200 unique IDs, ordered uploaded newest then ID. A 201st *authorized, filtered* match controls truncated. Refine-search notice on truncation; no total or cursors.
- Existing authoritative View permission only for text matches (Export alone retains title metadata). Active READY originals and matching source hash only. Saved snapshots remain searchable after restore. Recheck current grants after IO; coordinate document locks and private existing document.viewed audit for returned IDs. No query/content in logs/events.
- Frontend debounce and cancel stale requests on query, filters, patient, view/revalidation. Hide stale hits immediately; title results remain usable if text search unavailable, with explicit retry/incomplete notice. No requests in Trash or for export-only documents; no persistent query cache.
- Verify contracts/API/real PostgreSQL permissions, matching/limits/index/Trash/restore/replacement, frontend stale/error/retry/access loss, keyboard and both themes/mobile. Independent architecture/review, supervisor integration, commit and push develop when checks pass.

## Frozen public interface
Contracts live in new `packages/contracts/src/document-search.ts`, reexport from index. Types `DocumentSearchInput`, `DocumentSearchResult`; guards `isDocumentSearchInput`, `isDocumentSearchResult`; constants `maximumDocumentSearchHits=200`, `maximumDocumentSearchQueryLength=200`.
Optional timestamps require canonical `Date.toISOString()` format, not offsets; reject invalid/reversed/unknown inputs. Empty/punctuation-only terms may yield no text hits while local title search continues. Backend normalizes query with trim; no prefix/fuzzy/phrase grammar promised. Exact matching semantics follow benchmark result.
