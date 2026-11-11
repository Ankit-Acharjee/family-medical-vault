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
