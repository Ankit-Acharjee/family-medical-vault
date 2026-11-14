# P3 owner-confirmed laboratory fields — delivery

## Scope and authority

AI-02/AI-03/AI-05/AI-06 and LAB-02, with a deliberately partial LAB-01 foundation: conservative explicit English Test/Analyte + Result blocks become source-linked, unrated, unverified candidates. The profile owner explicitly selects, corrects and attests comparison with the original. Current View permits reading; no combination of delegate grants permits verification. No medical interpretation, numeric normalization, comparable measurements, trends, diagnoses or medication extraction is claimed.

## Behavior and protection

- Optional review appears in the existing saved-text dialog with patient identity, extraction/OCR/partial warnings, source evidence and existing exact-page navigation. Common fields are prominent; optional fields use disclosure. Owners may defer, target entries or select a batch. Originals and text remain independent of optional review failures.
- Earlier confirmed corrections prefill owner review of the same source. Targeted confirmations merge with prior confirmed entries from that source, rather than silently dropping unselected prior confirmations. A changed extraction requires an explicit new set; historical sets remain immutable. Historical source excerpts remain visible, but cannot jump into a different current extraction revision.
- The server derives candidate evidence. Source hash/revision/lifecycle, current owner and View, independent review CAS, actor-bound canonical payload fingerprints, historical nonce fencing, parent locks, atomic audit and final authorization checks prevent stale or unauthorised promotion. Confirmations retain raw representations plus processing provenance; no fabricated confidence scores.
- New migration `20261114000200_clinical_review` adds append-only confirmed sets, bounded strict JSON validation, source/owner/evidence/revision guards, FORCE RLS and SELECT/INSERT-only runtime grants. No original files, keys, categories or access grants change. Trash denies access; Restore fences previous saves; deletion cascades. Earlier confirmations survive later OCR/text replacement.
- Rechecking access hides protected content. Dialog-local unsent corrections and selections return only after the same patient/document/source/review/lifecycle/owner context is freshly validated. Source changes or access loss discard them. Uncertain retries retain the identical body/nonce and locked controls; they do not silently rebase. No draft is written to storage, URLs or logs.

## Files

- Contracts: `packages/contracts/src/{lab-fields,clinical-review,index}.ts`.
- Server: `apps/server/src/documents/{clinical-review.service,clinical-review.store,document.store,documents.controller,documents.service}.ts`; `apps/server/src/auth/auth.module.ts`; Prisma schema and migration above.
- UI: `apps/web/src/features/documents/{ClinicalReviewPanel,ClinicalLabFields,SavedExtractionDialog,index}.tsx`, `useClinicalReview.ts`, `clinicalReviewDraft.ts`.
- Tests: clinical contracts and HTTP tests, synthetic parser vectors, native database helper/inventory, saved-extraction browser scenarios and optional endpoint interception in extraction-search tests. Existing search-cap test received a deterministic final sentinel UUID to eliminate a random ordering flake; production search behavior did not change.

## Delegation and review

Sandboxed OpenCode `opencode/glm-5.3-flash-free` produced a generic standalone parser/eight synthetic vectors and a separate generic interface-level invariant review. No private repository source, credentials or records were supplied. Root independently reviewed actual implementation, corrected blank-value acceptance and truncated-line scope, enforced strict boundaries, added immutable processing provenance, fixed partial-confirmation retention and correction prefill, and verified actual interaction lifecycle. Native Astra/Sol workers were quota-exhausted; no unavailable native code review is claimed.

## Verification

Results and hosted approval status are finalized in the active progress checkpoint. Native PostgreSQL tests use a disposable local Postgres.app cluster, stopped and removed afterward; Docker is not used. Synthetic browser APIs are intercepted before navigation. Actual light/dark screenshots are local ignored artifacts at `.local/screenshots/clinical-review-{light,dark}-{desktop,mobile}.png`.

## Remaining boundary

Hosted development still has 13 applied migrations. Read-only verified-TLS/UTC/role/ledger preflight passed with matching checksums and no clinical table. Migration 14 requires the separate hosted-write approval mandated by repository AGENTS.md. This feature does not complete generalized clinical extraction or normalized laboratory observations.
