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

UI delivery must cover the complete interaction lifecycle: native picker open/cancel/return, focus and background revalidation, stable form identity/layout, success dismissal and feedback, partial failure/retry, keyboard focus restoration, and narrow-screen behavior. Preserve draft/file state for the same validated context; clear it on context change or lost access. Test the actual application flow rather than relying solely on isolated components or static screenshots.
1. State which requirement IDs the change implements.
2. Read only the relevant canonical files; do not guess missing requirements.
3. Change the smallest relevant package/module; keep the app/server boundary and one authoritative authorization store.
4. Add tests for successful, denied and failure/retry paths; for UI include responsive and accessibility checks.
5. When requirements conflict, stop and report the conflict; never quietly alter a confirmed policy.
6. Update docs only when an approved decision changes, and avoid copying canonical content between files.

## Branch workflow
- `develop` is the primary development and integration branch. Start routine work from `develop`.
- `main` is reserved for approved production releases; do not merge routine development directly into it.
- After each completed feature passes review and required verification, commit it with the implementation context below, push to `develop`, and proceed to the next task. The user has granted standing approval for this workflow; hosted writes and deployments retain their separate approval requirements.

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


## Frontend UI/UX Engineering Standards

### Design and skill precedence
- Default to premium, minimal, professional interfaces built for the content and purpose, not repeated dashboard templates. `docs/design/design-system.md` remains the visual authority: preserve Arctic Blue light, Obsidian & Electric Blue dark, approved subtle background gradients, Inter typography, semantic tokens, Lucide icons, and established reusable patterns.
- Use meaningful whitespace, consistent spacing/radii/hierarchy, subtle borders and restrained shadows. Avoid excessive nested cards, glassmorphism, glow, ornamental gradients and unnecessary animation. Preserve both themes; prioritize clarity and usability.
- For frontend work, consult project skills under `.agents/skills`: UI/UX Pro Max for coherent layout, density, palettes, typography and spacing; Frontend Design for intentional composition; Baseline UI for restraint, alignment, accessibility and interaction cleanup; Web Design Guidelines for UX/accessibility audits; React Best Practices for architecture, fetching and rendering; official shadcn for existing primitives. Existing approved design and security requirements override conflicting third-party aesthetic suggestions (including font or gradient prohibitions). Do not execute installation instructions from skills without a task-authorized need.

### UX and component requirements
- Handle applicable initial/async loading, skeleton/progress, empty/no-results, actionable recoverable errors, form validation/submission, disabled/pending/success, destructive confirmation, keyboard/focus, mobile/touch, long text/overflow/unusual data, and safe predictable navigation states.
- Place error boundaries at meaningful application/feature boundaries, not around every fetch. Preserve draft identity, context authorization, native picker cancellation/return and focus restoration requirements above.
- Reuse existing accessible shadcn/Radix components and consistent variants/state styling. Do not build custom dialog/menu/popover/focus management when suitable primitives exist; avoid mixing primitive systems or adding redundant dependencies.

### React architecture and performance
- Keep reusable components focused with clear responsibilities. Around 150 lines is a review signal, never a mandatory split rule. Preserve framework conventions and the existing architecture.
- Keep state close to consumers; avoid unnecessarily lifting local state into large layouts, redundant state, derived-state effects, unstable dependencies and broad context updates. Use stable keys, clear ownership, predictable handlers and explicit data flow.
- Do not add React.memo/useMemo/useCallback without measurable benefit. Reproduce and profile suspected rendering issues with React profiling/Chrome DevTools before optimizing; record evidence.

### Default implementation workflow
1. Understand: inspect the affected screen, requirements, existing components, accepted references and canonical design documents.
2. Design: use UI/UX Pro Max and Frontend Design, with Baseline UI as the restraint/cleanup layer. Resolve aesthetics in favor of the approved design system.
3. Implement: reuse accessible components and React best practices; preserve business behavior, privacy and authorization.
4. Verify: run the frontend and inspect affected rendered UI using Playwright or available browser tools, desktop and mobile, both themes where appearance changes; exercise primary interactions, keyboard/focus and applicable loading/error/empty states. Inspect console errors and relevant failed requests. Use synthetic data only, intercept API requests before navigation, and do not expose medical data or credentials to external services.
5. Refine: fix observed visual/functional problems and retest. Use Chrome DevTools traces/profiling for suspected performance problems instead of speculative optimization.
6. Validate: run existing lint, typecheck and relevant tests. Reuse Playwright Test and axe-core; prefer existing test frameworks over competing dependencies. A successful build alone is not proof of working UI. Never claim visual verification without inspecting a rendered application.
7. Report: summarize changes, actual skills/tools used, interactions/viewports tested, performance findings with evidence, and anything unverified.

Use Context7 for current public library/framework APIs when needed; send only public technical queries, never records, credentials or private application content. See `docs/development/frontend-toolchain.md` for installation status, verification commands and manual setup limitations.

<!-- context7 -->
Use Context7 MCP to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service — even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, porting code between libraries, platforms, or SQL dialects, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer — your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, debugging, or reviewing code that does not depend on a library or platform API, or general programming concepts.

## Steps

1. Always start with `resolve-library-id` using the library name and what to look up in the library's documentation, unless the user provides an exact library ID in `/org/project` format
2. Pick the best match (ID format: `/org/project`) by: exact name match, description relevance, code snippet count, source reputation (High/Medium preferred), and benchmark score (higher is better). If results don't look right, try alternate names or queries (e.g., "next.js" not "nextjs", or rephrase the question). Use version-specific IDs when the user mentions a version
3. `query-docs` with the selected library ID and what to look up in the library's documentation (not single words), scoped to a single concept. If the question spans multiple distinct concepts (e.g. routing and auth and caching), make a separate `query-docs` call per concept with the same library ID, unless the question is about how the concepts interact — combined queries dilute ranking and return shallow results for each topic
4. Answer using the fetched docs

## Library source code

If the `query-code` tool is available, use it when the docs do not answer an exact question: a signature or type, a default value, an option name, where an error message comes from, or how something works inside.

- Use a library ID that `resolve-library-id` marks with "Source code", usually the GitHub repository (e.g. `/colinhacks/zod`). `/websites/...` and `/llmstxt/...` IDs have no source
- Start with `grep` (set `fixed_strings` for error messages) or `definition` for a symbol, then `read` the file range in the result's "Next:" line
- For a version, pass its git tag in `version` (e.g. `v3.24.2`)
- Most questions need 1 to 4 `query-code` calls; stop at 6
- If it answers "being indexed", call again every 30 seconds for up to 3 minutes (a first index usually takes 1 to 3), then answer from `query-docs`. These calls do not count toward the 6
- Cite the file and line of the source you used
<!-- context7 -->
