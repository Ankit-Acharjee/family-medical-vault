# Next ready task — source-linked confirmed trend charts

LAB-01/02/03 and UX-05/06. Build only on the freshly authorized current per-set result; never form a series from matching unconfirmed labels. No migrations, hosted writes, external processing or new dependency anticipated.

1. Prepare a pure bounded plot projection: exact decimal arithmetic for ordering/scaling, preserve raw values, only exact ISO calendar days on time axis. Qualified/text results and unknown/unparsed dates stay in a source-linked table with explicit exclusion reasons. No threshold conversion, date inference or interpretation.
2. Render one selected confirmed set with semantic SVG and readable table alternative; actual numeric axes with unit and date range, source-specific reference strings, visible comparability limits. Keep differing raw reference intervals per source instead of inventing one shared band. Do not invent abnormal flags or clinical meaning. Source/version invalidation hides the entire trusted series; withdrawal stops trusted use.
3. Test precision/extreme decimals/equal values/duplicate dates/qualified limits/date gaps/source versions, keyboard/source navigation, both themes/narrow layouts/axe and access revalidation. Reuse existing presentation and current read path. No approved Overview changes.

Native workers remain quota-limited; continue available supervisor work without OpenCode fallback. Before adding a chart library, seek explicit dependency approval; a small native SVG should be sufficient for the bounded 2–20 member set.

## Delivery

Implemented and verified; see `p4-trend-chart-report.md`. Next manual-reading authority decision and preparation are in `p4-manual-readings-plan.md`.
