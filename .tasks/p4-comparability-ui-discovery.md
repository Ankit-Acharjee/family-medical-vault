# Next dependency — comparison discovery and owner UI

The backend foundation provides per-set confirm/read/withdraw endpoints. It does not yet expose a finished Trends workflow. Migration20 was separately approved and applied with all20 checksums and restricted-role postflight verified; no further policy question is needed for the already approved explicit owner comparability rule.

1. Build bounded current verified-measurement discovery under current per-document View, preserving exact source/review/lifecycle refs. Do not fetch all full extraction texts or assume patient membership grants access. Disclose incomplete coverage without counts from denied resources.
2. Add discoverability for current comparison sets, authorizing every disclosed member. Avoid silent partial sets or fallback to older confirmations. Plan owner metadata-only access for withdrawal of unavailable sets without exposing trashed clinical contents; keep ordinary delegate reads strictly all-member View.
3. Reuse the approved Trends composition and existing Radix/shadcn primitives for owner selection, literal compatibility explanation, explicit confirmation, pending/retry/conflict and stale-source refresh. Known conflicts remain unsupported without reviewed conversion; unknown fields remain visibly unknown. Delegates receive read-only access when fully authorized. No automatic group or chart is created from matching labels.
4. Verify real desktop/mobile flows in both themes, keyboard/focus, patient switching, permission expiry/revocation, source/clinical withdrawal and Trash/Restore. Native workers are currently quota-limited; continue supervisor planning or available authorized native execution, with no OpenCode fallback or invented final model review.

Actual chart rendering is a subsequent integration: numeric precision, qualified/text results, date precision, source-specific references and a readable tabular alternative must remain explicit. Existing hard-delete retention constraints and the full P6 purge/backup workflow remain separate work.

## Delivered follow-up

The bounded workspace and existing Trends owner workflow are implemented; see `p4-comparability-ui-report.md` for actual verification and limits. Current ordinary discovery excludes unavailable/trashed sets; metadata-only owner discovery remains separate. The next ready dependency is chart projection/rendering from current explicitly confirmed sets, with raw values and per-source reference context retained.
