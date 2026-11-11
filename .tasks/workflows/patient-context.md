# Workflow C — Authorized patient selection and context

Status: approved local implementation verified, including account/patient race checks. See ../parallel-functional-delivery-report.md.
Requirements: ACCESS-01/03/04/05, UX-03/04/05; F-01 selected-patient flow.
Read: AGENTS.md, docs/domains/access.md, docs/design/ux-flows.md and existing App/AuthRoot/PersonPanel.

## Ownership
- Terra/Sol implementer: bounded patient-context components/hooks under apps/web/src/features/patients/.
- Independent Sol tester: synthetic list, denial/retry, account/patient-switch races and browser checks.
- Supervisor: principal/session-generation binding, shared contracts and final App/AuthRoot integration.

## Independent work after contract freeze
- Accessible patient switcher, clear current/no-patient context and meaningful empty/error/retry states.
- Build isolated fixtures against the real planned DTO, never ship fixture patients as live data.
- Reuse existing presentation and controls; no further UI polish or Overview redesign.

## Integration after A
- Use only the current server-authorized list, never own-Person identity alone.
- Selection is memory-only, explicitly chosen and scoped to authenticated account lifecycle.
- Discard pending responses after account/patient changes; never use email as a session identity key.
- Clear stale content on revocation/authentication loss; do not silently select another patient.
- Revalidate current entitlements and handle temporary failure separately from confirmed removal.
- Search/upload remain honestly unavailable until their real B endpoints exist.

## Boundaries and gates
- Allowed edits limited to patient feature paths and assigned browser fixtures; no shared CSS, auth state implementation or route changes by workers.
- Test empty/list/denied/retry, stale replies, same-email account changes, revocation and logout; verify no private patient browser storage.
- Check keyboard/focus, narrow layouts and both themes; preserve every current action.
- No new dependencies, provider access, secrets, Docker, commits, pushes or deployment.
Focused check: PLAYWRIGHT_CHANNEL=chrome pnpm --filter @fmv/web test (assigned patient-context cases first).
Report FILES CHANGED; TESTS RUN/RESULTS; UNFINISHED; BLOCKERS.
