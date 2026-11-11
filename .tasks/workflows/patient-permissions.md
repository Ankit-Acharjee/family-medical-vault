# Workflow A — Patient permissions and authorized patient list

Status: approved local implementation verified; hosted migration remains pending. See ../parallel-functional-delivery-report.md.
Requirements: ACCESS-01/04/05/06/07, SEC-02/05/06.
Read: AGENTS.md, docs/domains/access.md, docs/security/access-control.md, docs/architecture/person-identity.md.

## Ownership
- Supervisor: policy contract, Prisma schema/migrations, principal resolution, authoritative store and HTTP integration.
- Sol worker: independent policy/HTTP denial matrix and bounded fixtures; no authorization policy decisions.
- Separate Sol context: read-only security review before integration.

## Deliverable
- Central policy for independent view/upload/edit/export/manage actions.
- Explicit owner rule and current active scoped grants; no ambient administrator/household access.
- Authorized minimal patient-list API for current verified principal.
- Category/document authorization resolves real resource context server-side; unresolved targets deny.
- No public arbitrary-grant endpoint before the approval workflow exists.

## Boundaries and gates
- Worker paths: new access-test files and synthetic fixtures assigned after contract freeze; shared contracts/schema/auth/module wiring remain supervisor-only.
- Obtain the principal from the current verified session on every protected route; transport guard alone is insufficient.
- Test all independent actions, IDOR, unknown IDs, expiry/revocation, scope mismatches, unchanged-session revocation, storage failure and enumeration resistance.
- Verify owner policy and new tables against real disposable PostgreSQL integration tests before marking DB behavior verified.
- Denials remain generic and fail closed; no patient details in logs.
- No secret access, provider calls, installs, Docker, commits, pushes or deployment by workers.

## Handoff
Publish frozen patient-list/action/scope contracts for C; publish authorization interface for B/D.
Focused check: pnpm --filter @fmv/server test, plus supervisor-owned DB integration checks.
Report FILES CHANGED; TESTS RUN/RESULTS; UNFINISHED; BLOCKERS.
