# Saved extraction search — 13 November 2026

## Delivery
DOC-05 with AI-01/AI-02/AI-05/AI-06 boundaries. Existing Documents search now combines literal titles/original filenames with current-View-authorized saved-text hits. Native simple tokenization matches all query terms across persisted pages, without stemming, substring, prefix, fuzzy, phrase or accent-normalization promises. Results remain unverified and may cover only partial saved extraction. No new product screen, dependency, external AI or medical facts.

POST JSON keeps queries out of URLs. Strict 200-unit query/UUID/date contracts; local-calendar inclusive/exclusive UTC bounds; category/date filters before the 200-hit cap. A 201st authorized hit signals truncation without a total. Export-only metadata remains searchable by filename but never contributes text-derived membership. The store joins active READY originals/source hashes, locks originals, rechecks one current policy snapshot across all capped candidates before/after atomic bulk document.viewed audit, and never audits query/text/sentinel. Restore intentionally preserves searchable saved snapshots.

Frontend debounce, deadline, explicit retry and immediate stale-hit clearing cover query/filter/patient/Trash/revalidation changes. Recoverable failures retain labeled title-only results; denied authority clears protected metadata. Successful Save refreshes the unchanged query so replaced text cannot leave stale matches. Existing Saved text/source actions and focus behavior are reused.

## Files
- Shared: `packages/contracts/src/document-search.ts`, reexport in `index.ts`.
- Backend: `documents/{document.store,documents.service,documents.controller,extraction-search.store}.ts`, disabled adapter in `auth/auth.module.ts`.
- Database: Prisma schema and additive `20261113000200_extraction_search/migration.sql`; generated distinct lexeme array plus GIN. Only pages[].text is indexed; original files, keys, permissions and snapshot lifecycle are unchanged.
- Frontend: `useDocumentSearch.ts`, `DocumentSearchNotice.tsx`, `DocumentBrowserControls.tsx`, narrow wiring in `index.tsx`, `DocumentTextDialog.tsx`, `SaveExtractionPanel.tsx`.
- Tests: new search HTTP/contracts/native support/browser fixtures and reviewed generic GLM vectors; inventory update and empty-search intercepts in existing browsing/Trash fixtures.
- Evidence: reproducible `infra/scripts/benchmark-extraction-search.mjs`, `.tasks/p3-search-benchmark.md`, implementation plan and canonical `docs/domains/documents.md` semantics.

## Review and delegation
Astra performed architecture and independent final source review plus 16 focused API/contract checks. Its two material UI findings (Save invalidation and denied-context clearing) were fixed and covered by actual browser tests. Sol workers handled benchmark, UI and tests; benchmark/UI workers reached quota after partial verification, and the supervisor finished integration and final checks. No repeated quota retries.

OpenCode GLM 5.3 Flash Free supplied twelve generic interface-only vectors inside the source/home-denying OS sandbox. Two model mistakes (overlength count and escaped surrogate) were corrected during independent review. No private repository source, credentials or records were submitted. Frontend worker used existing UI/UX Pro Max, Frontend Design, Baseline UI, Web Design Guidelines, React Best Practices and shadcn skills; no new primitives/dependencies or Overview changes. Context7 tools were unavailable; PostgreSQL official documentation was checked for public text-search limits/index guidance.

## Verification
- 215 server regression tests passed, including strict contracts, current/scoped/revoked/expired authority, cross-patient/export-only denial, CSRF, generic failures and query-free logs.
- 20 disposable native PostgreSQL checks passed: all twelve migrations fresh/upgrade/repeatability, index replacement/backfill, View-only caps/sentinel, timestamp/category bounds, audit rollback, immutable generated index, restored text and actual concurrent search/Trash/Save locking. Maximum accepted 500k-unit Unicode extraction saved/indexed and first/last terms matched without tsvector overflow. Cluster stopped and removed; no Docker.
- 84 production browser checks and 64 development checks passed (overlapping coverage): existing browsing/Trash/vault/saved text plus query/filter races, DST, timeout/retry, denied clearing, unchanged-query Save replacement/creation, patient/Trash late-response rejection, keyboard and axe. The dev-only source-import vault fixture was verified in development, not misrepresented as a production test.
- Actual synthetic screenshots inspected for light/dark, 320px mobile and 1440px desktop; additional 390px captures and responsive/axe checks passed. Artifacts: `.local/screenshots/extraction-search-{light,dark}-{320,390,1440}-{desktop,mobile}.png`.
- Workspace typecheck, server/web builds, lint, full formatting, secret detection and diff checks passed.

## Benchmark and limits
The selected array avoids PostgreSQL's <1MiB tsvector limit for valid high-cardinality saved text. On the local PostgreSQL 17.11 warm-cache synthetic 10k small-document corpus, array common/rare p95 was 0.46/0.41ms; bounded 10k array construction took 50.2s. Maximum 500k-unit Unicode generated-array saves with GIN took about 2.5–3.0s. These are local database microbenchmarks, not hosted/API end-to-end latency or concurrency guarantees; full results and EXPLAIN evidence are in the benchmark report. CJK token boundaries, omitted native long lexemes and Unicode normalization remain explicit lexical limitations.

Existing POST abuse limits still apply; rapid requests can yield retryable 429. Large-patient metadata listing/authorization overhead, hosted authenticated end-to-end flows, physical phones and production capacity remain unverified. Index rebuild is required if the fixed parser/dictionary configuration changes. Physical purge/backup release gates remain separate work.

## Hosted gate
Read-only preflight passed for dedicated development project nyjkrcznezyrgntwvpjj: verified TLS/UTC, restricted runtime role, all eleven existing migration checksums match; zero saved snapshots currently need backfill. Migration `20261113000200_extraction_search` is prepared and locally verified but NOT applied. AGENTS.md requires separate hosted-write approval. Until applied, optional text search reports unavailable while filename search and existing saved-text operations remain usable. No production deployment is implied.
