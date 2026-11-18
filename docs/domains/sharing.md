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

## Approved initial in-app summary read authority — 18 November 2026

The explicit Person owner may read an in-app patient summary. Other users require patient-wide View and current permission for every source included in that summary. Revalidate the included sources and their verification/lifecycle state; source-document access alone does not authorize the aggregate. This authority does not grant export, temporary sharing, external processing or summary modification rights.

## Approved initial summary date semantics — 18 November 2026

Period summaries use exact reported collection/observation calendar dates for laboratory and manual readings. Keep unknown or imprecise dates separately; never substitute upload, recording or verification timestamps. Preserve the manual observation's recorded offset and calendar date. Medication status remains an explicitly labeled current record snapshot, including its owner-recorded current/historical labels; do not infer treatment intervals or historical medication status for a requested period.
