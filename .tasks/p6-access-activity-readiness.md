# SEC-03 / SEC-04 — Ordinary access activity readiness

Activation UI is delivered in 74ae014 on develop; development migrations through30 are applied and verified. Next independent roadmap slice is ordinary patient-visible document-access history (screen-spec §7, ux-flows F-08). This does not complete critical-event visibility or its separately controlled retention.

## Existing evidence and bounded plan

- DocumentEvent stores patient/document/actor references, event kind, occurrence and90-day retention deadline; only retention is indexed. `document.viewed` includes saved text/metadata/search disclosures, so wording must not falsely imply original-byte viewing. `document.exported` means original access for export, not confirmation of saving a copy.
- TemporaryLinkAccessEvent separately records anonymous `link.opened` and `original.accessed`; do not attribute these to the issuing owner or identify a recipient. Existing per-link activity is already available, separately owner-authorized.
- AccessEvent/activation/security ledgers are critical history, excluded from this initial ordinary slice. No audit editing/deleting UI, invented outcomes, clinical values, provider identity subjects, secrets or original bytes.
- First implementation should be a bounded chronological patient feed with strict cursor validation, current ownership checks before and after disclosure, and database-clock filtering of both event age and retention deadline. Index requirements need query-plan validation before introducing a migration.
- Current resource labels may be resolved only from same-patient authorized document registry; never persist historical clinical titles in audit. Prefer safe actor categories (You / authenticated account / anonymous link holder) rather than provider email/subject or unverified identity claims. Do not create recursive document-view events merely by inspecting audit history.
- UI belongs in existing patient-scoped Family Access/Security Activity, using canonical theme/shared primitives; preserve Overview and all existing workflows. Include loading/empty/error/retry, stale-context abort, denial clearing, safe pagination and focus, desktop/mobile both themes.

## Approved policy

User approved explicit Person-owner-only initial aggregate activity access on19 November. Delegate activity access remains deferred; no read authority is inferred from View/Manage. Canonical security/access-control.md records this decision. Implementation and verification are recorded in p6-access-activity-report.md.

## Verification matrix

Owner positive; wrong patient/managed caregiver/document-only and expired/revoked grant negative according to approved authority; malformed cursor; same-time ordering; cross-patient resource joins; expired/future events; no false download receipt; anonymous attribution; database failure and ownership change; no content/secrets in response/logs; context change/focus revalidation/retry; responsive accessibility in both themes. Production physical90-day purge scheduling remains an operational release gate, not satisfied by response filtering.

Native worker quota remains unavailable until21 November; supervisor proceeds without OpenCode or fabricated independent review. Any new hosted migration retains separate explicit approval.
