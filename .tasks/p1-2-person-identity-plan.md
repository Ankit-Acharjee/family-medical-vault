# P1.2 — Permanent Person identity and private account linkage

Status: APPROVED; implementation verified locally and ready for review. Live-provider checklist and hosted migration remain pending.
Base: develop, 5cacfa2. Working tree was clean when planning began.

## Delivery order
1. Close the P1.1 live-auth checklist: email signup/confirmation, recovery/reset, logout/replay, repeat Google login. Google succeeded once; earlier callback failure remains unexplained. Record actual results; do not call untested flows complete.
2. Implement P1.2 identity foundations below using mocks for routine verification.
3. Review and verify before any separately authorized hosted migration or push.

## Scope and requirements
- AUTH-02: immutable, opaque, server-generated Person ID independent of provider and household.
- AUTH-07 (foundation): separate account identity/linkage from Person lifecycle; no deletion or deactivation endpoint in this slice.
- ACCESS-01, SEC-02/05/06: private by default; resolve current verified account server-side; no public lookup or account enumeration.
- Explicit, authenticated onboarding creates or returns the account's own Person atomically and idempotently. Merely signing in does not claim an existing managed Person.
- Concurrent/retried onboarding creates one self Person/link per account. Never match or merge on email, name or DOB.
- No medical record access is granted by an identity link. Future patient permissions remain authoritative for document operations.
- A minimal onboarding view and own-profile summary use existing UI primitives; no theme redesign.
- Managed profiles, household membership, duplicate-review workflows, activation/reconciliation, invitations and patient switcher remain subsequent P1 work, after authoritative permissions are defined.

## Ownership and delegation
| Owner/model | Bounded task | Acceptance |
| --- | --- | --- |
| Supervisor, Codex Sol | Identity design, API contracts, verified-account mapping, Prisma migration/RLS, transactions and backend authorization | Own-account access only; atomic onboarding; separate lifecycle; restricted fmv grants |
| OpenCode GLM free, DeepSeek free fallback (verify exact availability) | Presentation-only onboarding/profile components in a sanitized export, with synthetic contracts | Loading/error/empty/submit states, responsive keyboard-accessible UI; no cookies, credentials or API/session logic |
| Native Codex Luna | Isolated browser fixtures/tests and live-auth checklist documentation | Repeat onboarding, reload, denied access and UI failure cases; no real account data |
| Native Codex Sol | One focused independent identity/migration/security review | Cross-account denial, concurrent creation, role privileges, enumeration and lifecycle reviewed |

## Worker controls and verification
- Write narrow worker briefs with allowed paths after approval; keep UI and tests in distinct files. Maximum two correction attempts before supervisor takeover.
- OpenCode receives only vetted presentation files and synthetic fixtures with enforced access boundaries. Prior external-source transmission was rejected by automatic approval review; do not retry the same payload or bypass that block. If a sanitized route cannot be approved/enforced, report it and use the already-authorized native Luna/Terra route.
- No external worker receives the repository, history, .env files, tokens, auth implementation, medical data or provider configuration. No paid inference API calls.
- Backend checks cover anonymous/unverified denial, cross-account and forged-ID denial, same-name coexistence, idempotency/concurrency, transaction failure and unchanged Person ID across session refresh/relogin. Provider reconciliation is deferred rather than simulated as complete.
- DB checks: fresh migration, explicit table grants/RLS, runtime cannot own/alter tables or read migration ledger. Existing local vault history needs a reviewed transition; no reset or ledger rewriting.
- Run build/typecheck/lint/format, focused API/browser tests and secret scanning; use hosted CI or a brief final Docker session only if needed for DB verification.
- Live-provider checks require user interaction; never collect credentials or mark synthetic tests as provider validation.
- No hosted DB writes, commits, pushes, deployments or theme changes are authorized by approval of this implementation plan alone.

## Execution record
- Live auth remains an explicit release gate; Google succeeded once, other real-provider flows require the user's browser and remain pending. Implementation verification uses synthetic fixtures.
- OpenCode `opencode/glm-5.3-flash-free` generated presentation-only TSX from a synthetic brief in a temporary directory. An OS sandbox denied project/SSH/AWS/Codex paths; no repository source was attached. Supervisor reviewed and integrated the output, retaining form values on retry.
- Native `gpt-6-luna` authored browser tests and the live-auth checklist. Native `gpt-6.1-sol` independently reviewed identity/migration/security changes.
- Review found and fixed a delayed creation-response privacy race across logout/relogin; a browser regression checks that another account's response cannot replace the current profile.
- Verification passed: 25 API/auth/identity tests, 50 desktop/mobile browser tests using installed Chrome, and 7 disposable PostgreSQL lifecycle checks (82 total), plus build, typecheck, lint, formatting, diff validation and secret scanning. The scan initially flagged ordinary plan prose; rewording it cleared the false positive without adding exclusions.
- Database checks cover concurrent onboarding across two stores, issuer/subject isolation, immutable runtime privileges, forced RLS, transaction rollback and retry. Temporary test containers/network/volume were removed; no project containers remain running. Development data was preserved.
- No hosted migrations, commits or pushes were performed. Live-provider checks stay pending; the profile UI requires the new migration before testing against development Supabase.
- 2026-11-10 delivery: user authorized committing and pushing all accumulated work to develop. Fresh checks passed 25 API tests, 58 browser tests, server/web builds, lint, formatting and secret detection. No hosted migration was applied and no Docker session was started; live-provider verification remains pending.
