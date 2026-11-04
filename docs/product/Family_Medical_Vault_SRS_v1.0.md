Version 1.0 \| 04 November 2026 \| Status: Approved requirements; implementation feasibility checks noted

A secure, minimal, web-first medical records vault for individuals and authorized family caregivers.

# Document control

| Document ID       | FMV-SRS-001                                                    |
|-------------------|----------------------------------------------------------------|
| Product owner     | Family Medical Vault                                           |
| Audience          | Product owner, developer, architecture reviewers, Codex agents |
| Approved design   | Adaptive monochrome: light default; graphite dark mode         |
| Approved backend  | NestJS TypeScript modular monolith                             |
| Approved frontend | React + Vite + TypeScript                                      |
| Database/auth     | Supabase PostgreSQL + Supabase Auth                            |
| Backup policy     | Weekly encrypted automated snapshots; rolling 90-day retention |
| Reference assets  | User-supplied dark desktop dashboard and monochrome mobile UI  |

# 1. Purpose & scope

This SRS specifies the confirmed behavior, constraints, acceptance checks and selected technical direction. Its MUST requirements are intended to drive design, implementation and testing without expanding product scope. Provider free-tier assumptions are subject to verification and do not override privacy controls.

## 1.1 Stakeholders and primary actors

Patients: own a permanent medical profile; caregivers: act within explicit delegated scopes; representatives: may approve where authorized; infrastructure operators: operate services without automatic right to patient records; guest share recipients: see only explicitly shared material.

## 1.2 Exclusions

Expense/insurance workflows, consultation audio/transcription and manual symptom/doctor note intake, hospital operations, native apps, compulsory dose adherence confirmations, autonomous diagnoses or prescriptions are out of scope.

# 2. System context & approved stack

| Layer           | Selected technology / rule                                                                                   |
|-----------------|--------------------------------------------------------------------------------------------------------------|
| Architecture    | Monorepo; modular monolith; \`apps/web\` and \`apps/server\`; shared \`packages/contracts\`; pnpm workspaces |
| Web             | React, Vite, TypeScript, Tailwind, shadcn/ui, Lucide React                                                   |
| API             | NestJS, TypeScript, REST + OpenAPI; Dockerized server                                                        |
| Database        | Supabase PostgreSQL and Supabase Auth                                                                        |
| Medical objects | Private Cloudflare R2                                                                                        |
| Web hosting     | Cloudflare Pages (static app)                                                                                |
| API hosting     | Oracle Cloud Always Free preferred; Render fallback (availability to verify)                                 |
| Email           | Resend preferred, Brevo fallback; verified sender domain unresolved                                          |
| Backups         | GitHub Actions scheduler candidate; provider-independent encrypted data and file archive                     |
| UX              | Minimalist adaptive monochrome: near-white light, polished graphite dark; low-visual-noise interactions      |

# 3. Detailed functional and non-functional requirements

Every requirement carries a stable identifier, normative behavior, and observable acceptance check. IDs are shared with the Codex documentation pack.

## Identity & Authentication

**AUTH-01 Open registration**

Requirement — Support Google OIDC and verified email/password registration.

*Acceptance — A user can create an account by either supported method; unverified email/password identities cannot access protected functions.*

**AUTH-02 Stable Person identity**

Requirement — Issue a provider-independent immutable Person ID separate from login identity and household membership.

*Acceptance — Medical records continue to resolve to the same Person ID after login provider changes or caregiver activation.*

**AUTH-03 Managed profiles**

Requirement — Authorized caregivers may establish profiles for people without login accounts.

*Acceptance — Creating a managed profile does not automatically create credentials or expose the profile publicly.*

**AUTH-04 Profile activation**

Requirement — Support expiring, single-use caregiver-issued activation links redeemed by an authenticated and verified claimant, with secure approval/identity reconciliation.

*Acceptance — Existing documents remain attached to the same Person ID; replay or expired link fails.*

**AUTH-05 Duplicate safeguards**

Requirement — Use private possible-duplicate signals, never name+DOB uniqueness or automatic merge; avoid account enumeration.

*Acceptance — Ambiguous identity matches require authorized review; two people with the same name and DOB can coexist.*

**AUTH-06 Account security**

Requirement — Secure sessions, token rotation/revocation, rate limits, verification, password recovery and optional stronger authentication.

*Acceptance — Signing out and forced session revocation prevent continued authenticated requests.*

**AUTH-07 Account/profile lifecycle**

Requirement — Keep login deactivation separate from Person/profile deletion and reconcile individually registered and managed profiles securely.

*Acceptance — Disabling credentials does not automatically delete medical history.*

## Patient & Caregiver Permissions

**ACCESS-01 Private by default**

Requirement — Patient profiles and files are never publicly discoverable or accessible by default.

*Acceptance — Unauthenticated and unauthorized users cannot list, infer or retrieve patient records.*

**ACCESS-02 Two-way invitations**

Requirement — Patients can invite caregivers; caregivers can request access by a secure link.

*Acceptance — Opening a request link alone never grants access.*

**ACCESS-03 Explicit authorization**

Requirement — Patient or properly authorized representative approves requested patient-specific scope.

*Acceptance — Approval is a logged explicit action and scope is shown in plain language.*

**ACCESS-04 Granularity**

Requirement — Support scoped view, upload, edit, export and manage grants with patient/category/document restrictions; expiry and revocation.

*Acceptance — A read-only caregiver cannot download/export if that ability is excluded.*

**ACCESS-05 Immediate revocation**

Requirement — Each sensitive operation checks current authoritative grants; revoke related application share access where applicable.

*Acceptance — An old session or token cannot access after a grant is revoked.*

**ACCESS-06 Administrative separation**

Requirement — Infrastructure administrators have no default application-level entitlement to medical files.

*Acceptance — Admin account with no patient grant fails ordinary patient-document API access.*

**ACCESS-07 Cross-household identity**

Requirement — Persons can participate in multiple family groups without granting cross-group access.

*Acceptance — Joining a household does not reveal other members’ private medical files.*

## Document Vault & Organization

**DOC-01 File intake**

Requirement — Upload individual/multiple PDFs and common image formats from desktop or mobile camera without required classification forms.

*Acceptance — A supported file can be submitted with no doctor, diagnosis or encounter entered.*

**DOC-02 Private originals**

Requirement — Preserve original binary content in a private object store with random opaque keys and integrity checks.

*Acceptance — Downloads reproduce the originally stored file and are authorized per request.*

**DOC-03 Automatic organization**

Requirement — Extract/suggest type, dates, provider and labels; maintain search across individual records.

*Acceptance — Unclassified documents remain findable and previewable.*

**DOC-04 Hybrid grouping**

Requirement — Optionally infer links to encounters, related documents or episodes; do not require user-curated encounters.

*Acceptance — User can access every independent document even if no grouping exists.*

**DOC-05 Timeline & search**

Requirement — Offer metadata/full-text searching when extracted and a chronological history with filters, source context and per-person boundaries.

*Acceptance — Search results never include another patient without a valid grant.*

**DOC-06 Deduplication**

Requirement — Detect potential duplicate uploads and related pages without silently removing distinct originals.

*Acceptance — Potential duplicates are surfaced non-destructively.*

**DOC-07 Upload integrity**

Requirement — Use recoverable, idempotent upload lifecycle and safe compensation for partial failures.

*Acceptance — A failed metadata transaction cannot display file as READY or create duplicate active items on retry.*

## OCR, Extraction & AI

**AI-01 Browser-first extraction**

Requirement — Parse embedded PDF text and use local/browser OCR for scans where feasible.

*Acceptance — Core file saving and opening work when text extraction is unavailable.*

**AI-02 Provisional output**

Requirement — Store suggested classification and extracted medical facts with confidence/source, never silently promote clinical values to verified.

*Acceptance — Unreviewed dose, diagnosis and lab values are labeled unverified and excluded from trusted automation.*

**AI-03 Risk-based verification**

Requirement — Provide targeted and batch verification for high-risk extracted values with minimum form friction.

*Acceptance — A user can defer reviewing a batch and still retrieve originals.*

**AI-04 External AI consent**

Requirement — External provider processing is disabled by default and requires explicit scoped patient/delegate opt-in and vetted privacy conditions.

*Acceptance — No document payload leaves approved infrastructure absent valid consent and provider policy.*

**AI-05 AI boundaries**

Requirement — AI results are untrusted, source-linked assistance; no autonomous permission changes, sharing, diagnosis or prescribing.

*Acceptance — Prompt instructions inside documents cannot alter authorization or account settings.*

**AI-06 Resilience**

Requirement — Processing jobs are retryable, idempotent and cannot republish deleted content.

*Acceptance — An OCR failure leaves the original safely stored; deleted resources stay absent.*

## Laboratory & Observations

**LAB-01 Structured measurements**

Requirement — Capture analyte, value/type, unit, specimen/method where known, reference interval, date, lab and source document.

*Acceptance — Measurement provenance and original representation remain accessible.*

**LAB-02 Verification**

Requirement — Separate provisional extraction from verified clinical observations.

*Acceptance — Only verified values power trusted trends and patient summaries.*

**LAB-03 Trend accuracy**

Requirement — Graph comparable time-series with units, differing reference ranges and explicit comparability limits.

*Acceptance — Incompatible units or methods are not silently combined.*

**LAB-04 Manual readings**

Requirement — Support clearly labeled manual vital measurements including BP, weight, pulse and glucose.

*Acceptance — Manual entries remain distinguishable from laboratory reports.*

**LAB-05 Future imports**

Requirement — Use replaceable data ingestion interfaces for potential wearable/device sources without initial native app requirement.

*Acceptance — Baseline works without third-party health connectors.*

## Medication & Prescription History

**MED-01 Medication lifecycle**

Requirement — Maintain current and historical medication entries, doses, frequencies, start/end, changes and source prescriptions.

*Acceptance — Changes preserve prior medication history and verification state.*

**MED-02 Extraction reconciliation**

Requirement — Parse prescription medication fields as proposed data requiring safety-sensitive review.

*Acceptance — Unreviewed dosage extraction is not treated as an active verified regimen.*

**MED-03 Inventory**

Requirement — Support optional quantity, expiry and refill information with low-friction entry.

*Acceptance — Inventory tracking is optional and does not block prescription upload.*

**MED-04 Schedules**

Requirement — Provide informational medication schedules and lightweight web reminder affordances without promising dependable background delivery.

*Acceptance — No dose-confirmation obligation is created.*

**MED-05 Boundaries**

Requirement — No autonomous prescribing, per-dose adherence dashboard or native-only monitoring in initial scope.

*Acceptance — UI does not present an AI recommendation as a prescription.*

## Summaries, Emergency & Sharing

**SUM-01 Grounded summaries**

Requirement — Generate patient, medication, lab and period-specific summaries from verified source-linked facts and clearly labeled patient-reported data.

*Acceptance — Every consequential summary point can be traced to a record; missing data remains unknown.*

**EMG-01 Emergency profile**

Requirement — Maintain a private emergency overview and optional minimal opt-in revocable emergency QR exposure.

*Acceptance — QR access displays only explicitly selected fields and stops after revocation.*

**SHARE-01 Exports**

Requirement — Provide selected-record PDF/ZIP exports and clinician-useful summaries subject to export permission.

*Acceptance — Exports contain only the selected authorized patient data.*

**SHARE-02 Temporary links**

Requirement — Allow scoped, expiring and revocable sharing links with access events.

*Acceptance — Revoked or expired links stop serving content; downloaded copies cannot be recalled.*

## Security & Audit

**SEC-01 Encryption**

Requirement — Use TLS for transit and cloud-managed encryption at rest for database and private object storage.

*Acceptance — No public file URLs or unencrypted transmission of medical content.*

**SEC-02 Authorization enforcement**

Requirement — All sensitive operations enforce current patient/resource grants server-side, not solely a signed token claim.

*Acceptance — Cross-patient ID manipulation returns deny without leaking existence.*

**SEC-03 Audit visibility**

Requirement — Record patient-visible document views/downloads and permission, sharing, deletion and account changes; protect audit trail against tampering.

*Acceptance — Patient can inspect authorized activity without medical contents appearing in log records.*

**SEC-04 Audit retention**

Requirement — Retain ordinary document access history for 90 days; critical event retention separately controlled and justified.

*Acceptance — Standard access events age out according to policy; critical records have a separately defined retention class.*

**SEC-05 Privacy hygiene**

Requirement — Minimize logs, HTTP routes, object keys, client caches and analytics; never log document content or secrets.

*Acceptance — Application logs do not contain reports, diagnoses, credentials or signed URLs.*

**SEC-06 Sensitive operations**

Requirement — Short-lived one-time activation tokens, secure session cookies, reauthentication where warranted and abuse rate limits.

*Acceptance — Token replay and expired links are rejected and audited.*

**SEC-07 External processing**

Requirement — Consent ledger includes provider, processing purpose, data categories, scope, version and withdrawal.

*Acceptance — Disabling consent prevents new external submissions and triggers applicable processor deletion handling.*

## Deletion, Backup & Operations

**DEL-01 30-day trash**

Requirement — On deletion immediately hide from normal views, search, sharing and derived data; allow recovery for 30 days.

*Acceptance — Trash items do not appear in ordinary patient queries and may be restored by authorized users.*

**DEL-02 Purge propagation**

Requirement — After the recovery period purge primary originals, previews, indexes and derived clinical data, subject to valid legal exceptions.

*Acceptance — Purge job reports completion/failures across each storage surface.*

**DEL-03 Restore safety**

Requirement — Maintain separately protected deletion/revocation evidence and reconcile before re-opening restored services.

*Acceptance — Restoring old snapshots does not reactivate deleted files or revoked caregiver access.*

**BACKUP-01 Automated weekly backups**

Requirement — Independent scheduled cloud execution encrypts and verifies recoverable database plus matching file data.

*Acceptance — Weekly backup failure is detected; verified recoverable set includes DB and associated originals.*

**BACKUP-02 90-day retention**

Requirement — Retain encrypted weekly recovery points for rolling 90 days rather than a fixed eight-snapshot cap.

*Acceptance — Old backup recovery points expire by age and manifests show coverage dates.*

**BACKUP-03 Portable destination**

Requirement — Backup format is provider independent; independent cloud destination primary with configurable encrypted local adapter.

*Acceptance — Restore can be performed without the original cloud backup provider.*

**BACKUP-04 Restore drills**

Requirement — Periodically test file integrity, schema, permissions and clinically relevant links in an isolated environment.

*Acceptance — A restore drill produces an auditable verification outcome.*

**REL-01 Graceful degradation**

Requirement — AI, SMTP and OCR failures do not block core existing-document access; disk/quota failure stops new uploads safely.

*Acceptance — Existing authorized documents remain retrievable when AI is down.*

**REL-02 Operational alerts**

Requirement — Monitor quota, failed uploads, missed/failed backups and critical security events without storing medical content in telemetry.

*Acceptance — Operator receives actionable failures without medical data disclosure.*

## UX, Accessibility & Visual System

**UX-01 Classy restraint**

Requirement — Adaptive monochrome, minimal colors, clean typography, subtle neutral surfaces, concise iconography and low-noise layout.

*Acceptance — UI avoids promotional gradients, bright dashboard cards and decorative animation.*

**UX-02 Theme consistency**

Requirement — Light is the initial default; polished graphite dark theme uses identical information hierarchy and accessible semantic roles.

*Acceptance — All major pages are usable in both themes without layout or content changes.*

**UX-03 Low-friction upload**

Requirement — Upload is global and prominent; only request clinically necessary verification after accepting the document.

*Acceptance — A user can upload a valid file without filling a medical intake form.*

**UX-04 Responsive navigation**

Requirement — Desktop narrow expandable rail; mobile labeled bottom navigation and clear current-patient switcher.

*Acceptance — Every primary destination is reachable on mobile without reliance on hover.*

**UX-05 Accessible states**

Requirement — WCAG 2.2 AA target, keyboard/focus support, reduced motion, 44px touch targets, explicit loading/error/empty/denied states.

*Acceptance — Critical workflows complete using keyboard/screen reader and at 200% zoom.*

**UX-06 Clinical clarity**

Requirement — Source, verification status, unit, time and reference context visible where consequential; never conceal uncertain medical data.

*Acceptance — Trend and summary screens clearly distinguish verified and unverified information.*

# 4. UX design authority — adaptive monochrome

The final UI is inspired by a dark restrained desktop dashboard and a light minimalist mobile reference supplied by the product owner. Linear-style precision and Apple Health-style clinical readability are complementary inspirations, not a reason to imitate unrelated product flows. The earlier teal-heavy palette is superseded.

## 4.1 Canonical visual tokens

| Semantic role | Light    | Dark     |
|---------------|----------|----------|
| Canvas        | \#FAFAFA | \#101116 |
| Surface       | \#FFFFFF | \#1D202A |
| Primary text  | \#171717 | \#F5F5F6 |
| Muted text    | \#737373 | \#A1A1AA |
| Border        | \#E5E5E5 | \#30333F |
| Accent        | \#262626 | \#D4D4DA |
| Focus         | \#5757A2 | \#9494CE |
| Danger        | \#B42318 | \#F87171 |

Use Inter, 4px spacing increments, 10–14px card radii, thin borders, almost no shadows, Lucide outline icons, restrained motion and accessible contrast. Palette values may be adjusted only to satisfy accessibility while preserving the monochrome aesthetic.

## 4.2 Component and interaction policy

- Desktop: compact collapsible icon rail with accessible labels; visible patient switcher; prominent global search/upload.

- Mobile: labeled bottom navigation, clear current patient, content-first lists, full-screen document preview; no hover-only controls.

- Use shadcn/ui primitives with canonical semantic tokens; one dominant action per panel and understandable destructive confirmations.

- Use explicit pending, verified, rejected, failed, denied, missing, loading and empty states; do not invent medical metrics to fill space.

- Charts must preserve units, dates, reference context, medical source and verification status; semantic color is allowed only when meaningful.

- WCAG 2.2 AA target, keyboard use, visible focus, 44px touch areas, 200% zoom and reduced-motion support.

# 5. Cross-cutting privacy & resilience invariants

- One patient Person ID independent of household and authentication identity.

- Only live, authoritative grants authorize medical access; no default administrator clinical access.

- Original medical file saving never depends on AI availability or successful OCR.

- Clinically sensitive extracted information remains provisional until verification.

- No third-party AI receives health documents without scoped opt-in and approved privacy terms.

- Deleted medical information disappears immediately from ordinary access, and old backups must not resurrect it.

- Ordinary patient-visible document access audit is retained 90 days; critical incidents use controlled separate retention.

- Weekly encrypted backups retained 90 days; each recovery point includes coherent database and file state.

- Do not silently replace free infrastructure with paid services or claim provider guarantees not verified.

# 6. Feasibility validation and decision controls

The following are explicitly unresolved feasibility validations, not permission to change approved product requirements: OCI Always Free VM allocation and production suitability; HTTPS endpoint and domain; verified SMTP sender domain and dependable transactional mail; independent free capacity for 90-day backups; GitHub Actions missed-run safeguards; exact database ORM/migrations; appropriate OCR accuracy; external AI provider vetting; critical-audit retention and legal review for potential public release.

# 7. Acceptance and traceability

Requirements shall be tested with positive and unauthorized cases, multiple Person IDs, profile activation, revoked grants, partial upload, malformed reports, OCR failure, export scope, Trash restoration, backup age expiry, and old-backup recovery with deleted/revoked state. UI review shall cover light/dark, desktop/tablet/mobile, keyboard/screen-reader, readable medical sources and consistent design tokens.

Codex source of truth: \`AGENTS.md\` routes tasks; \`docs/product/requirements-index.md\` maps every requirement ID to one canonical domain owner; \`docs/design/design-system.md\` owns UI tokens and behavior; \`docs/architecture/open-decisions.md\` records unresolved deployment issues. No duplicate specification should supersede these owners.

# 8. Change control

This document freezes approved scope and stack as of 04 November 2026. Future changes should identify affected requirement IDs, rationale, security impact, test impact and explicit product-owner approval. Implementation convenience alone does not constitute approval to reduce privacy, audit, backup, or accessibility requirements.
