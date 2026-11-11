# Parallel functional delivery plan

Status: APPROVED by user on 2026-11-10; local implementation and verification are authorized. Hosted writes, commits, pushes and deployment remain separate.
Base: clean develop at 5986cab, inspected 2026-11-10.

Local implementation and verification pass finished on 2026-11-11. See [delivery report](parallel-functional-delivery-report.md) for actual checks, changed files, limitations and the remaining hosted-storage/migration gates. This does not mark all referenced product/security requirements or future roadmap milestones complete.

## Objective and execution preference

Deliver useful, tested functional slices toward a private document vault. The user's remaining weekly quota window is an opportunity for higher throughput, not a project deadline or a reason to skip acceptance gates.
Use native Codex only for this window; OpenCode is paused. Prioritize speed and quality. UI polish is deferred; reuse the existing interface and components.

## Four separate feature workflows

| Track | Deliverable | Independent work that can start after contract freeze | Integration dependency |
| --- | --- | --- | --- |
| A: Patient permissions | Central current-state authorization and authorized patient list | Permission matrix, denial fixtures and policy/store tests | Supervisor-owned schema/policy and real DB verification |
| B: Original-document intake | Recoverable upload lifecycle, file validation, private storage boundary | Storage interface, synthetic object adapter, integrity/idempotency/compensation tests | A before HTTP exposure; reviewed R2 configuration before live verification |
| C: Patient context | Functional patient switcher with safe current-patient state | Contract-backed controls, request-generation guards and isolated browser fixtures | A's real authorized patient-list API |
| D: Caregiver access | Invitations, requests, explicit approval and revocation | Token-lifecycle model, synthetic fixtures and state-machine tests once approval contract is fixed | A plus transactional grant/audit integration; C for patient-context UI |

Workflow briefs: [A](workflows/patient-permissions.md), [B](workflows/document-intake.md), [C](workflows/patient-context.md), [D](workflows/caregiver-access.md).

## Actual concurrency and scheduling

The current session supports four active agents total: supervisor plus up to three workers. These are separate feature workflows, not twelve simultaneously active workers.

1. Contract gate: supervisor freezes action/scope semantics, patient summaries, error behavior, storage interface and upload states before workers implement against them.
2. Wave 1: supervisor implements the security-critical A foundation; Sol worker builds B's storage/intake core; Terra/Sol worker builds C's contract-backed UI; independent Sol worker builds A's adversarial tests and reviews the policy.
3. After A passes: integrate C; rotate the released worker slot to D's lifecycle/tests. B can connect authorized upload/list/read operations while C handles functional patient context.
4. Wave 2: complete D approval/revocation and Family Access controls; connect B to the existing Documents route for upload, list, preview and explicit download. Keep upload and view/export permissions separate.
5. Finish each slice with independent review, integration and end-to-end checks before marking it complete. Continue independent tracks if external-provider setup blocks one track.

Each feature has implementer → independent tests → separate review → supervisor integration. Workers can rotate roles across features; nobody independently approves their own implementation.
Use GPT-6.1 Sol for substantial implementation, adversarial testing and security review; GPT-6.1 Terra for bounded frontend interaction/layout work. The supervisor retains architecture, authorization decisions, migrations, auth integration and final acceptance.

## Proposed policy contract for approval

- Define an explicit centralized owner rule for the account's own Person; do not treat a supplied Person ID, provider role, name, email or household membership as authorization.
- Owner authority and explicit grants are evaluated against current authoritative database state. View, upload, edit, export and manage are independent actions; manage is not an implicit export/read permission.
- Restrict delegated grants to the issuer's permitted actions and scope. No public grant mutation bypasses the approved invitation/approval flow.
- Patient/category/document scopes remain distinct. Resource ownership/category is resolved server-side; unknown targets fail closed. No category/document grant endpoint is exposed before a real resource registry exists.
- Patient summaries expose only authorized context; returned capabilities are UI hints, never substitutes for backend checks.
- Revocation/expiry checks use authoritative state. Operations authorized after revocation commits must deny, including upload finalization and subsequent document reads.
- Invitation/request links grant no access merely by being opened. Require verified identities, explicit patient/authorized-representative approval, hashed expiring single-use tokens and atomic grant/audit updates.
- Preview permission cannot guarantee that a recipient cannot save bytes already displayed. Explicit export/download remains separately authorized; reusable read URLs must not bypass future revocation checks.

## File ownership and integration boundaries

- Supervisor exclusively owns Prisma schema/migration order, shared contract exports, auth/session integration, application module wiring and final App/AuthRoot integration.
- Workers own narrow access-test, documents/storage, patient-context or caregiver feature paths assigned in their briefs. No overlapping edits to shared files.
- Use isolated worktrees where useful; move reviewed contracts/foundation patches into dependent worktrees explicitly. Integrate reviewed patches, not unchecked worker summaries.
- Preserve existing data and immutable Person IDs. Never reset retained databases, rewrite migration ledgers or modify provider-managed Supabase schemas.

## Acceptance gates

- Permission/security: cross-patient and resource ID manipulation, each independent action, expired/revoked grants with an unchanged session, admin-without-grant, recovery/unverified sessions, storage failure and enumeration resistance.
- Database: fresh and upgrade migrations, restricted runtime privileges/FORCE RLS, stable existing IDs, concurrency, approval/revoke races and atomic rollback. Routine work stays Docker-free; use only a brief necessary disposable DB session for final verification.
- Upload: original-byte integrity, explicit types/limits, opaque keys, retries, conflicting idempotency keys, object-write/metadata failures, safe orphan compensation and no phantom READY records. No OCR dependency.
- Frontend: patient/account switch races, revoked selection, no persistence of private patient state, no automatic replacement patient, loading/empty/error/retry states, keyboard/focus, mobile reflow and both themes.
- Release claims: fake providers and synthetic fixtures prove local behavior only. A feature is called end-to-end verified only after its real configured integrations pass.

## External gates and exclusions

Hosted P1.2 migration and live authentication verification are still recorded as pending. No hosted writes are approved yet. Real R2 setup, any necessary SDK addition and external write verification must be made concrete before execution; no paid services or secrets in chat/logs.
Managed-profile creation is a separate identity extension: the current owner-account relationship must change, and representative authority must be defined before exposing creation/activation. Do not smuggle it into A or D.
No OCR/AI, clinical trends, medication features, emergency QR, account reconciliation, public release or further visual redesign in this batch. Real medical-record use still requires backup/recovery readiness.
This plan proposes local implementation and verification only. Commits, pushes, hosted migrations and deployment remain separately authorized actions.

## Completion reporting

Report feature status, actual checks, changed paths and external blockers after each integrated slice. Keep daily progress concise and distinguish implemented, locally verified and live-provider verified.
