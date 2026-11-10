# Family Medical Vault — UX Flows & Accessibility

**Status:** FINAL — v2.0  
**Canonical owner:** This file owns `UX-01` through `UX-06` and the canonical task flows.  
**Related documents:** `docs/design/design-system.md` (visual tokens and component styling), `docs/design/screen-spec.md` (screen layout and presentation), and relevant domain/security documentation (authorization and business rules).

> **Documentation boundary:** This file defines *how users complete tasks*. Do not duplicate the full theme palette, page layouts, or domain authorization rules here. If conflicts arise, preserve the security and product requirements and flag the conflicting documentation rather than inventing behavior.

## UX-01 — Classy restraint with a distinct identity

**Requirement:** Deliver a premium, clean, low-noise interface with deliberate typography, clear visual hierarchy, restrained color, subtle layered surfaces, and concise Lucide outline icons. Use the approved **Arctic Blue** light theme and **Obsidian & Electric Blue** dark theme. The electric/cobalt accent is selective, not an excuse for colorful cards or prominent decorative effects.

**Acceptance checks:**
- Primary action, patient context, and relevant content are visually distinct without competing highlights.
- No promotional gradients, neon decoration, arbitrary color palettes, emoji navigation, gratuitous animation, or meaningless dashboard statistics.
- Empty states are compact, actionable, and do not repeat the same instruction excessively.
- Existing functionality is preserved during visual updates.

## UX-02 — Theme consistency

**Requirement:** **Arctic Blue is the default light theme** and **Obsidian & Electric Blue is the dark theme**. Both themes share identical information architecture, interaction semantics, content, and accessible state indications. Support explicit user choice; optionally honor system preference when no choice has been saved, while retaining the approved initial light default.

**Acceptance checks:**
- All principal pages and interaction states work in both themes without hiding or rearranging information merely because a theme changed.
- Focus, hover, active, disabled, pending, error, and verification states are legible in both themes.
- Semantic status is never conveyed by color alone; typography and contrast satisfy the WCAG 2.2 AA target.
- No legacy graphite-monochrome or teal-first token values remain as competing canonical themes.

## UX-03 — Low-friction upload

**Requirement:** Upload is globally discoverable and prominent. A user first selects the target patient (or uses a clearly indicated current patient), chooses files or camera capture, and can save originals without completing a medical-intake form. Extraction and clinically sensitive verification happen afterward, with deferred/batch review where applicable.

**Acceptance checks:**
- A supported medical document can be uploaded without manually entering doctor, diagnosis, category, consultation notes, or other nonessential metadata.
- The target patient is clearly identified before the file is committed.
- UI distinguishes uploading, stored/ready, processing, pending verification, failed, and retryable states; a successful upload is not claimed before storage and metadata commit.
- OCR/AI failure does not remove or make the original document unavailable.

## UX-04 — Responsive and discoverable navigation

**Requirement:** Desktop uses a compact, optionally expandable icon rail with accessible text labels. Mobile uses labeled bottom navigation for the most-used destinations. The current-patient switcher, search, and upload remain readily discoverable. Avoid relying on hover or hidden gestures for essential actions.

**Acceptance checks:**
- Primary destinations — Overview, Documents, Trends, Medications, and Family — are reachable on mobile without hover.
- Patient context is visible when viewing or acting on patient-scoped data.
- Navigation, previews, and forms remain usable on narrow screens and at 200% zoom, without clipping medical units or critical actions.
- Theme selection is accessible without disrupting user work.

## UX-05 — Accessible and honest application states

**Requirement:** Target WCAG 2.2 AA, keyboard and screen-reader operability, visible focus, reduced-motion support, readable labels, and approximately 44 × 44 px mobile touch targets. Use explicit loading, empty, denied, offline/unavailable, error, pending-processing, and success states. Do not present placeholder data as real medical information.

**Acceptance checks:**
- Critical flows are operable by keyboard and assistive technology.
- Focus order and accessible names are meaningful; errors identify actionable recovery steps without exposing sensitive content.
- At 200% zoom, essential information and actions remain accessible.
- Sensitive health information is not exposed in toast previews, notifications, or persistent offline caches by default.

## UX-06 — Clinical clarity and traceability

**Requirement:** Wherever medically consequential, show the source document, verification status, measured value, unit, date/time, and applicable reference context. Clearly distinguish user-entered, extracted/unverified, verified, and unavailable information. Never sacrifice important clinical context to make a card look cleaner.

**Acceptance checks:**
- Trend views preserve units, dates, source traceability, and comparability notes where relevant.
- Summaries distinguish verified findings from unverified extraction and do not fabricate diagnoses.
- Users can reach the source of any material extracted value or summary statement.
- Color is never the only indicator of abnormal, pending, or verified status.

---

## Canonical task flows

These flows specify the minimum interaction sequence and expected behavior. The corresponding domain documentation defines business rules and authorization. `screen-spec.md` defines each screen's presentation.

### F-01 — Select patient and establish context
1. Open the application and show the current patient context, or an accessible **No patient selected** state.
2. Open the patient switcher and list only profiles the user may access.
3. Select a profile and visibly update patient-scoped search, documents, trends, medications, and actions.
4. Before upload, deletion, export, or sharing, clearly show which patient is affected.

**Guardrails:** Never silently switch to a different patient; do not imply access to profiles the user is unauthorized to view.

### F-02 — Upload and classify medical documents
1. Confirm the target patient.
2. Choose supported files or capture a document using the mobile browser camera.
3. Upload and persist the original document and its required metadata.
4. Clearly display **stored/ready**, **processing**, or actionable failure status.
5. Extract text and propose classification/metadata asynchronously or when processing is available.
6. Request verification only for clinically sensitive extracted facts; support deferred or batch review.

**Guardrails:** No mandatory consultation-intake wizard. A failed extraction does not invalidate a successfully stored original. Retry safely without duplicate documents.

### F-03 — Search and inspect records
1. Select a patient.
2. Search or filter authorized records by available metadata and extracted text.
3. Open a secure document preview.
4. Show available source-linked observations, classification, and verification status.
5. Allow only actions covered by current permissions.

**Guardrails:** Deleted or unauthorized documents must not appear in active results. Do not expose medical content through public URLs or analytics.

### F-04 — Caregiver requests and grants
1. Choose the relevant patient profile.
2. Initiate a caregiver invitation or access-request link through the approved route.
3. Show the exact requested access scope, identity context, and any expiry.
4. Require approval by the patient or properly authorized representative before access is granted.
5. Show the resulting access grant and record the event in the audit history.
6. Allow authorized revocation; block subsequent access using current permissions.

**Guardrails:** Opening a request link does not grant access. No automatic administrator access to patient records.

### F-05 — Share or export documents
1. Select patient and document(s) or summary scope.
2. Choose approved export or temporary-link sharing behavior.
3. Clearly display access method, scope, expiry, and recipient information where applicable.
4. Confirm the action and enforce current sharing/export permission.
5. Create the export or link and audit relevant activity.
6. Permit revocation of outstanding links; explain that previously downloaded copies cannot be revoked.

**Guardrails:** Never share the entire patient vault implicitly when a limited selection was intended.

### F-06 — Delete, recover, and purge
1. Identify the target patient and document.
2. Explain the effect of deletion, including removal from normal search and sharing.
3. Confirm deletion; move the document to protected Trash for **30 days**.
4. Immediately invalidate active search results, derived displays, and affected share links.
5. Permit authorized recovery during the 30-day period.
6. At expiry, purge primary file and derived medical data according to the retention policy; apply deletion and revocation reconciliation during disaster recovery.

**Guardrails:** Deletion does not silently erase unrelated patient data. Do not promise that existing backups or downloaded copies disappear immediately.

### F-07 — Review extracted medical data
1. Open pending-review items for the selected patient.
2. Show extracted information beside an accessible source reference.
3. Identify uncertainty and clinically sensitive fields such as dosages, diagnoses, and lab values.
4. Confirm or correct the necessary fields; allow deferral where permitted.
5. Only verified facts may drive trusted downstream clinical views and summaries.

**Guardrails:** Do not require verification of harmless metadata just to access the original document.

### F-08 — Review account access and activity
1. Open patient-scoped Family Access or Security Activity.
2. Display current caregiver grants and meaningful document-access events within the approved retention window.
3. Allow authorized changes to access scope and revocation.
4. Keep critical security-event access and retention controlled separately.

**Guardrails:** Ordinary patient-visible document-access history is retained for **90 days**. Audit views never disclose another patient's unauthorized information.

---

## Cross-screen invariants

- **Patient-first context:** Every patient-scoped screen is bound to the explicitly selected, authorized patient.
- **Privacy-first:** Never publish patient content to public storage, notification previews, telemetry, or third-party AI without approved consent and access rules.
- **Meaningful states:** Loading, no access, empty, unavailable, pending processing, and failure are separate states with appropriate recovery actions.
- **Source before inference:** Clinically important output must be distinguishable from verified source data.
- **One coherent design system:** Use `design-system.md` for Arctic Blue / Obsidian & Electric Blue tokens and component styling; do not duplicate theme palettes here.
- **Incremental migration:** Existing screens and flows already built through roadmap milestone **P1.2** must retain working behavior while styling is updated. Do not restart completed phases merely to apply the new theme.
- **Out of scope:** No consultation-intake forms, medical finance/insurance module, decorative analytics, or unnecessary multi-step wizards.

## UX acceptance checklist for Codex

- [ ] Correct patient context is visible and enforced.
- [ ] Both approved themes render all meaningful states legibly.
- [ ] Keyboard, focus, contrast, touch, reduced motion, and zoom checks pass.
- [ ] Upload remains low-friction and persists the original before claiming success.
- [ ] Search, sharing, caregiver approval, deletion, and verification obey existing domain permissions.
- [ ] Medical values retain source, units, dates, and verification status where relevant.
- [ ] Theme updates do not alter routes, API contracts, business logic, or already completed roadmap behavior.
- [ ] No new feature is introduced merely to improve visual density.
