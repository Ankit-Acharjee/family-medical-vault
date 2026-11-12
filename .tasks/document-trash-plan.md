# Next feature: protected document Trash and recovery — DEL-01

Status: APPROVED by user on 12 November 2026, including the explicit edit-right mapping below. Base: develop at 5c86cb7.
Read: AGENTS.md; docs/operations/backup-recovery.md; docs/domains/access.md; docs/security/access-control.md; canonical design screen/flow guidance.

## Permission policy — approved
The canonical documents require authorized deletion/recovery but do not explicitly map those operations to the five existing actions. Proposed mapping: owner authority or a current scoped **edit** grant permits Trash/restore of that exact document. Manage/upload alone never permits it. Trash-list metadata additionally requires current independent view or export permission for each record; edit alone never discloses filenames or other document metadata. Do not introduce an implicit administrator bypass or silently change grant meanings without this approval.

## Local deliverable
- Explicit patient/document confirmation moves a READY original into protected Trash, with server-authoritative deletion time and a 30-day recovery deadline.
- Immediately deny normal listing/search, preview/export, title editing and duplicate matching for trashed originals. Replaying the original upload cannot silently restore a trashed document.
- Reuse the Documents screen with a clearly distinguished Trash view, understandable recovery deadline, empty/error states and an explicit authorized Restore action. Preserve existing navigation and approved Overview.
- Restore within the 30-day window only after rechecking current exact-scope permissions. At the deadline, restoration denies; do not promise that physical purge has occurred.
- Keep original bytes, keys, Person IDs and upload declarations intact. Trash/restore metadata and content-free audit events must commit atomically; retries cannot duplicate events or bypass expiry.

## Work split and acceptance
1. Supervisor freezes permission/resource-state behavior, upload-replay semantics, schema, atomic audit and migration design. Add only the narrowly necessary additive migration; preserve existing data and provider-managed schemas.
2. OpenCode GLM implements bounded confirmation/Trash presentation using a sanitized source/interface export. No secrets, provider access, authorization, installations or Git writes.
3. Native Codex independently tests API denials, scoped/expired/revoked grants, recovery deadline boundaries, concurrent rename/read/upload replay/Trash/restore, transaction rollback and current-state visibility. Real disposable PostgreSQL verifies migration upgrade, privileges and atomicity without Docker.
4. Browser tests cover confirmation cancellation, clear patient attribution, focus restoration, stale patient/session responses, empty/failure/retry states, existing upload/preview/export, both themes and narrow layouts. Previously delivered bytes cannot be recalled; clear local previews after a successful Trash action.
5. Review, run required checks, commit and push to develop under standing authorization. Hosted migration execution needs separate exact-target approval after local verification and read-only preflight.

## Exclusions and release boundary
No R2 deletion, permanent-purge scheduler, legal-hold system, backup deployment/reconciliation, derived-data engine or unimplemented sharing features. DEL-02/03 and backup/restore safety remain separate required operational release work; this development slice is not full deletion-retention compliance. Do not deploy it as a complete purge or disaster-recovery solution.
