# Family Medical Vault — Codex Operating Contract

> **Canonical project instructions.** Read only the relevant domain documents before modifying a module. Do not load the entire docs tree for every task.

## Non-negotiable
- `docs/product/scope.md` defines scope; requirements are indexed in `docs/product/requirements-index.md` and specified by their domain owners.
- `docs/architecture/decisions.md` is the authority for approved stack choices and explicitly unverified deployment assumptions.
- `docs/design/design-system.md` is the visual authority: Arctic Blue light theme (default) and Obsidian & Electric Blue dark theme, with a minimal, classy UI inspired by the user-supplied desktop and mobile references. The previous adaptive monochrome/graphite and earlier teal palettes are deprecated.
- No invented functionality, medical facts, APIs, payment services, login routes or vendor guarantees. Record missing decisions in `docs/architecture/open-decisions.md` and ask before irreversible actions.
- Enforce patient authorization on every protected backend operation. Never treat a JWT's patient ID or client-supplied Person ID as permission.
- Never send records to external AI without explicit documented consent. No medical content in logs, analytics or unencrypted backups.
- Keep original uploads independent of OCR/AI success; verified clinical facts only for trusted automation.
- No scope expansion: no billing, insurance, consultation transcription, dose-adherence dashboards or native apps.

## Repo targets
`apps/web` React/Vite; `apps/server` NestJS modular monolith; `packages/contracts` shared validated API schemas; `infra/` deployment/backup; `docs/` canonical specifications.

## Read on demand
- Identity, invitation, login: `docs/domains/identity.md`, `docs/domains/access.md`, `docs/security/access-control.md`
- Files/upload/search: `docs/domains/documents.md`, `docs/domains/extraction.md`
- Lab/medications: `docs/domains/medical-data.md`, `docs/domains/medications.md`
- Summaries/shares: `docs/domains/sharing.md`
- Security/deletion/backups: `docs/security/access-control.md`, `docs/operations/backup-recovery.md`
- Frontend UI: `docs/design/design-system.md`, `docs/design/screen-spec.md`, `docs/design/ux-flows.md`
- Deployment/hosting: `docs/architecture/decisions.md`, `docs/architecture/open-decisions.md`

## Implementation discipline
1. State which requirement IDs the change implements.
2. Read only the relevant canonical files; do not guess missing requirements.
3. Change the smallest relevant package/module; keep the app/server boundary and one authoritative authorization store.
4. Add tests for successful, denied and failure/retry paths; for UI include responsive and accessibility checks.
5. When requirements conflict, stop and report the conflict; never quietly alter a confirmed policy.
6. Update docs only when an approved decision changes, and avoid copying canonical content between files.

## Branch workflow
- `develop` is the primary development and integration branch. Start routine work from `develop`.
- `main` is reserved for approved production releases; do not merge routine development directly into it.

## Local resource limits
- This device has limited resources. Keep routine implementation and checks Docker-free.
- Start Docker only when necessary for final container/database verification; keep sessions short and stop project containers after verification. Preserve development volumes and credentials.
- Do not start or keep Docker Desktop running proactively during development. Respect the user's decision to close it.

## Commit messages
- Use a clear subject and a brief, precise body for implementation commits: what changed, how it works, resulting behavior changes, and relevant validation or limitations.
- Direct pushes have no PR description, so include the review context in the commit body. Setup-only commits may be shorter.

## Cost-aware delegation
- Use the `delegate-free` skill with mixed OpenCode and native Codex routing; the user authorizes both engines for this project.
- Prefer verified free GLM/DeepSeek workers for bounded implementation; use cheaper Codex workers when their reliability reduces total review and rework cost.
- Do not select Beam or Nemotron by default. Model availability alone does not establish task competence.
- Keep architecture, authentication/authorization, migrations and security decisions with the supervisor. Give workers minimal context and narrow acceptance criteria, review their changes, and stop repeated ineffective retries.
