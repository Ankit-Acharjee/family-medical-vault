# Approved technology decisions

**Status:** Approved product/technical baseline; vendor feasibility exceptions below are not guarantees.

| Layer | Selection |
|---|---|
| Architecture | TypeScript modular monolith; REST/OpenAPI |
| Repository | pnpm monorepo with `apps/web`, `apps/server`, shared contracts |
| Frontend | React + Vite + TypeScript; Tailwind CSS; shadcn/ui; Lucide React; TanStack Query |
| Backend | NestJS + TypeScript, Docker image |
| Relational DB | Supabase PostgreSQL, with managed Supabase Auth for Google OIDC/email password |
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
