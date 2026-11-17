# MED-01/MED-02 — approved lifecycle and reconciliation contracts

Recorded the user's source-bound lifecycle decision in the canonical medication domain. Added strict shared contracts for an explicit, separate owner-recorded reconciliation intent, exact source bindings, current/historical status, nine literal medication fields and append-only entry revisions. Optional unknowns remain null; no dose, date, schedule or treatment-status inference is performed. Field strings are bounded to 120 UTF-16 code units, matching the initial source field budget; control characters and blank values are rejected without rewriting accepted text.

The pure freshness helper checks the exact current source/review SHA, revisions, lifecycle and still-attested candidate. Withdrawal, replacement review and Trash/Restore cannot silently revalidate an old reconciliation. A stale source leaves the owner's recorded status intact; it does not mean treatment stopped. This helper is not authorization: authoritative source availability and current View remain mandatory server checks.

Verification: 17 source/review/reconciliation contract tests passed, including malformed shapes and bounds, explicit confirmation, unknown/raw values, correction revisions, exact dates and source invalidation/re-review. Workspace typecheck, lint, formatting and secret checks passed. Supervisor review only; native workers/Astra remain quota-limited. No UI, hosted writes, database migration or endpoint is enabled by this slice.

Remaining decision: list-read authority (patient-wide View plus source View, or source View alone). The explicit question is pending. Persistence/read discovery must enforce the selected rule before delivery; owner-only write authority and the approved lifecycle are already settled.
