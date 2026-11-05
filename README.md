# Family Medical Vault

A private medical records vault for individuals and authorized family caregivers.

Repository initialized from the approved November 4, 2026 specification pack. The workspace, NestJS API foundation, and responsive React frontend shell are implemented. No credentials or production deployment configuration are included.

## Workspace setup

Use Node.js 24.14.0 and pnpm 10.33.0. From the repository root, install the locked workspace dependencies and run the available checks:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm format
```

`packages/contracts` remains a shared package foundation without domain schemas. P0.4 provides local Docker/PostgreSQL and migrations; P0.5 adds CI.

## Branch workflow

Use `develop` as the default development and integration branch. `main` is reserved for approved production releases. Start routine work from `develop`; release promotion is a separate approved action.

## Frontend development

Run `pnpm dev:web` and open `http://127.0.0.1:5173`. The shell provides Overview, Documents, Trends, Medications, and Family Access navigation, a collapsible desktop rail, labeled mobile navigation, and light/default plus graphite/dark themes. Inter is bundled locally; there are no remote font requests.

Patient selection, search, and upload remain unavailable until identity and vault slices are implemented. Empty views contain no example medical records. Theme preference is the only value saved in browser storage; there is no service worker or offline medical cache.

Shared UI primitives follow shadcn conventions with Radix dialogs and Tailwind semantic tokens. `ResourceState` provides loading, empty, error/retry, denied, offline, pending and success presentations for subsequent feature slices.

Browser QA covers both themes, mobile/desktop navigation, dialog focus, theme persistence, narrow layouts (including the layout width equivalent of a 1440px window at 200% zoom), reduced motion, blocked storage, and automated axe WCAG checks. Automated checks do not replace a full screen-reader or manual accessibility review.

```sh
# Install Playwright Chromium once, then run browser tests.
pnpm --filter @fmv/web exec playwright install chromium
pnpm --filter @fmv/web test
# Alternatively use an installed Google Chrome:
PLAYWRIGHT_CHANNEL=chrome pnpm --filter @fmv/web test
```

Screenshots and reports are local ignored artifacts. Test-only state fixtures are excluded from the production build. `pnpm --filter @fmv/web build` creates the static app in `apps/web/dist`; `pnpm --filter @fmv/web preview` serves that build locally.

## API development

Run `pnpm dev:server` for compilation and automatic server restarts. The server binds to `127.0.0.1:3000` by default; export `HOST` and `PORT` to override these values. See `apps/server/.env.example`; environment files are not loaded automatically.

- `GET /health` reports process liveness only; it does not check database or storage readiness.
- `/api/docs` serves Swagger UI and `/api/openapi.json` serves OpenAPI in development. Both are disabled when `NODE_ENV=production`.
- `pnpm openapi` generates `apps/server/dist/openapi.json` without opening a network listener.
- `pnpm test` runs local-runner, API and browser tests; install the Playwright browser first. `pnpm test:db` separately runs disposable database integration tests.
- `pnpm --filter @fmv/server build` and `pnpm --filter @fmv/server start` compile and run the API independently.

Responses include a server-generated `X-Request-ID`. Errors return `{ error: { code, message }, requestId }` without raw exception details. HTTP logs contain only event type, request ID, method, status and duration; request URLs, headers, bodies and exception messages are excluded. Startup failures emit only a fixed event.

There are no patient, authentication, database, storage or external-provider endpoints yet. The global validation pipe rejects unknown DTO fields; later feature slices must add validated DTOs and current patient authorization to every protected operation.

## Local API and database

For local API development, start Docker Desktop, then run:

```sh
pnpm install --frozen-lockfile
pnpm local:up
```

`local:up` prepares ignored local credentials if needed, builds the API and migration tooling, starts PostgreSQL, applies migrations, and serves the API at `http://127.0.0.1:3000`. Run the frontend separately with `pnpm dev:web` at `http://127.0.0.1:5173`. `pnpm local:setup` prepares credentials without starting services; `pnpm local:down` stops services but retains the database volume and matching credentials; `pnpm local:status` shows service status.

Use `pnpm db:migrate` to apply migrations, `pnpm db:status` to inspect migration status, and `pnpm db:migration -- add_example` to create a migration (use one `snake_case_name`). `pnpm test:db` runs against a fresh isolated disposable project and removes only that test project's volumes afterward.

Local credentials are generated in `.local/compose.env` with directory mode `700` and file mode `600`; the file is ignored by Git. Do not print or share it or `docker compose config` output. Keep the generated passwords with their existing development volume: do not reset or delete that volume or regenerate its passwords. Use no real patient data in local development. PostgreSQL has no host port, and the runtime role has no access to the baseline schema. Prisma 7 reviewed SQL migrations establish only the `vault` schema and migration ledger; Prisma Client and domain models are deferred to P1. The API container runs as non-root and does not receive cloud credentials. Production continues to use managed Supabase PostgreSQL and private R2.

## Project layout

- `apps/web/` — responsive React, Vite, TypeScript frontend shell.
- `apps/server/` — NestJS TypeScript modular monolith foundation.
- `packages/contracts/` — shared validated API schemas (foundation only at this stage).
- `infra/` — local Docker setup and infrastructure/backup contract; production deployment pending.
- `docs/` — canonical specifications and implementation decision records.

## Source of truth

Start with [AGENTS.md](AGENTS.md) and the [documentation router](docs/README.md). The [requirements index](docs/product/requirements-index.md) routes requirement IDs to their canonical domain owners. The [SRS](docs/product/Family_Medical_Vault_SRS_v1.0.md) records the approved baseline.

Use the [design system](docs/design/design-system.md): adaptive monochrome, light default, graphite dark. Approved stack choices are in [architecture decisions](docs/architecture/decisions.md); unresolved choices remain in [open decisions](docs/architecture/open-decisions.md).

## Implementation status

P0.1 workspace tooling, P0.2 API foundations, P0.3 frontend shell, and P0.4 local infrastructure and migration foundations are implemented. P0.3 covers UX-01, UX-02, UX-04, and the shell-level portion of UX-05; UX-03 has a prominent entry only, with real uploads deferred to P2. The API and local infrastructure provide foundational support for SEC-05 (privacy hygiene) and REL-01 (health independent of external providers); these requirements are not fully complete until the relevant product flows exist.

Never commit credentials, patient records, uploads, or backup archives.
