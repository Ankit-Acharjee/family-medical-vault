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
