# P3 — Local metadata suggestions

Status: completed, independently reviewed and verified; see p3-metadata-suggestions-report.md.

- Requirements: DOC-03, AI-02 and AI-05; bounded incremental delivery, not full clinical review or persisted metadata.
- Show deterministic, explicitly labeled type/date/provider/label candidates from the current authorized saved extraction only.
- Preserve source wording, actual page and exact evidence excerpt; identify revision, extraction method and rule version. Strength describes rule evidence, never calibrated accuracy.
- Unverified, local and display-only: no category/grant/timeline mutation, clinical values, external processing, new API, migration or dependency. Existing saved text is unchanged; suggestions are not separately saved.
- Conservative rules abstain on unsupported inputs; ambiguous dates remain literal and tentative. Partial/OCR limitations stay visible.
- Ownership: Sol rules/tests; Sol UI in saved dialog; supervisor browser tests/integration; Astra architecture/final review; sandboxed OpenCode synthetic edge-case review if available.
- Verify helper negatives/provenance/bounds, existing saved-text regressions, denied/revoked access, current revision, retries, Find/focus, desktop/mobile both themes, overflow and axe.
- Later work: persisted acceptance/correction policy, classification taxonomy, canonical date precedence, provider identity and related-document inference. No implied completion of those items.
