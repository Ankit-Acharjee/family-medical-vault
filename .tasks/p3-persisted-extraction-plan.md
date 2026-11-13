# Next slice: explicitly saved unverified extraction

Status: queued technical proposal after local Find; no server/schema implementation or hosted writes performed.
Requirements: AI-01/AI-02/AI-05/AI-06 and DOC-05 foundations. Read canonical extraction, document, access, security, deletion and backup requirements before implementation.

## Proposed bounded delivery
- Add explicit Save for completed browser extraction, then reopen saved unverified text under current VIEW. No background processing, external AI, clinical fact promotion or new dependency.
- Bind attempts/snapshots to the server's immutable READY document identity/source hash and record method/version, page provenance, partial status and actor. Browser-submitted text remains untrusted: a source hash does not prove transcription accuracy.
- Reuse current scoped authorization, CSRF, no-store responses, document-row locking, generic errors and content-free audit conventions. Proposed persistence authority is owner or both scoped EDIT and VIEW; VIEW alone continues memory-only extraction. Confirm this derived-write mapping against canonical policy before enabling it.
- Make completion idempotent and source-bound. A failed/cancelled replacement preserves the previous successful result; stale attempts cannot overwrite newer state. Define replacement/history retention explicitly rather than introducing implicit version history.
- Trash atomically invalidates pending attempts. Reads always require an active READY original and current VIEW. Derived-data purge/recovery/backup handling must follow the original's approved lifecycle; do not claim unfinished production purge/backup gates are complete.
- Add shared bounded contracts, additive migration, denied/success/retry/conflict tests and a minimal Save/reopen UI that reuses the approved result component. Prepare and verify locally before requesting the separately required hosted migration approval.

## Subsequent search boundary
Defer vault-wide indexing until native PostgreSQL search is benchmarked locally on synthetic expected volumes and search/permission semantics are documented. Saved-text retrieval does not require an indexing decision. Never treat an index, stored text or cached client result as authorization.

## Review checkpoints
Resolve persistence permission and replacement/retention semantics before implementation; distinguish genuine product-policy gaps from routine technical choices. Then delegate contracts/backend/UI/tests with separate ownership and supervisor security review. No migration application, production deployment or external-provider submission is authorized by this queued proposal alone.
