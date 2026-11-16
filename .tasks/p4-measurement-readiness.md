# P4 measurement/trend readiness — 16 November 2026

Next roadmap work package: LAB-01/02/03 verified/provisional measurement model and source-linked historical trends. Existing owner-confirmed ClinicalReviewSnapshot entries retain literal analyte/result/unit/reference/specimen/method/collection-date/laboratory strings, exact source page/excerpts, source version and withdrawal history. They are not yet a normalized patient measurement series.

## Safe implementation boundaries

Preserve originals and literal representations. Only active owner-confirmed entries under current View can enter a trusted read model; withdrawn, stale, Trash or denied entries must be excluded, with current source/lifecycle checks and access audit. Unverified extraction must not supply missing clinical fields. Separate numeric, qualified numeric and textual result types; never treat '<5' as numeric5, infer a unit, convert units, guess dates or choose a clinical threshold. Preserve date precision and differing reference intervals. Begin with read-only source-linked records and bounded queries; no new external provider or treatment advice.

## Approved policy and first implementation slice

The user explicitly selected owner-confirmed cross-report comparability on16November2026. Matching literal labels do not authorize automatic grouping; unmatched results stay separate. The canonical medical-data document now records this approved decision. Incompatible units/methods still cannot be silently combined, even through a generic confirmation.

First work package: a pure, source-linked measurement representation and projection of current active owner-confirmed lab items. Preserve decimal precision and raw qualified/textual values, ISO day precision and unknown/unparsed dates, literal reference intervals and source evidence. Every projected entry starts with comparability unconfirmed. No chart, persisted series, approval endpoint or inferred clinical interpretation is introduced in this foundation slice. Caller-side current View/document lifecycle authority remains mandatory; a shared shape cannot establish authorization by itself.

Native Terra implements the focused contracts module and another Terra owns adversarial model tests; supervisor independently reviews precision, provenance and unverified/withdrawn/stale exclusion. Astra is currently usage-limited, so no unavailable Astra review or OpenCode substitution is claimed. This is model definition, not delivery of the complete P4 trends workflow.
