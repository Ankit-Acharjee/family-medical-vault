# Next dependency — owner manual-reading interface

The owner-only contract/API/database foundation is prepared separately. Its development migration requires explicit hosted-write approval before actual hosted verification. No manual-reading UI is claimed as delivered by that foundation.

Reuse the existing Trends patient context, semantic tokens, Radix dialog, input/button primitives and the established focus/revalidation/request-identity lifecycle. Keep the approved Overview and laboratory comparison workflow unchanged. A separate manual-reading panel must clearly say “Manual / user-reported”, never laboratory verified; do not merge it into lab comparison sets.

- Patient-wide View is needed for this patient-level data. Category/document-only delegates may continue using their permitted documents/labs without seeing manual readings or losing the whole patient context merely because this panel is unavailable. The backend remains authoritative.
- Owner creates or corrects exact values with an explicit metric/unit and observation date/time plus visible, confirmed UTC offset. No guessed historical timezone, silent unit conversion or clinical “normal” threshold. BP has separate systolic/diastolic fields. Keep kind fixed for a reading identity; correcting values/unit/time appends a version. To correct the kind, withdraw the mistaken identity and create the intended one.
- Use bounded keyset paging for the current list; history pagination must retain the current state separately, so historical pages never become active values. Show withdrawal clearly; preserve history, do not create a deletion illusion or restore a terminal identity automatically.
- Explicit save/withdraw acknowledgement, captured CAS/idempotent request, fresh CSRF, no auto write retries, pending close protection, uncertain safe retry, conflict revalidation, success dismissal/feedback/focus. Preserve same-patient drafts while protecting contents during revalidation; clear on patient/session/authority loss.
- Verify actual desktop/mobile/both themes, narrow320px, long values/timezones/units, keyboard/axe, read-only delegates, category-only access, pagination/current/history distinction, correction/withdrawal, retry/conflict, focus and access changes. Use synthetic intercepted APIs for browser QA; no real records or external model fallback.

Manual charts/device imports/diagnostic interpretation/medication features are outside this interface slice. The current backend validation checks finite bounded representation, not clinical plausibility or medical accuracy.

## Delivered

Migration21 was separately approved/applied and metadata-verified. This interface is implemented and verified; see `p4-manual-readings-ui-report.md` for precise files, browser checks, screenshots and limits.
