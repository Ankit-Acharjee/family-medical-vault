# Deletion, Backup & Operations

**Canonical owner:** This file owns the requirement IDs below. Consult adjacent domain docs only for cross-domain work.

## DEL-01 — 30-day trash
**Requirement:** On deletion immediately hide from normal views, search, sharing and derived data; allow recovery for 30 days.

**Acceptance check:** Trash items do not appear in ordinary patient queries and may be restored by authorized users.

## DEL-02 — Purge propagation
**Requirement:** After the recovery period purge primary originals, previews, indexes and derived clinical data, subject to valid legal exceptions.

**Acceptance check:** Purge job reports completion/failures across each storage surface.

## DEL-03 — Restore safety
**Requirement:** Maintain separately protected deletion/revocation evidence and reconcile before re-opening restored services.

**Acceptance check:** Restoring old snapshots does not reactivate deleted files or revoked caregiver access.

## BACKUP-01 — Automated weekly backups
**Requirement:** Independent scheduled cloud execution encrypts and verifies recoverable database plus matching file data.

**Acceptance check:** Weekly backup failure is detected; verified recoverable set includes DB and associated originals.

## BACKUP-02 — 90-day retention
**Requirement:** Retain encrypted weekly recovery points for rolling 90 days rather than a fixed eight-snapshot cap.

**Acceptance check:** Old backup recovery points expire by age and manifests show coverage dates.

## BACKUP-03 — Portable destination
**Requirement:** Backup format is provider independent; independent cloud destination primary with configurable encrypted local adapter.

**Acceptance check:** Restore can be performed without the original cloud backup provider.

## BACKUP-04 — Restore drills
**Requirement:** Periodically test file integrity, schema, permissions and clinically relevant links in an isolated environment.

**Acceptance check:** A restore drill produces an auditable verification outcome.

## REL-01 — Graceful degradation
**Requirement:** AI, SMTP and OCR failures do not block core existing-document access; disk/quota failure stops new uploads safely.

**Acceptance check:** Existing authorized documents remain retrievable when AI is down.

## REL-02 — Operational alerts
**Requirement:** Monitor quota, failed uploads, missed/failed backups and critical security events without storing medical content in telemetry.

**Acceptance check:** Operator receives actionable failures without medical data disclosure.

## Approved restore-safety evidence retention — 20 November 2026

Retain encrypted deletion/revocation evidence while any affected backup could restore the superseded data or access. Automatic deletion of this evidence remains disabled until a separate critical-event retention policy is approved. This is a minimum restore-safety rule, not a statutory retention period or authority to erase primary records. The existing 90-day ordinary-access-event policy and 90-day backup retention remain separate. This approval does not activate hosted ledger writes, Object Lock, backups, purges or restored services.

## Approved deletion/revocation completion — 22 November 2026

Deletion and access revocation must deny local access immediately, but may be reported completed only after independent restore-ledger confirmation. If confirmation fails, show pending protection rather than false completion; preserve the local denial. Restored services remain closed when evidence is incomplete. This defines completion/failure behavior, not new mutation authority or an automatic owner-assisted recovery fallback. Source transaction, receipt authenticity and crash-ordering guarantees must be verified before activation.
