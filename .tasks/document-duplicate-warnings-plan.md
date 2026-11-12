# Next feature: non-destructive duplicate warnings — DOC-06

Status: APPROVED by user on 12 November 2026. Follows document browsing/title editing and the verified ninth development migration.

## Scope
- Surface potential exact-byte duplicates for the selected patient using existing server-side SHA256 and size metadata. Do not claim visual/page similarity or clinical equivalence.
- Preserve every original and its independent upload record. Do not block uploads, automatically merge, delete, move files or change categories.
- Disclose a matching document only when the current user independently has view or export permission for that exact existing record. Upload-only access must not reveal hidden matches, counts, titles or existence; cross-patient matches are never considered.
- Integrate a concise accessible warning into the existing successful upload feedback. Keep full-success dismissal, partial retries, filename privacy, patient/session isolation and focus behavior intact.

## Delegation and verification
1. Supervisor freezes warning semantics/contracts and owns current authorization, metadata queries and audit/privacy decisions; use existing persisted hashes without object reads or exposing hashes to clients.
2. OpenCode GLM implements only bounded warning presentation from sanitized interfaces; no secrets, real records, authorization or provider access.
3. Native Codex independently tests exact-match/nonmatch, distinct same-name originals, changed display titles, duplicate retries, revoked/scoped grants, upload-only isolation, cross-patient denial and partial batches. Add desktop/mobile lifecycle and accessible feedback checks.
4. Run affected API/browser checks, typecheck/lint and secret detection; run disposable database tests if query/schema changes require them. No dependencies or Docker by default.
5. After review and verification, commit and push to develop under standing approval. Any hosted migration/provider writes remain separately gated.

No near-duplicate OCR/page grouping, full-text search, cleanup, deletion or new roadmap features are included. Final interface details must preserve the approved privacy boundary and existing upload flow.
