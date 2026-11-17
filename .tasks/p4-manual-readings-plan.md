# LAB-04 manual readings — discovery and pending authority

Next roadmap scope: clearly labeled manually entered BP, weight, pulse and glucose observations, kept distinguishable from laboratory reports. Source-document verification authority does not automatically define manual-entry authority. A user question is pending: owner-only initially, or owner plus delegates with current Edit and View; both preserve correction/withdrawal history. Do not implement the write path until this decision arrives.

Ready implementation outline after policy resolution:

1. Define a bounded explicit manual-observation contract: exact entered values/units and observed time, explicit manual provenance/actor and immutable history, CAS/idempotency and withdrawal semantics. Do not invent source documents, silently convert units, infer missing timezones, or assign clinical interpretations/thresholds.
2. Add a narrow separately reviewed application-schema migration with restricted runtime privileges, row/source/actor guards and audited authoritative patient access. Run real disposable native PostgreSQL tests before requesting any separate hosted-write approval. No Docker/hosted writes during routine implementation.
3. Add a scoped entry/history interface on existing Trends using established dialog/form/error/retry/focus/context patterns. Preserve lab comparison selection and keep manual series distinct; unknown or incompatible units never merge automatically.
4. Verify owner/delegate/scoped View rules according to the answer, revoke/expiry races, idempotency/conflicts, correction/withdrawal history, timestamps/exact units, both themes/mobile/axe and source-independent manual labels. No diagnostic advice, reminders, device imports or future roadmap expansion.

Pending policy is recorded here because `docs/architecture/open-decisions.md` explicitly owns technical feasibility checks, not open product requirements. The domain policy will be recorded in its canonical owner after the user answers. Native workers remain quota-limited; no OpenCode fallback is authorized.
