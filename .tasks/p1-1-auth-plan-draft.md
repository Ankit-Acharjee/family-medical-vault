# P1.1 authentication — temporary review plan

Status: APPROVED for implementation by the user. Provider setup, commits and pushes remain separate actions.

## Outcome and requirements

A visitor can register, verify their email, sign in with email/password or Google, recover their account, and sign out through an accessible responsive interface. Only a currently valid, verified session can access the authenticated account endpoint.

Implements AUTH-01 and the session/recovery portion of AUTH-06; supports ACCESS-01, SEC-05 and SEC-06. This slice does not complete P1 or patient authorization.

Canonical references: `docs/domains/identity.md`, `docs/domains/access.md`, `docs/security/access-control.md`, `docs/architecture/decisions.md`, and the design/UX documents for frontend work.

## Proposed boundaries

- Include registration, email verification/resend, email/password login, Google OIDC redirect/callback, session restore/refresh, logout, password-recovery request and reset confirmation.
- Include a minimal authenticated account view and shared API contracts. Authentication must not grant access to any patient data.
- Keep permanent Person IDs, account-to-Person linkage, managed profiles, caregiver grants/invitations and patient switcher integration in subsequent P1 slices. Do not issue placeholder Person IDs or default patient grants here.
- No uploads, medical records, deployment or public signup launch in this slice.

## Proposed security design — supervisor owned

1. Use Supabase Auth as the identity provider; never implement password storage ourselves. Verify its current official session, recovery, OIDC and revocation behavior before coding.
2. Use the Nest API as the browser authentication boundary. Keep provider access/refresh tokens out of browser JavaScript, localStorage, URLs exposed by the app, logs and analytics. Use opaque application sessions in HttpOnly cookies; server-side session material must have a reviewed storage/encryption strategy before implementation.
3. Prefer same-origin browser/API requests (Vite proxy locally). Specify cookie flags, CSRF protection, allowed origins, redirect allowlists, OAuth state/PKCE and recovery callback handling explicitly. Production requires HTTPS; any local HTTP cookie exception is development-only.
4. Check verified identity and current session/account validity on protected operations. Define local logout, provider revocation, password-change and disabled-account behavior explicitly; do not assume signature verification alone proves a session remains valid. Fail closed when authoritative validation is unavailable.
5. Rotate session identifiers at authentication and recovery boundaries; enforce expiry and replay prevention. Logout must invalidate the application session immediately. Test revocation with an otherwise unexpired provider token.
6. Use generic public responses where needed to prevent account enumeration, rate-limit sensitive endpoints, and preserve the existing sanitized error/request logging behavior.
7. Supervisor defines any minimal session schema, Prisma client integration, migration, table privileges and RLS. Do not create broad runtime grants or expose provider-auth tables to the application role.

These are proposed implementation choices, not existing approved architecture. Any provider limitation that prevents these guarantees must be brought back for review rather than silently weakening the requirements.

## Delivery and delegation

| Step | Work and owner | Reviewable result |
| --- | --- | --- |
| 1 | Supervisor: verify current Supabase behavior, configuration needs and session design | Short architecture decision, API contract and threat/denial cases |
| 2 | Supervisor: provider adapter, secure session lifecycle, protected account endpoint, schema/migration and security tests | Tested server slice with no patient access |
| 3 | Free OpenCode GLM/DeepSeek: bounded presentation components using approved contracts and monochrome primitives | Registration/login/recovery forms and loading/error/verification states; no token or cookie logic |
| 4 | Luna or free GLM/DeepSeek: isolated fixtures, routine UI checks and setup documentation | Focused tests and credential-free setup instructions |
| 5 | Supervisor integration; focused independent Codex review for authentication/security | Reviewed end-to-end slice and explicit remaining provider validations |

Choose workers by demonstrated task success and total implementation-plus-review cost. Verify free model availability before use; avoid Beam/Nemotron by default. Supply small task briefs and only necessary source. External workers receive no secrets, auth credentials, patient data or sensitive runtime configuration; use a sanitized export and enforced access boundaries. If those boundaries cannot be enforced, use an authorized native worker instead. No paid API usage.

Do not run redundant parallel reviews or hand the whole repository to every worker. Stop ineffective retries and escalate narrowly.

## Configuration and local resource needs

- Use synthetic fixtures and mocked provider responses for routine Docker-free checks.
- A dedicated development Supabase project, its public project configuration, verified callback URLs, email test delivery and Google development OAuth setup are needed for genuine provider integration tests. Inspect existing safe configuration first; request missing setup without asking for secrets in chat.
- Document which credentials belong only on the server. Never expose administrative/service-role keys to the frontend or workers; do not assume such a key is necessary.
- Supabase/Google dashboard changes, production sender verification and deployment are separate actions, not implied by approving code implementation.
- Use hosted CI for migration/container checks where possible. Start local Docker only if a final necessary check cannot otherwise be completed, then stop the project containers and preserve volumes.

## Acceptance checks

- Email registration reaches a clear verification state; an unverified account cannot enter protected functionality. Verified email and Google login reach the account view.
- Successful refresh restores the session; expired, revoked, disabled and malformed sessions are denied. Concurrent refresh behavior is tested. Logout prevents subsequent protected requests, including replay of the old cookie.
- Recovery responses do not disclose account existence. Expired/reused recovery links fail safely; reset completion has an explicit tested session-invalidation policy.
- OAuth callback tampering, redirect injection, CSRF, rate-limit bypass attempts, account enumeration and authentication fixation are covered by focused negative tests.
- Provider outages do not expose protected data or leak raw provider errors. No secrets or sensitive auth values appear in logs, HTML, browser storage or generated reports.
- Forms work on mobile/desktop, both themes and keyboard navigation; labels, focus, error announcement and loading states meet the existing accessibility conventions.
- Build, typecheck, lint, formatting, API tests, relevant browser tests, secret scanning and CI pass. Provider-backed flows are reported separately from mocked tests; unverified flows remain explicitly pending.

## Completion and review gates

P0 is implemented and pushed, but its hosted CI result must be checked before calling its delivery gate complete. A failing foundation check takes priority over adding auth code.

After approval, implement this slice in bounded increments. Report actual worker models and meaningful checks. Do not claim production readiness without email/OIDC/HTTPS/provider validation. Commit or push the authentication implementation only when separately authorized.

Next proposed slices: P1.2 permanent Person identity and private account linkage; P1.3 authoritative patient permissions; P1.4 managed profiles and invitation/activation workflows. Their detailed plans remain separate.

## Execution record

- P0 hosted CI passed for `9e7d137`: [workflow run](https://github.com/Ankit-Acharjee/family-medical-vault/actions/runs/41975718899).
- Local P1.1 implementation is ready for review, not committed or pushed. Includes server sessions/flows, restricted Prisma tables, shared account contracts, responsive auth forms, account/logout UI and setup documentation.
- Actual delegation: native Luna implemented the presentation component and bounded browser tests; Sol performed focused independent security review. Automatic approval review rejected the external GLM request because it would transmit private source/design files; no OpenCode implementation ran and no attempt bypassed that restriction.
- Review fixes: callback/logout/recovery consumption commits before external provider mutations; account polling cannot extend idle expiry. PostgreSQL tests verify real cross-instance refresh locking, durable invalidation and atomic rate limits.
- Passed: 21 API/auth tests, 36 browser tests, 4 local infrastructure tests, 4 security-tool tests and 6 database checks (71 total), plus build, typecheck, lint, formatting, OpenAPI, secret/workflow checks, dependency audit at high/critical severity and a short hardened runtime check. One existing moderate tooling advisory remains. Docker-free `pnpm dev` and its same-origin auth proxy were smoke-tested; temporary processes/containers were stopped and development volumes preserved.
- Live Supabase/email/Google testing remains pending the user's dedicated project setup and separately reviewed database provisioning. Follow [development setup](../docs/operations/auth-development-setup.md).
