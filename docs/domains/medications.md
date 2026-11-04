# Medication & Prescription History

**Canonical owner:** This file owns the requirement IDs below. Consult adjacent domain docs only for cross-domain work.

## MED-01 — Medication lifecycle
**Requirement:** Maintain current and historical medication entries, doses, frequencies, start/end, changes and source prescriptions.

**Acceptance check:** Changes preserve prior medication history and verification state.

## MED-02 — Extraction reconciliation
**Requirement:** Parse prescription medication fields as proposed data requiring safety-sensitive review.

**Acceptance check:** Unreviewed dosage extraction is not treated as an active verified regimen.

## MED-03 — Inventory
**Requirement:** Support optional quantity, expiry and refill information with low-friction entry.

**Acceptance check:** Inventory tracking is optional and does not block prescription upload.

## MED-04 — Schedules
**Requirement:** Provide informational medication schedules and lightweight web reminder affordances without promising dependable background delivery.

**Acceptance check:** No dose-confirmation obligation is created.

## MED-05 — Boundaries
**Requirement:** No autonomous prescribing, per-dose adherence dashboard or native-only monitoring in initial scope.

**Acceptance check:** UI does not present an AI recommendation as a prescription.
