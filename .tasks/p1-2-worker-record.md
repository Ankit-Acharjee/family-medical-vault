# P1.2 bounded worker record

Approved objective: self-profile onboarding and permanent Person identity.
Base: develop at 5cacfa2; implementation files owned by supervisor except below.

- OpenCode GLM `opencode/glm-5.3-flash-free`: synthetic standalone PersonPanel TSX generation. Supplied props, text labels, generic React/shared-input imports and accessibility requirements; no source attachment. Allowed output: TSX text only. OS sandbox denied project, SSH, AWS and Codex paths. Supervisor integrated into `apps/web/src/features/auth/PersonPanel.tsx` and reviewed form behavior. Worker exited successfully; no tool calls or file changes.
- Native Luna `gpt-6-luna`: allowed only `apps/web/e2e/person.spec.ts` and `docs/operations/auth-live-verification.md`. Synthetic auth/person fixtures; creation, retry, reload/ID stability, duplicate submit, responsive accessibility and delayed-response isolation. Verification: `PLAYWRIGHT_CHANNEL=chrome pnpm --filter @fmv/web test` (50 passed).
- Native Sol `gpt-6.1-sol`: read-only scoped identity/migration/security review. Found delayed POST response crossing accounts; supervisor fixed generation guards and Luna added regression. Follow-up review reported no residual code blockers; actual database checks passed subsequently.

All workers prohibited secrets, installs, Docker, commits, pushes and deployment.
Supervisor retains backend auth/identity, migration, integration and acceptance.
Live email/recovery and repeated Google checks are unresolved external validations,
documented as pending rather than reported as automated-provider success.
