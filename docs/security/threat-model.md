# Security threat model — baseline

**Protect:** Original medical files, extracted facts, identity/household relationships, access grants, audit events, encrypted archives and encryption credentials.

**Main threats:** Insecure direct object references across patients; stale JWT/grants after revocation; leaked pre-signed URLs; untrusted OCR/AI prompt injection; hidden backup resurrection; unauthorized caregiver activation; CI/backup secret compromise; malicious files; public bucket or cache; logs exposing diagnoses; service quota exhaustion.

**Controls:** Per-request authorization from authoritative grant store, private R2, short-lived access, strict input/file validation, deterministic access state, independent revocation/deletion ledger, client privacy defaults, least-privilege operations, encryption and restoration drills, externally consented AI only.

**Testing:** negative authorization tests across Persons/resources and roles; revoked and expired grants; forged Object IDs; reused activation tokens; backup restores containing deleted files; AI injection attempts; large/corrupt PDFs; upload interruption.

**Never equate:** admin access with patient data permission; 'encrypted backup' with erased backup; possession of a bearer URL with a claim of patient's identity.
