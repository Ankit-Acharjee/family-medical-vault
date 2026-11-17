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

## Approved initial reconciliation authority — 17 November 2026

Only the explicit Person owner may initially reconcile an owner-reviewed prescription into the recorded current/history medication list, correct its record or mark it historical. Preserve prior history. Source-field confirmation alone remains insufficient: reconciliation is a separate explicit action. These actions record medication context; the application does not prescribe or recommend starting/stopping treatment. Delegate writes remain deferred.

## Approved source-bound reconciliation lifecycle — 17 November 2026

Each reconciliation binds to the exact owner-reviewed prescription/source version. Source changes, withdrawal or Trash require source review again; invalid sources are excluded from trusted use. Preserve the owner's recorded current/historical status and prior history when a source becomes invalid. Source invalidation never implies that treatment stopped, and restoring a document does not automatically revalidate its old reconciliation. Reconciliation remains a separate owner action after source review.

## Approved reconciliation read authority — 17 November 2026

The owner may read the recorded current/history list. Other users need patient-wide View and current View of each source document; document/category grants alone do not expose the patient-level list. Recheck both permissions on every read, including history. Source unavailability excludes the source from trusted use without changing recorded medication status.

## Approved exact-source record identity — 17 November 2026

Reuse the existing medication record and preserve its history when reconciling the same document, extraction revision, lifecycle and source block again. A new source-attestation review does not create a new medication identity for that exact source. Never merge records automatically based on matching medication names across different prescriptions. Creation/correction must enforce this identity rule atomically; conflicting legacy identities require explicit resolution rather than silent merging or deletion.

## Approved initial inventory authority — 17 November 2026

Optional medication quantity, expiry and refill records use owner-only writes with preserved correction history. Apply the medication record's read permissions: the owner may read; delegates require patient-wide View plus current View of the source. Inventory information remains optional and does not block prescription upload or medication reconciliation. It does not confer permission to change medication status or source confirmation.

## Approved initial schedule authority — 17 November 2026

Creating, correcting or retiring an informational medication schedule is owner-only, with preserved history. Use the medication record's source-authorized read permissions: the owner may read; delegates require patient-wide View plus current View of the source. This authority does not authorize prescribing, changing medication status, dose-taking confirmation or dependable background notification delivery.

## Approved source-bound schedule lifecycle — 17 November 2026

Medication/source changes require explicit owner review before a schedule can be used again. Preserve the recorded or retired schedule state and all history. Source invalidation or schedule retirement never implies that treatment stopped; restoring or re-reviewing a source does not automatically reactivate its previously recorded schedule.
