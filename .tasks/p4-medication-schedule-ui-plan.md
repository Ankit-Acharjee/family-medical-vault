# MED-04 — informational schedule owner interface

Standing workflow approval and the approved owner/read/source lifecycle apply. Implement only the existing Meds route's schedule dialog and directly required components/guards; reuse approved theme tokens, accessible primitives and protected resource/write lifecycle. Native workers remain quota-limited; supervisor continues without OpenCode substitution.

1. Add a guarded schedule action per medication, authoritative current medication identity in schedule context, literal/explicit-clock editing, named-zone/day/time/date controls and human-readable preserved versions. Do not parse prescription frequency or infer a clock time, medication status or dose.
2. Separate explicit record/edit/re-review from retirement. Preserve retired state after source changes, keep latest/current distinct from paginated history and require confirmation for all writes. Allow unchanged retirement under the approved backend rule without reactivating stale content.
3. Preserve clock/literal drafts through same-context checks, hide protected fields until revalidated, clear on lost access/context, seal uncertain retries and pending dismissal, handle validation/conflict/lost acknowledgements and restore focus on success without reloading unchanged medication rows.
4. Test synthetic actual-browser success, denial, source invalidation/review/retirement, empty/error/retry, focus/scroll, limits, both themes and narrow widths. Inspect screenshots, run unit/native/API checks for context changes plus existing medication browser regressions, then commit/push. No dependency additions, Overview redesign, live clinical fixtures or reminder delivery.

Completed and verified: see `p4-medication-schedule-ui-report.md`. Separately approved development migration25 is applied/postflight-verified. Reminder scope and daylight-saving occurrence handling were separately approved; no reminders are enabled by this UI slice.
