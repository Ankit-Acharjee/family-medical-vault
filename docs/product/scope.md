# Scope and invariants

**Purpose:** Private-first medical records vault for ~20–30 family users initially, self-registration permitted, future public growth possible. Responsive web/PWA only. ₹0 recurring-cost **target**, not a guarantee.

**Must support:** Original file vault; browser-first OCR/assisted categorization; search and inferred grouping; verified lab trends; medication/prescription history; source-grounded summaries; optional emergency QR; patient-specific caregiver grants; secure export/share; access audit; 30-day trash; weekly encrypted 90-day backups.

**Explicit non-goals:** Expenses, insurance claims, billing; manually entered visit/symptom/consultation notes; consultation recordings and transcription; hospital administration; native apps; dependable per-dose adherence dashboards; clinical autonomous diagnosis or prescribing.

**Invariants:** Immutable app-managed Person ID; no record without owning Person ID; no ambient admin access; verify sensitive extracted clinical data; no third-party AI without explicit patient/delegate consent; external services optional to core vault; revocation blocks future access; backups must not resurrect deleted/revoked state; originals always preserved until authorized purge.

**Success focus:** A family member can upload, find, view, share, and understand existing medical documents without navigating a complex workflow.
