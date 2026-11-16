# Next P3 slice — possible related documents

Architecture: native Astra read-only review after range OCR rollout19. Requirements DOC-03/04/05/06, AI-02/05, SEC-02/03/05. This plan is within the standing automated roadmap authorization; no additional product-policy decision is required for advisory reads.

## Scope

Opt-in, read-only possible-related-document suggestions from separately saved unverified metadata. Require matching explicit provider text and a matching valid ISO date with the same Report date/Collection date role. Preserve literal source pages/excerpts for both documents. Label the reason as matching saved hints, never proof of the same encounter, provider identity, diagnosis or patient event. Do not normalize ambiguous dates, merge originals, persist links, mutate categories or infer clinical associations. Every original remains independently accessible.

## Implementation boundaries

- Contracts: a bounded response with source context, candidate document identities/display titles, both matching hint excerpts/pages and explicit unverified status. Empty/missing eligible metadata must be actionable, not a fabricated association. No confidence percentages.
- Backend: source and each candidate require current View using the authoritative permission evaluator. Edit, Manage or Export alone does not reveal membership. Same patient, active READY, exclude source/Trash. Bound candidate/result work and disclose incompleteness without counts derived from denied records; authorize any sentinel that changes truncation. Source revision/SHA must match current saved extraction; reuse existing restored-snapshot visibility instead of adding an incompatible lifecycle filter. Serialize original/source reads and final authority checks; emit existing document-view audit events for actually disclosed source/candidates. Fail closed on access changes or invalid snapshots; no hint content in URLs/logs.
- UI: reuse existing document-detail actions/dialog and theme primitives. Explicit action initiates lookup; display advisory evidence and existing original navigation. Handle loading, empty, failed/retry, changed context, focus restoration and permission loss; clear protected results when authority changes. No global or Overview styling changes.
- Tests/review: matcher ambiguity/limits/Unicode, strict contract validation, both-side permissions, cross-patient/Trash/stale source/Restore, final grant revocation and audit rollback, safe truncation, synthetic browser interaction/mobile/themes/axe. No dependency additions, Docker, external processing or real records.

## Worker ownership

Use a bounded Codex backend/contracts worker, separate UI worker after the response contract is fixed, and independent Astra review/tests. Supervisor owns permission/query boundaries, integration, final fixes and push. Do not silently substitute OpenCode if workers are unavailable. Persistent grouping/confirmation, canonical date/provider writes and episode identity remain deferred policy work.

Status: architecture reviewed; implementation not started. Approved migration19 is deployed and verified; feature6844054 and rollout9643ad6 are pushed to develop.
