# Security & Audit

**Canonical owner:** This file owns the requirement IDs below. Consult adjacent domain docs only for cross-domain work.

## SEC-01 — Encryption
**Requirement:** Use TLS for transit and cloud-managed encryption at rest for database and private object storage.

**Acceptance check:** No public file URLs or unencrypted transmission of medical content.

## SEC-02 — Authorization enforcement
**Requirement:** All sensitive operations enforce current patient/resource grants server-side, not solely a signed token claim.

**Acceptance check:** Cross-patient ID manipulation returns deny without leaking existence.

## SEC-03 — Audit visibility
**Requirement:** Record patient-visible document views/downloads and permission, sharing, deletion and account changes; protect audit trail against tampering.

**Acceptance check:** Patient can inspect authorized activity without medical contents appearing in log records.

## SEC-04 — Audit retention
**Requirement:** Retain ordinary document access history for 90 days; critical event retention separately controlled and justified.

**Acceptance check:** Standard access events age out according to policy; critical records have a separately defined retention class.

## SEC-05 — Privacy hygiene
**Requirement:** Minimize logs, HTTP routes, object keys, client caches and analytics; never log document content or secrets.

**Acceptance check:** Application logs do not contain reports, diagnoses, credentials or signed URLs.

## SEC-06 — Sensitive operations
**Requirement:** Short-lived one-time activation tokens, secure session cookies, reauthentication where warranted and abuse rate limits.

**Acceptance check:** Token replay and expired links are rejected and audited.

## SEC-07 — External processing
**Requirement:** Consent ledger includes provider, processing purpose, data categories, scope, version and withdrawal.

**Acceptance check:** Disabling consent prevents new external submissions and triggers applicable processor deletion handling.

## Approved permission implementation — November 2026

The backend resolves the verified provider issuer/subject to an application account and reads the current Person owner and grants. The explicit owner policy grants all five independent actions for that owner's Person. Client-supplied patient IDs, capability hints, household membership and infrastructure roles confer no authority. Resource-scoped checks resolve document patient/category membership from the registry before authorization.

Creating or claiming an invitation grants nothing. Approval rechecks the approver's manage right and every proposed action for the exact scope and full proposed expiry; invitation approval also rechecks the original issuer. Display the recipient's permanent Person ID for confirmation through another channel; a self-chosen display name is not identity proof.

A resulting grant is issued by its explicit approver. A manager-approved grant records the exact supporting grants for manage and each action; its expiry cannot outlast them. Revocation atomically revokes dependent descendants and records audit events, preserving independent grants for the same recipient. An owner-approved grant is direct owner authority and remains independent of the invitation creator's earlier grants.

Runtime table privileges and FORCE RLS isolate the backend role, not individual patients: backend policy checks remain mandatory for every operation. Document access events have a 90-day retention deadline; a production purge schedule and critical-event retention policy remain operational release gates. Preview necessarily delivers original bytes and cannot guarantee prevention of saving them.

## Approved Trash permission policy — 12 November 2026

Owner authority or a current scoped **edit** grant permits moving an exact document to Trash and restoring it within its recovery window. Manage or upload alone does not permit either action. Trash-list metadata requires edit plus independent view or export permission for each record; edit alone reveals no file metadata. Ordinary document operations deny trashed records even for the owner. A restricted internal metadata/edit context supports recovery without granting byte access. Existing grants remain visible and revocable under current manage authority while a document is in Trash; creating or approving new document-scoped grants stays blocked. Physical purge and backup reconciliation remain separate DEL-02/DEL-03 work.

## Approved saved-extraction policy — 13 November 2026

The owner or a user with both current scoped **edit** and **view** authority for the exact document may save extracted text. Current **view** authority permits reading saved text; view alone permits local extraction but no shared persistence. Evaluate edit and view together against the same authoritative snapshot. Keep only the latest successful result; failures before a save do not replace it. Saved text follows the original document's Trash, restore and deletion lifecycle and never grants independent access. Browser-submitted text remains explicitly unverified; attaching the server's source hash does not attest transcription accuracy or verify clinical facts. No external AI processing is authorized by this policy.

## Approved saved-metadata policy — 14 November 2026

The owner or users with both current scoped **edit** and **view** may save unverified metadata suggestions; current **view** may read them. Evaluate both save actions against the same authoritative snapshot. Bind suggestions to the saved extraction revision and original source, and follow the document's Trash, restore and deletion lifecycle. This policy does not authorize changing document categories, canonical dates, provider identities or verified clinical facts.

## Approved clinical-verification authority — 14 November 2026

Only the explicit Person owner may verify extracted clinical fields (laboratory values, diagnoses or medication fields). Scoped delegates may review unverified data under current View authority; Edit, View, Manage or their combination does not confer verification authority. Verification is an explicit source-linked action and never follows automatically from saving text or metadata.

## Approved clinical-confirmation withdrawal — 15 November 2026

Only the explicit Person owner may withdraw an incorrectly confirmed clinical entry, under current scoped View authority. Withdrawal must be explicit, retain prior confirmation/history and original source evidence, and exclude the withdrawn entry from future trusted use. Delegates cannot withdraw confirmations. This is a separate state transition, not erasure of historical records or a document-derived instruction.

## Approved diagnosis-confirmation meaning — 15 November 2026

Diagnosis confirmation attests the source statement as written, preserving negation, uncertainty, history and references to another person. It does not establish a current patient diagnosis, disease status or clinical code. Current explicit Person-owner authority and source-linked verification are still required; delegates cannot confirm. Confirmed source statements remain distinct from patient condition lists and from unverified extraction. Withdrawal preserves history under the existing approved policy.

## Approved medication-confirmation meaning — 15 November 2026

Medication confirmation attests prescription source fields exactly as written, retaining uncertainty, historical/stopped wording and source evidence. It does not create an active regimen or schedule, start/stop a medication, calculate a dose or establish prescribing intent. A separate explicit reconciliation step is required before activating a regimen or schedule. Current owner-only verification and history-preserving withdrawal policies still apply; delegates with current View may review source fields but cannot confirm or withdraw.
