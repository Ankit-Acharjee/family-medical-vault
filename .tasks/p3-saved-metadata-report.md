# P3 saved metadata — verification record

## Behavior and policy

Explicitly save/reopen unverified source-linked metadata, separately from document fields and clinical facts. Current View reads; owner or current Edit+View saves, as approved by the user. Server recomputes the shared `explicit-lines-v1` rules from the current saved extraction. Empty candidates are valid; no invented metadata or automatic verification.

Immutable source revision/hash and document lifecycle fence stale requests before replay. Metadata has its own monotonically increasing revision. Identical actor/request/payload retries converge; conflicting writes return 409. New extraction hides stale metadata but keeps its revision for later CAS; Trash blocks reads/writes, restore permits current-source reads with fresh write context. Original bytes, keys, categories, upload chronology, text and search stay independent.

## Implementation files

- Contracts: `packages/contracts/src/{metadata-rules,metadata,index}.ts`; existing web rule module becomes a reexport. Rules remain unchanged.
- Backend: `apps/server/src/documents/metadata.{service,store}.ts`; controller/service/store and disabled-store wiring. Extraction source loading and authorization are shared with the existing text implementation rather than introducing a second permission policy.
- Database: `apps/server/prisma/migrations/20261114000100_saved_metadata/migration.sql` and Prisma model. FORCE RLS, narrow grants, source/evidence/revision guards, bounded UTF-16-compatible JSON checks, cascade lifecycle and atomic `document.metadata_saved` event.
- UI: `MetadataSuggestions`, `SavedMetadataPanel`, `MetadataCandidateList`, `SavedExtractionDialog`. Shared candidate display renders actual persisted results; local computation stays distinct. Bounded reads, CSRF, source conflict reload, same-body retry, optional failure fallback and protected-context clearing.
- Tests: metadata contracts/HTTP/native helper and database inventory; shared-rule tests; extended saved-extraction browser fixture and cases. `docs/security/access-control.md` records the explicit user decision; this plan/report records delivery.

## Review and fixes

Native Sol workers implemented bounded contracts/rules, UI and database tests. Astra specified the architecture and reviewed backend concurrency/security. Root fixed its SQL UTF-16/nonblank consistency finding and independently reviewed the integration. A zero source revision is a valid empty GET context, not a valid save payload; valid requests referencing a missing extraction conflict. Native workers hit quota before final handoff; root finished the remaining review, UI lifecycle/evidence rendering and verification. No final Astra approval after those fixes is claimed.

OpenCode `opencode/glm-5.3-flash-free` performed a generic interface-only adversarial review from `/tmp/fmv-saved-metadata-worker`, under the existing OS sandbox denying home/project access. No private source, credentials or records were supplied. Its suggestion to audit aborted writes was not adopted: existing atomic rollback policy remains authoritative.

Root also fixed heading order found by axe; the final tested UI uses a stable focus target and preserves source Find. Screenshots of actual synthetic saved snapshots were inspected in both themes at 1440px desktop and 320px mobile: `.local/screenshots/saved-metadata-{light,dark}-{desktop,mobile}.png` (ignored local artifacts).

## Passed verification

- 225 server regression checks, including 7 new contract and 3 new HTTP/policy checks.
- 21 native PostgreSQL lifecycle checks, including the new metadata suite: source generation, View/Edit independence, revocation, CAS/replay, stale source, Trash/restore, audit/authorization rollback, concurrent saves, narrow privileges, evidence constraints, empty candidates and original invariance. Disposable cluster stopped/removed; no Docker.
- 13 shared-rule tests; 50 development-browser checks; 24 built-preview browser checks (overlapping cases, not unique-case totals).
- Browser checks: real rendering, axe, keyboard/focus, source Find, both themes/layouts, overflow, immutable save payload, retry/conflict/denial behavior and no external requests. API responses were synthetic/intercepted; hosted authenticated end-to-end remains unverified.
- Web build, workspace typecheck, lint, format, secret detection and whitespace checks.

## Hosted gate and limits

Read-only TLS/UTC/runtime-role/12-migration checksum preflight passed for dedicated development project `nyjkrcznezyrgntwvpjj`; metadata table is absent as expected. Migration 13 is pending separate approval. Before application, optional metadata UI falls back locally on unavailable persistence; do not claim hosted saving is active. No production deployment.

Still outside this slice: accepted/corrected metadata fields, taxonomy, canonical date precedence/provider identities, related-document inference, clinical review/verification and external processing. The supported English line grammar remains deliberately conservative.
