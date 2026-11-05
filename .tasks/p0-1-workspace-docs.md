# P0.1 workspace setup documentation
Approval: user approved P0.1 workspace tooling and Codex subagent delegation.
Requirement IDs: foundational architecture; supports future UX/SEC checks, no functional requirements completed.
Allowed edit: README.md only.
Objective: document Node 24.14.0, pnpm 10.33.0, and workspace tooling setup.
Commands: pnpm install --frozen-lockfile, pnpm build, pnpm typecheck, pnpm lint, pnpm format:check, pnpm format.
Explain apps/web and apps/server are TypeScript package placeholders, not runnable React/Nest apps yet.
packages/contracts is an empty shared package foundation, without API schemas yet.
P0.2/P0.3 add actual API/frontend; P0.4 adds Docker/database/migrations; P0.5 adds CI.
Preserve canonical docs links and project purpose. Keep concise.
No install, Git changes, commits, pushes, network, secrets or edits outside README.md.
Verification: inspect command names in root package.json once supervisor creates it.
Report FILES CHANGED, TESTS RUN + RESULTS, UNFINISHED, BLOCKERS.
