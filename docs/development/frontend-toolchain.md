# Frontend engineering toolchain

## Repository adoption

The toolchain is approved for ongoing frontend work. Keep root `AGENTS.md`, this guide, ESLint configuration and dependency lockfile in Git. Installed third-party `.agents/skills/` content is local tooling and is ignored, along with browser artifacts; the source catalog below documents how to restore it. MCP configuration and OAuth credentials remain machine-local. A fresh checkout requires reinstalling the listed skills before claiming they were used.

The four initial Hooks findings described below were reviewed during adoption. Three concern mutable async generation counters, not DOM refs: cleanup must invalidate the latest generation. The profile-read effect deliberately refreshes on account context/email identity rather than object allocation. Narrow, documented lint exceptions preserve these existing semantics; Hooks rules remain enabled everywhere else. No runtime behavior was changed.

Adoption verification: workspace build, typecheck, lint, scoped formatting, secret detection and diff checks pass. Chrome regression coverage passed all 62 tests across authentication, patient context, shell, Overview polish and state fixtures in desktop/mobile projects. Tests use synthetic fixtures; a pre-existing state fixture emits backend-unavailable proxy warnings without affecting its passing assertions. No live provider or hosted database verification was performed.

Verified 2026-11-12. Setup only: no redesign, application behavior change, commit, push, Docker or production-data access.

## Existing environment

Repository: `family-medical-vault`; frontend: `apps/web`. Node 24.14.0, pnpm 10.33.0, npm/npx 11.9.0, Python 3.9.6 and local Google Chrome available.
React 19.3.1 + Vite 8.3.5, TypeScript, Tailwind 4.3.4, shadcn new-york/Radix, Inter and Lucide are retained. Navigation uses URL hashes; state uses local hooks and patient context, without a separate routing/state library. Existing Playwright 1.64.1 and axe-core/Playwright 4.14.0 provide desktop/mobile accessibility and interaction coverage.
The initial Git working tree was clean. Existing canonical instructions remain intact.

## Installed skills

All are project-scoped in `.agents/skills`, with `SKILL.md` and upstream supporting references retained. Codex app-server `skills/list` reported all seven enabled and no discovery errors.

| Directory | Verified source | Purpose |
| --- | --- | --- |
| `ui-ux-pro-max` | [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), npm CLI 2.15.0 | Layout, density, spacing, typography and design research |
| `frontend-design` | [Anthropic](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | Intentional visual composition |
| `baseline-ui` | [ibelick](https://github.com/ibelick/ui-skills/tree/main/skills/baseline-ui) | Restraint and interface cleanup |
| `web-design-guidelines` | [Vercel](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) | UX/accessibility review |
| `react-best-practices` | [Vercel](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) | React architecture/performance; declared skill name is `vercel-react-best-practices` |
| `shadcn` | [Official shadcn](https://github.com/shadcn-ui/ui/tree/main/skills/shadcn) | Existing accessible primitives |
| `context7-mcp` | Official `ctx7` 0.11.1 OAuth setup | Public library documentation |

Upstream definitions and installer packages were inspected first. Five source directories were installed with Codex's official skill-installer helper rather than running a second skill-manager CLI; the Vercel directory name above is the verified upstream path. UI/UX Pro Max was installed using its reviewed CLI. Its six unsolicited bundled brand/presentation/design skills were removed to avoid duplicate guidance. No application dependency was added for skills. Its local Python search returned three form-validation results successfully.

`AGENTS.md` makes the existing design system authoritative over conflicting third-party suggestions: preserve Arctic Blue, Obsidian/Electric Blue, Inter and approved subtle gradients. Do not apply Next.js-specific React recommendations to this Vite SPA or install speculative motion/state libraries.

## MCP configuration and verified functionality

Servers are merged into local `~/.codex/config.toml`, shared by CLI/IDE, with unrelated settings preserved. There is no duplicate project config. Global TOML was parsed successfully; `codex mcp list` registers four enabled servers.

| Server | Configuration | Actual verification |
| --- | --- | --- |
| Playwright | `npx -y @playwright/mcp@latest --isolated` | MCP handshake, 25 tools, navigate to `about:blank` succeeded |
| Chrome DevTools | `npx -y chrome-devtools-mcp@latest --isolated --no-usage-statistics` | MCP handshake, 33 tools, `list_pages` succeeded |
| shadcn | `npx -y shadcn@latest mcp`, working directory `apps/web` | MCP handshake, 7 tools, `get_project_registries` returned `@shadcn` |
| Context7 | `https://mcp.context7.com/mcp/oauth` | Official `ctx7 setup --codex --mcp --oauth --project --yes`; registration moved to shared config. OAuth sign-in completed; Codex authenticated discovery returned `resolve-library-id` and `query-docs` without tool errors. No documentation query exercised. |

Stdio startup timeouts are 60 seconds. Isolated browser profiles avoid attaching to personal browser sessions; DevTools usage statistics are disabled. No secrets were written to project files. OAuth credentials stay in Codex's local credential storage. The sandboxed CLI may display Context7 auth as Unknown; an escalated Codex app-server confirmed `oAuth` and successful discovery.
Browser MCP artifacts are ignored because they may contain screen content. Use only synthetic data and public technical Context7 queries. Never send medical records, private code or credentials to documentation services.

Start a **new Codex session** in this repository to load the MCP tools and current guidance; reload the VS Code window if tools are still absent. No manual authentication is outstanding. If credentials expire, run `codex mcp login context7` interactively.

## Permanent standards and checks

The root `AGENTS.md` adds Frontend UI/UX Engineering Standards: design precedence, complete interaction states, reusable accessible primitives, maintainable state/component ownership, measured performance optimization, browser verification, and the Understand → Design → Implement → Verify → Refine → Validate → Report workflow. Context7's official setup appended public-library lookup guidance.

Only `eslint-plugin-react-hooks@7.1.1` was added as a development dependency, compatible with ESLint 10. Rules of Hooks and exhaustive dependencies are errors for web TypeScript. Generated vendor skills and already-ignored `.local` scripts are excluded from lint. Existing axe integration is retained; `eslint-plugin-jsx-a11y@6.10.2` declares support only through ESLint 9, so it was not forced into ESLint 10.

Checks performed:
- `pnpm build`: passes for the workspace, including frontend/server/contracts.
- `pnpm typecheck`: passes for the workspace.
- Existing `shell.spec.ts`, `overview-polish.spec.ts`, `states.spec.ts`: **26 passed**, Chrome, one worker. Includes both themes, widths 320/375/390/430/1280/1440, navigation/history, theme persistence, keyboard dialog dismissal/focus restoration, reduced motion, zoom-equivalent layouts, loading/empty/error/retry and axe checks.
- Inspected actual screenshots of 390px light and 1440px dark overview; established gradients and blue identity remain coherent. No horizontal overflow observed.
- Additional fully intercepted synthetic API browser audit at 390/1440: zero console/page errors or unexpected API paths, no overflow. One `/api/patients` request per viewport was cancelled with `net::ERR_ABORTED`; inspect effect cancellation if a user-facing issue reproduces. No runtime performance defect was established and no speculative optimization was made.
- Baseline lint failed on `.local` scripts. After excluding local artifacts and enabling Hooks checks, `pnpm lint` reports **four newly surfaced existing exhaustive-deps findings**, listed below. Lint with only exhaustive-deps disabled passes; Rules of Hooks still run. No authentication/patient logic was altered to silence them.
- Prettier on edited root config/instructions and `git diff --check`: pass. Full application E2E suite, live backend flows, and performance traces were not run.

## Read-only overview audit and follow-up work

1. Review `AuthRoot.tsx:134,232` and `patients/index.tsx:162`: cleanup increments version refs. These are async generation counters, so assess cancellation semantics before changing them to satisfy DOM-ref-oriented lint advice.
2. `AuthRoot.tsx:234` references `account` while depending on context/email fields; review the intended refresh identity before modifying dependencies. These four lint findings remain outstanding.
3. The no-patient overview shows a patient-selection CTA even when the synthetic account has no patient profiles. The dialog explains unavailability; a clearer permitted next action could reduce this dead end after product requirements are checked.
4. At 390px, the overview hero plus document panel pushes the privacy footer below the first viewport. Review density on small screens without removing approved artwork/gradients or changing the accepted design.
5. `documents/index.tsx` is approximately 1,459 lines and `App.tsx` 422 lines: review responsibilities in future feature work; line count alone does not justify a refactor. No top-level React error boundary was found; evaluate a meaningful application/feature boundary separately.
6. `states.spec.ts` does not intercept patients in its overview screenshot case, producing local backend connection-refused warnings when the backend is absent. The dedicated audit intercepted every API request. Improve fixture isolation separately.
7. Vite warns about the extensionless `./ocr-assets` import in its config ahead of a future native loader change. Existing builds pass. No frontend/API architecture changes are needed for this setup.

## Reuse and changed files

Retained existing shadcn/Radix components, semantic theme tokens, navigation/state architecture, Playwright fixtures and axe checks. Changed: `AGENTS.md`, `.gitignore`, `eslint.config.mjs`, `package.json`, `pnpm-lock.yaml`; added seven `.agents/skills/*` directories and this report. Machine-local change: `~/.codex/config.toml` plus Codex-managed OAuth credential storage. No commits or pushes were made.

Official references: [Codex MCP](https://developers.openai.com/codex/mcp/), [Playwright MCP](https://github.com/microsoft/playwright-mcp), [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp), [Context7](https://github.com/upstash/context7), [shadcn MCP](https://ui.shadcn.com/docs/mcp).
