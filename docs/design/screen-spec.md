# Family Medical Vault — Screen-by-Screen UI Specification

**Status:** FINAL visual/UX guidance; incremental adoption during active development.  
**Version:** 1.0 (2026-11-05)  
**Dependencies:** [`design-system.md`](./design-system.md), approved SRS and roadmap.  
**Theme:** Arctic Blue light / Obsidian & Electric Blue dark.  
**Important:** P1.2 is already complete. **Do not reimplement completed features, invent API contracts, or treat future screens as currently functional.** Apply these patterns when each existing or upcoming screen is touched.

## 0. Common screen framework (all authenticated routes)

- **Header:** selected patient/context (or explicit none), page title, one primary action where relevant, account/theme menu. On small screens keep compact; avoid toolbar overflow.
- **Navigation:** desktop labeled/tooltip icon rail; mobile five-item labeled bottom bar (`Home`, `Docs`, `Trends`, `Meds`, `Family`), clear active state and safe-area padding.
- **Content:** mobile single column, tablet adaptable, desktop bounded readable panels plus wider tables as needed. Consistent vertical rhythm and semantic page headings.
- **System states:** loading skeleton, empty, error, access denied, processing pending, network unavailable, success. No invented medical data or demo counts on real accounts.
- **Patient scope:** show whom an action affects before upload, edit, delete, export, share or caregiver change. If patient scope missing, keep dependent actions disabled with actionable explanation.
- **Never:** embed clinical text in a notification preview, permanently cache a protected document, or imply OCR output is verified.

## 1. Overview (`Home`)

**Job:** Answer *whose profile am I viewing?* and *what should I do next?*

**Composition:** compact patient switcher and upload header → balanced global search (patient-scoped) → page title → either concise no-patient callout **or** meaningful recent-record content → secondary sections from available data.

**No patient selected:**
- Header explicitly says `No patient selected`.
- Use a *compact hero* with soft blue-tinted surface, short heading (`Choose a patient to get started`), one `Select patient` CTA and brief supporting copy. Optional understated medical-folder illustration; must not dominate on a phone.
- Search may be visible but explains that a patient is required; no fake results. `Upload` requires an authorized target patient and must prompt for selection rather than silently attributing files.
- Do not add empty trends cards, fake record counts, or meaningless dashboards.

**Patient selected (only when source data is present):**
- Recent medical documents first (name/type, date, verification if available, accessible link).
- Pending verification callout when actual tasks exist.
- Compact trend/medication snapshots **only where corresponding functionality/data is implemented**; otherwise omit rather than fill with samples.
- One global upload CTA; no second equally prominent primary button.

**Mobile:** prioritize header → search → recent docs or concise empty state; keep bottom navigation fixed only if it doesn't cover content.

**Acceptance:** no huge empty-state headline; no duplicated select-patient prompts; correct patient scope; usable on 320–390px widths; all four theme/viewport screenshots pass.

## 2. Documents (`Docs`)

**Job:** Find, understand, upload and manage source medical files.

**Composition:** title + patient context + upload CTA → search/filter controls → document list → selected document detail/preview.

- Search scoped to authorized patient; filter chips or dropdowns for supported type/date/verification fields only. Don't invent categories not present in schema.
- Desktop: accessible structured rows with document name/type, report/upload dates where known, extraction/verification state, safe actions.
- Mobile: stacked rows, predictable tap region, menu for secondary actions; avoid side-scroll tables for normal documents.
- Document detail: large preview and metadata panel; show original report faithfully. Indicate source, category, processing status, verification.
- Upload: accept authorized patient selection, support single/bulk files as implemented, progress of **upload vs processing separately**, clear retry and failure states. Don't require doctor/consultation metadata up front.
- Trash: distinguish soft deletion/30-day recovery from permanent purge; never display deleted files in normal search.
- Security: only expose actions user is granted; no optimistic authorization in UI as substitute for backend checks.

**Acceptance:** user can tell if file is stored even when OCR fails; no accidental cross-patient upload; row and preview accessible both themes.

## 3. Document processing & verification

**Job:** Make machine extraction trustworthy without making uploads tedious.

- Display original file context beside suggested metadata/clinical fields wherever feasible.
- Give each field a clear status: `Suggested`, `Needs review`, `Verified`, `Failed` (only for statuses the actual data model supports).
- Group high-risk fields (diagnoses, lab values, dosages) for efficient batch review; keep low-risk suggestions lightweight.
- Source and original excerpt reference whenever available. Don't silently save clinical suggestions as confirmed.
- Permit deferral and return later; no mandatory per-file form just to complete original storage.
- On mobile, use stacked detail sections instead of side-by-side panes; a clear sticky confirm action only when changes are pending.

**Acceptance:** unverified data never looks identical to verified clinical data; review actions respect authorization; source remains accessible.

## 4. Health Trends (`Trends`)

**Job:** Understand longitudinal measurements with correct units and provenance.

**Composition:** patient context → available measurement picker/search → one clear chart or result timeline → supporting result list/details.

- One main metric per chart by default. Dates on x-axis, values/units on y-axis, source-linked points and visible selected range.
- Reference intervals are shown only when present and comparable. Avoid combining noncomparable methods/units without explicit conversion or caveat.
- Distinguish verified, provisional and manually entered data visually **and** through textual labels/legend.
- Blank state when no trusted measurements; don't generate example clinical data.
- Mobile: stacked chart and vertically scannable data rows, horizontal gestures optional but not required for accessibility.
- Use primarily neutral/blue visual language; semantic warning colors only for source-grounded abnormal flags, not AI inference.

**Acceptance:** no clipped units/dates, no fabricated interpretation, a readable tabular alternative to chart information.

## 5. Medications (`Meds`)

**Job:** Show current medication context and recorded prescription history accurately.

**Composition:** patient context → current medication list → optional schedule/refill/expiry alerts backed by records → medication history.

- Medication rows: name, recorded dosage/instructions when verified, source, start/end or status if known. Distinguish current from historical clearly.
- Prescription extraction suggestions remain reviewable; unknown/uncertain frequency or dose must not appear confirmed.
- No dose-taking check-in interface or caregiver adherence dashboard (out of scope for this web-first version).
- Actions such as edit/discontinue require permission and confirmation proportionate to consequence; don't present AI-generated clinical advice.
- Empty state: concise explanation and link to upload a prescription or record medication by approved workflow.

**Acceptance:** no false reminder guarantees from the browser; accessible current/history distinction; patient scope obvious.

## 6. Family / Access (`Family`)

**Job:** Manage authorized patient profiles and caregivers transparently.

**Composition:** patient/profile selector → accessible list of profiles the signed-in user is entitled to see → patient-specific caregiver grants/requests → clear add/manage actions.

- Each profile card/list row identifies the person and relationship/role *only where actually recorded*; never expose a public patient directory.
- View granted permissions as human-readable scopes, expiry, and revoke action.
- Invite caregiver/request access: explain who is requesting, whose records, what scope, who approves; links alone never grant access.
- Revoke: explicit target, effect and confirmation; current permissions enforced server-side immediately.
- Managed person activation and identity reconciliation are guided security-sensitive flows, not simple name/DOB matching.
- On mobile prefer clear list-to-detail progression, avoid nesting multiple dialogs.

**Acceptance:** no accidental permission escalation; easy to find active grants and revoke access; masked private contact data where needed.

## 7. Security Activity / Audit

**Job:** Give the patient understandable transparency into account/record access.

- Chronological event feed using meaningful verbs: Viewed, Downloaded, Shared, Grant changed, Link revoked, etc., only for events that occurred.
- Show actor, event time, affected resource label where authorized, outcome; do not embed diagnosis, medication or document contents in audit entries.
- Ordinary document-access history follows approved **90-day** retention. Critical security events follow their separate controlled policy.
- Filters by category/time only if supported; never invent events.
- No caregiver editing/deleting audit logs. Operator-only technical metadata isn't shown as patient health detail.

**Acceptance:** accessible feed, appropriate actor/context, no disclosure through previews or to unauthorized users.

## 8. Sharing / Export

**Job:** Share the minimum intended information with clear controls.

- Selection first: patient, document(s) and/or summary, recipient/access mode, scope, expiry.
- Explain that downloaded files cannot be revoked even when links can.
- Temporary links show current status and revoke action; never show or expose tokens in analytics/logs.
- Export operation should report progress and failure clearly; no false success.
- External recipient should see only the expressly shared resources, not vault navigation.

**Acceptance:** patient and selection confirmed before generation; link expiry/revocation visible; no unintended data sharing.

## 9. Emergency Profile / QR

**Job:** Provide a limited optional emergency view without exposing the vault.

- Default **private/off**. Explain exactly what a QR recipient could see before enabling.
- Preview the minimal selected fields; opt-in and revoke always accessible.
- Emergency external screen must be minimal and privacy-conscious. No access to full documents or broader patient profile by inference.

**Acceptance:** opt-in explicit and revocable; no default public emergency card.

## 10. Settings / Account / Theme

**Job:** Account self-service and clear privacy controls.

- Sections: Account & sign-in, Theme, Security, AI consent, data/export/deletion controls according to implemented scope.
- Theme chooser: `Light — Arctic Blue`, `Dark — Obsidian`, `System` (where supported). Default light; maintain selection across routes.
- AI settings: external processors **off by default**; disclose provider, purpose, data category and safeguards before consent.
- Account deactivation and patient-profile deletion are distinct operations; consequences clearly stated.
- No default admin ability to read all patient medical data.

**Acceptance:** visible focus, predictable settings navigation, reauthentication for high-risk changes where required.

## 11. Authentication / Onboarding / Activation

**Job:** Secure, low-friction entry; separate login identity from patient identity.

- Clean, centered form panel with strong title and clear Google or verified email/password options. No unnecessary onboarding steps or decoration.
- Error, verification pending, expired link and account recovery states are specific and actionable but do not enable identity enumeration.
- Managed-profile activation link: authenticated recipient, single-use expiry, secure proof and explicit existing-profile linking; never assume matching name/DOB is enough.
- Preserve the existing Person ID when activating a managed profile.

**Acceptance:** keyboard accessible, mobile-friendly, correct error masking, no public patient data in login responses.

## 12. App-wide responsive layouts / state matrix

For every route, QA should check these dimensions:

| Dimension | Required checks |
|---|---|
| Theme | Arctic Blue light; Obsidian dark |
| Width | 320–390px phone; 768px tablet; 1280px+ desktop; 200% zoom |
| Data | No patient; no records; populated; many records |
| Network | Loading; slow; offline/unavailable; retryable error |
| Permissions | Owner; granted caregiver; insufficient permission; revoked mid-session |
| Processing | Original stored; OCR pending; OCR failed; clinical data unverified; verified |
| Privacy | Patient switch; deleted record; export/share; AI consent; sensitive confirmation |

**Don't fabricate unavailable API responses to produce “complete-looking” screens.** Use clearly segregated story/demo fixtures only in development and tests, and never ship them as if they were real medical data.

## 13. Codex implementation guardrails for existing P1.2 code

1. Read current root `AGENTS.md`, SRS and these two design docs, **then inspect actual components and routes**. Do not assume file paths or component names from this document.
2. Inventory existing pages/components and identify **styling changes versus behavior changes**. Deliver the former first.
3. Introduce/verify semantic theme variables and migrate existing shared components. Avoid introducing new libraries or parallel component families.
4. Preserve routes, API calls, state machines, forms, schema types, authorization checks, labels and tests. New feature work remains governed by the roadmap.
5. Adjust only high-impact layout issues observed in current UI: oversized empty-state panels, flat hierarchy, weak CTA and active navigation, cramped mobile header, undifferentiated cards.
6. Apply appearance updates in small PRs per shell/component/screen, with before/after light and dark screenshots at mobile and desktop sizes.
7. Run lint/typecheck/tests and manual interaction/contrast checks. Don't mark complete if a link/button remains broken or focus/zoom regressions appear.
8. If a screen is not implemented yet, treat its section as **design guidance for its roadmap phase**, not authorization to build it early.
9. If a screen spec conflicts with finalized SRS or security policy, **follow the SRS/security** and flag the conflict rather than inventing a workaround.

## 14. Screen-level visual acceptance checklist

- [ ] Page communicates patient context and purpose within first viewport.
- [ ] One main action is obvious; no repeated competing CTAs.
- [ ] Palette, iconography, typography and radii come from the canonical tokens.
- [ ] Mobile and desktop views preserve identical meanings and secure permissions.
- [ ] No huge empty-state headline or filler cards on no-data pages.
- [ ] Clear loading, denied, error, retry and processing status.
- [ ] No contrast, focus, zoom, overflow or keyboard-navigation regressions.
- [ ] Source, units, dates and verification status visible wherever clinically relevant.
- [ ] Existing functionality is intact and no unapproved features introduced.
