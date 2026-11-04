# Summaries, Emergency & Sharing

**Canonical owner:** This file owns the requirement IDs below. Consult adjacent domain docs only for cross-domain work.

## SUM-01 — Grounded summaries
**Requirement:** Generate patient, medication, lab and period-specific summaries from verified source-linked facts and clearly labeled patient-reported data.

**Acceptance check:** Every consequential summary point can be traced to a record; missing data remains unknown.

## EMG-01 — Emergency profile
**Requirement:** Maintain a private emergency overview and optional minimal opt-in revocable emergency QR exposure.

**Acceptance check:** QR access displays only explicitly selected fields and stops after revocation.

## SHARE-01 — Exports
**Requirement:** Provide selected-record PDF/ZIP exports and clinician-useful summaries subject to export permission.

**Acceptance check:** Exports contain only the selected authorized patient data.

## SHARE-02 — Temporary links
**Requirement:** Allow scoped, expiring and revocable sharing links with access events.

**Acceptance check:** Revoked or expired links stop serving content; downloaded copies cannot be recalled.
