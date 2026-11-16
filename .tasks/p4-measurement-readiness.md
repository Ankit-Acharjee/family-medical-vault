# P4 measurement/trend readiness — 16 November 2026

Next roadmap work package: LAB-01/02/03 verified/provisional measurement model and source-linked historical trends. Existing owner-confirmed ClinicalReviewSnapshot entries retain literal analyte/result/unit/reference/specimen/method/collection-date/laboratory strings, exact source page/excerpts, source version and withdrawal history. They are not yet a normalized patient measurement series.

## Safe implementation boundaries

Preserve originals and literal representations. Only active owner-confirmed entries under current View can enter a trusted read model; withdrawn, stale, Trash or denied entries must be excluded, with current source/lifecycle checks and access audit. Unverified extraction must not supply missing clinical fields. Separate numeric, qualified numeric and textual result types; never treat '<5' as numeric5, infer a unit, convert units, guess dates or choose a clinical threshold. Preserve date precision and differing reference intervals. Begin with read-only source-linked records and bounded queries; no new external provider or treatment advice.

## Decision needed before automatic trend grouping

Canonical LAB-03 requires comparable series and forbids silently combining incompatible units/methods, but does not define when matching literal labels establish comparability, especially absent specimen or method. Existing source confirmation attests the report fields, not an explicit cross-report equivalence decision. A conservative proposal is no inferred analyte aliases or unit conversion, no auto-combination when method/specimen are missing or conflicting, and an explicit owner decision before treating a cross-report series as comparable. A less restrictive policy may auto-group exactly matching analyte/unit/specimen/method labels while clearly disclosing limits. This affects medical meaning and cannot be silently chosen as a UI detail.

Pending policy clarification: distinguish per-document verified entry browsing (ready independently) from trusted cross-document charts. Native Astra became usage-limited after reviewing the preceding feature; no OpenCode fallback is authorized. Continue bounded model/read-path work once the grouping policy is resolved; independently review clinical interpretation boundaries before shipping trends.
