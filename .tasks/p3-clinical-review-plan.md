# Next P3 slice — source-linked clinical field review

Status: owner-only laboratory field confirmation is implemented and locally verified. Hosted migration 14 remains separately approval-gated; see the delivery report and progress checkpoint.

- Requirements: AI-02/AI-03/AI-05/AI-06 and LAB-01/LAB-02. Start with laboratory fields, retaining original representations and provenance; diagnosis/medication inference is not bundled into this slice.
- Existing Edit+View policies authorize unverified text/metadata persistence only. Explicit verification permits trusted downstream use and needs its own owner/delegate policy. The user explicitly approved owner-only clinical verification while source-navigation work continued; delegates may review unverified data.
- Preserve source hash, extraction revision, actual page and exact evidence. Never treat transcription confidence or source linkage as proof of medical accuracy.
- Provisional output and user-confirmed fields remain separate. Defer review without blocking original storage, reading, search or text access. No field automatically becomes verified.
- Verification must explicitly capture analyte, original value/type and unit; retain method/specimen/reference/date/lab only where available or explicitly entered. Unknown fields remain unknown; do not infer units, date precedence or comparability.
- Use current scoped authority per operation, version-fenced atomic saves/audits, protected Trash/restore/deletion lifecycle and no external AI. No P4 trends or medication automation before their requirements are implemented.
- Delivered source/correction/version race, denial, rollback and responsive tests; immutable processing provenance and same-context draft preservation are included. Any hosted schema change retains separate approval. Generalized table extraction and normalized medical models are not completed by this narrow slice.
