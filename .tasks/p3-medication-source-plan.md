# Next P3 slice: medication/dose source candidates

Status: requirements preparation begun after diagnosis source-statement attestation; no medication implementation or schema change yet.

- P3 work package4, AI-02/03/05 and MED-02: conservatively identify explicit medication/dose source blocks, preserving original wording, source page/offsets, qualifiers and unknown fields. Start with printed labeled source text; no handwriting accuracy claim, drug-name matching, dose/unit conversion or interpretation of prescribing intent.
- Provisional excerpts must never start/stop a medication, set current/ceased status, change schedules/inventory, calculate doses or enter P4 medication lists automatically. Reconciliation remains an explicit later operation under canonical medication requirements and current owner-only verification authority.
- Inspect the existing parser/safety corpus, extraction limits, saved-source protection and new diagnosis/lab review patterns before proposing exact labels/shape. Reuse shared source evidence primitives where appropriate; avoid duplicating authorization or combining unrelated clinical state machines.
- Keep external AI disabled. Root owns clinical meaning, persistence/authority design and migrations; sandboxed source-free workers may implement generic parsers or adversarial fixtures. Native models only when quota is genuinely available.
- First delivery should be bounded source-candidate contracts, synthetic safety/negative cases and read-only review/source navigation. Do not claim normalized medication records or reconciliation are complete. Any persistence/schema work remains separately tested and hosted-write gated.
