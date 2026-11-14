# P3 — Persist unverified metadata suggestions

Status: completed; development migration separately approved, applied and verified on 14 November 2026.

- DOC-03 / AI-02 / AI-05: explicitly save and reopen a separate latest metadata snapshot; no category, canonical date, provider identity or clinical verification changes.
- User approved owner or both scoped Edit+View for saves, current View for reads, source-revision and document lifecycle fencing on 14 November 2026. Canonical access policy records this decision.
- GET/PUT `documents/:documentId/metadata-suggestions`. PUT accepts only immutable source/request/revision references; server recomputes shared deterministic candidates. No client-supplied candidates.
- Independent metadata revision and actor-bound identical-request replay; lock original first, validate source/lifecycle before replay, atomically save/audit, recheck authority before commit.
- Current source only: replacement hides stale snapshots without resetting CAS revision. Trash denies operations; restore permits current-source reads and fences old save requests. Document purge cascades metadata.
- Separate FORCE-RLS table with restricted runtime grants, source/evidence guards, version and bounded JSON constraints. Original text/search revision remains untouched.
- UI retains local suggestions/source Find when optional metadata loading fails; explicit retry, conflict reload, denial clearing and exact-body uncertain retry.
- Sol workers: shared contracts/rules, UI and native DB tests. Astra: architecture and backend review. Root: security/migration/backend integration, browser/API tests, fixes and final verification. Sandboxed OpenCode: generic interface-only adversarial review.
- Migration `20261114000100_saved_metadata` was separately approved and applied to dedicated development. Read-only postflight verified all 13 checksums, metadata FORCE RLS, narrow runtime privileges, source guards, cascade and validator. No production deployment.
