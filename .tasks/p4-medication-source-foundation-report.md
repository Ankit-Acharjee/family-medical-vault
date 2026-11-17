# Medication source foundation — MED-01/MED-02

Recorded the approved owner-only reconciliation authority with preserved history. Added a pure projection of active owner-attested prescription source fields, bound to exact source SHA/revision, review revision and authoritative original/review lifecycle versions. It preserves raw wording and unknown fields and never assigns current medication status or schedules.

The projection is not an authorization boundary: its caller must load authoritative fences and enforce current source View and original availability. Explicit lifecycle fencing rejects an old attestation after Restore, including when the review response alone still passes its structural validator. Returned nested fields are copied to prevent mutation of the input snapshot.

Validation: 11 source/contract tests and the existing medication-review HTTP test passed; workspace typecheck, lint and formatting passed. Supervisor reviewed the diff; quota-limited native workers/Astra were unavailable. No UI, API endpoint, database migration, hosted write or active-regimen behavior is introduced.

Reconciliation persistence remains pending the separately requested source-lifecycle decision. See `p4-medication-reconciliation-plan.md`.
