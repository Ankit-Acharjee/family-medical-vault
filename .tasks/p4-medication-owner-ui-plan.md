# MED-01/MED-02 — owner reconciliation and correction UI

Standing automated-workflow approval applies. All three policy decisions are resolved: owner-only writes/history preservation, exact source lifecycle, patient-wide View plus current source View for delegate reads. Migration22 is applied and postflight-verified. The approved exact-source reuse policy requires migration23 for immutable database identity claims; migration22 remains unchanged. Separate hosted-write approval applies after local verification.

1. Add bounded owner-only discovery of current, explicitly source-attested prescription candidates, using authoritative original/extraction/review lifecycle checks and existing value-free document read audit. Return exact bindings/raw evidence; never infer current/historical status. Existing new-source and stale-binding tests must cover discovery denial/invalidation. Identity enforcement is added in migration23 without rewriting the applied migration.
2. Add a source picker and explicit literal-field/status confirmation form on Meds. Creation remains separate from source attestation; empty candidates link to prescription review in Documents. Corrections keep the same prescription document and preserve history. No inventory, scheduling, reminders or prescribing.
3. Reuse existing protected resource/write lifecycle hooks and accessible primitives. Keep drafts stable through same-context revalidation, clear on lost context/access, seal uncertain requests for exact retry, detect source/CAS changes, prevent close while pending, dismiss on confirmed success and restore focus.
4. Test actual browser creation/correction/history/status flows, source invalidation, failures/retry, denied roles, context changes, responsive themes, axe and overflow. Independently inspect rendered screenshots and run relevant checks before commit/push. No fake hosted records, original-byte access or dependency additions.

Supervisor continues because native workers are quota-limited; no external model substitution or unavailable Astra signoff.

Source discovery is implemented. Exact-source identity is now approved: reuse the existing record and preserve history. Add database claims/backfill guards and current record pointers in source options; never merge by name or choose a winner for legacy conflicts. Then enable the owner form with authoritative identity/revision checks.

Completed: owner form, exact-source reuse/corrections, explicit same-document source relinking and full interaction verification. See `p4-medication-owner-ui-report.md`. Hosted migration23 remains pending separate approval; no hosted clinical writes were made.
