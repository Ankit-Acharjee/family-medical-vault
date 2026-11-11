# Workflow D — Caregiver invitations, requests and approval

Status: approved local approval/revocation implementation verified with real disposable PostgreSQL and browser fixtures; hosted verification and broader audit/retention work remain pending. See ../parallel-functional-delivery-report.md.
Requirements: ACCESS-02/03/04/05, SEC-02/03/05/06.
Read: AGENTS.md, docs/domains/access.md, docs/security/access-control.md, relevant identity/UX flows.

## Ownership
- Supervisor: approval invariants, recipient/authority resolution, schema/migrations and atomic approval-to-grant/audit integration.
- Sol implementer: bounded lifecycle helpers and invitation/request feature code after contract freeze.
- Independent Sol tester/reviewer: replay, scope escalation, race and cross-account matrix.
- Terra/Sol frontend worker: Family Access controls after contracts stabilize, using C's patient context.

## Deliverable
- Patient invitations and caregiver requests with exact displayed actions/scope/expiry.
- Opening or sharing a link does not grant access.
- Verified participants and explicit patient/authorized-representative approval.
- Hashed expiring single-use tokens, transactionally consumed with grant and audit changes.
- Clear pending/approved/denied/expired/revoked states; immediate authoritative revocation.
- Link creation/display can be verified without pretending SMTP delivery is configured.

## Boundaries and gates
- Feature paths and tests assigned narrowly; shared contracts, auth wiring and migrations remain supervisor-only.
- Do not match/link recipients automatically by email, names or DOB, or expose public account lookup.
- Delegation cannot exceed the issuer's authorized actions/scope; manage does not imply export or unrestricted delegation.
- Test duplicate redemption, expiry, revoked/forwarded/guessed links, approval/revoke races and atomic rollback.
- Recheck current manager/owner authority at approval/revocation time, not only when creating the link.
- Managed profile creation/activation and legal representative establishment are separate, unresolved identity work.
- No sensitive link tokens in logs, analytics or persistent browser storage.
- No dependencies, provider writes, secrets, Docker, commits, pushes or deployment by workers.
Focused checks: invitation/request API/state-machine tests and Family Access browser flow, followed by supervisor-owned DB race checks.
Report FILES CHANGED; TESTS RUN/RESULTS; UNFINISHED; BLOCKERS.
