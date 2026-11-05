# Approved technology decisions

**Status:** Approved product/technical baseline; vendor feasibility exceptions below are not guarantees.

| Layer | Selection |
|---|---|
| Architecture | TypeScript modular monolith; REST/OpenAPI |
| Repository | pnpm monorepo with `apps/web`, `apps/server`, shared contracts |
| Frontend | React + Vite + TypeScript; Tailwind CSS; shadcn/ui; Lucide React; TanStack Query |
| Backend | NestJS + TypeScript, Docker image |
| Relational DB | Supabase PostgreSQL, with managed Supabase Auth for Google OIDC/email password |
| ORM / migrations | Prisma ORM 7; reviewed SQL migrations via Prisma Migrate; client/models introduced with P1 |
| File objects | Private Cloudflare R2; no large medical binaries in DB |
| Hosting web | Cloudflare Pages static deployment |
| Hosting API | Oracle Cloud Always Free preferred; Render fallback, subject to availability and service behavior |
| Containers | Docker & Compose for reproducible local dev and portable backend; no requirement to Docker-host the static frontend |
| OCR | PDF text extraction plus browser/local OCR where feasible; no mandatory external AI |
| SMTP | Resend candidate, Brevo fallback, sender-domain compatibility to verify |
| Backups | Portable encrypted weekly snapshots, 90-day rolling retention; GitHub Actions scheduler candidate; independent configurable destinations |
| UX | Monochrome light default + graphite dark; restrained polished design |

**Important:** There is **one** primary data database: PostgreSQL. Do not add MongoDB or a second source of truth without approval. PostgreSQL JSONB may hold flexible provisional extraction payloads; stable entities have normalized relationships. Supabase Auth does not automatically replace patient-specific authorization policies.

**Docker boundary:** Containerize NestJS and local dependencies; production managed Supabase and R2 remain managed services. Don't assume a Docker container must stay running for scheduled backups.

**Provider credentials and exact deployment topology** must be validated before production. Do not claim Oracle ARM VM, email sender-domain control, or 90-day independent backup capacity is already secured.

## P0.4 local database and migration foundation — 05 November 2026

The approved P0.4 task selects stable Prisma 7 for migration management and the future ORM. Migration credentials use `DATABASE_MIGRATION_URL`; future runtime queries use a separate restricted `DATABASE_URL`. No Prisma Client or patient models are generated until P1 defines the identity and authorization slice.

Local development uses PostgreSQL 17 with an isolated `vault` application schema. The baseline creates only that schema and its migration ledger, revokes public access, and grants no blanket application access. Local `fmv_app` is neither owner nor superuser and cannot bypass RLS. P1 must introduce explicit table privileges, RLS and current server-side authorization before protected data operations exist.

The Docker Compose stack is local only: API binds to loopback, PostgreSQL has no host port, and randomly generated local passwords remain in ignored `.local/compose.env`. Local migration tooling is kept separate from the non-root portable API runtime. Production continues to use managed Supabase and private R2; production database versions, roles, direct/pooler URLs, grants and TLS remain validation work.

Migrations are forward-reviewed changes. Disposable integration databases test initial application, repeat runs, denied runtime operations and transactional failure/retry; destructive reset is not part of the normal workflow. Development volumes are retained on shutdown. No S3-compatible object service is introduced before P2 requires it.

## P1.1 authentication boundary

The approved P1.1 plan uses a same-origin Nest authentication boundary, opaque HttpOnly browser sessions and encrypted server-side Supabase credentials. See [session design](auth-sessions.md) for session lifetime, PKCE, current revocation checks, durable consumption and database privilege boundaries. React does not hold provider tokens. Person identity and patient permissions remain separate upcoming slices; live provider and production configuration remain unverified.
