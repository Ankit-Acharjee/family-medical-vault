# LAB-04 manual readings — approved owner-only foundation

Next roadmap scope: clearly labeled manually entered BP, weight, pulse and glucose observations, kept distinguishable from laboratory reports. Source-document verification authority does not automatically define manual-entry authority. User approved owner-only creation/correction/withdrawal with preserved history on17 November2026. Current patient-scope View follows the existing scope model for patient-level data; document/category grants confer no manual-reading access.

Implementation outline:

1. Define a bounded explicit manual-observation contract: exact entered values/units and observed time, explicit manual provenance/actor and immutable history, CAS/idempotency and withdrawal semantics. Do not invent source documents, silently convert units, infer missing timezones, or assign clinical interpretations/thresholds.
2. Add a narrow separately reviewed application-schema migration with restricted runtime privileges, row/source/actor guards and audited authoritative patient access. Run real disposable native PostgreSQL tests before requesting any separate hosted-write approval. No Docker/hosted writes during routine implementation.
3. Add a scoped entry/history interface on existing Trends using established dialog/form/error/retry/focus/context patterns. Preserve lab comparison selection and keep manual series distinct; unknown or incompatible units never merge automatically.
4. Verify owner/delegate/scoped View rules according to the answer, revoke/expiry races, idempotency/conflicts, correction/withdrawal history, timestamps/exact units, both themes/mobile/axe and source-independent manual labels. No diagnostic advice, reminders, device imports or future roadmap expansion.

The approved authority is recorded in the canonical medical-data/security domains. Initial corrections replace the full entered reading while preserving its kind and immutable prior versions; withdrawal is terminal for that reading identity. Exact entered units and explicit-offset observation time are preserved; no clinical-range interpretation or unit conversion. Use fixed bounded pages and separate current state from history pagination. Native workers remain quota-limited; no OpenCode fallback is authorized.
