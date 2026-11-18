# SHARE-01 — patient summary ZIP export

## Result and boundaries

The current bounded summary can be explicitly exported as a ZIP containing readable offline HTML, exact structured JSON and a README. Originals are not included. The export preserves Unicode, qualifiers, decimal strings, source references, reported/unknown dates and manual offsets, and labels medication context as a current record snapshot. It adds no clinical interpretation, remote processing, public URLs, stored artifacts or new product routes.

The server independently enforces the approved aggregate View + Export and included-source View + Export policy, with explicit-owner authority. It reads a current guarded snapshot, matches the displayed canonical SHA-256, builds a bounded in-memory archive outside database locks, then reads and matches a fresh snapshot and rechecks current grants before delivery. A post-audit authorization check rejects grants that expire during audit. Patient/source lifecycle mutations follow existing patient locks; mismatches require reload and fresh confirmation. Existing summary reads and per-document original export policy remain independent.

The new value-free audit stores generated-export identity, selected opaque source IDs, byte size and hashes under restricted column grants, FORCE RLS and ordinary 90-day retention metadata. It records generation, not confirmed delivery to disk. Request IDs correlate attempts; retries generate fresh authorized archives rather than replaying persisted medical data. Archive creation permits two simultaneous generations per process, caps raw content at 8 MiB and delivered ZIP at 16 MiB, and observes cancellation/deadlines. Fixed archive paths avoid field-derived path traversal. HTML escapes all field values and contains no scripts or remote assets.

The existing summary dialog reuses shared Button, semantic themes and Lucide icons for a progressive, patient/scope/period-specific confirmation. The irreversible-copy acknowledgement is required per attempt. Conflicts require reload; Export denial does not falsely revoke still-permitted summary reading. Cancellation, revalidation/context changes and close abort pending downloads; late responses cannot trigger a download. Consent resets on retry/reload. Browser-initiated downloads use bounded private bytes and a short-lived local object URL.

## Files

- Shared contract: `packages/contracts/src/summary-export.ts`, `packages/contracts/src/index.ts`.
- Server: `apps/server/src/summaries/grounded-summary.service.ts`, `grounded-summary.controller.ts`, `summary-archive.ts`.
- Database: `apps/server/prisma/schema.prisma`, `apps/server/prisma/migrations/20261118000100_summary_exports/migration.sql`.
- UI: `apps/web/src/features/summaries/SummaryExport.tsx`, `summary-export.ts`, `GroundedSummaryDialog.tsx`; aggregate capability hint in `apps/web/src/features/medications/index.tsx`.
- Tests: `apps/server/test/grounded-summary.test.mjs`, `grounded-summary-api.test.mjs`, `integration/database.test.mjs`, `support/grounded-summary-database.mjs`, `support/summary-export-database.mjs`; `apps/web/e2e/grounded-summary.spec.ts`.
- Policy/implementation context: `docs/domains/sharing.md`, `docs/security/access-control.md`, readiness/report/checkpoint files under `.tasks`.
- Necessary server-only archive dependency: exact `yazl` 3.3.1 (MIT), development `@types/yazl` 3.3.1, package/lockfile. No UI dependency. Context7 primary library documentation and installed license/package metadata were inspected.

## Verification

- Full server suite: **373 passed**, including session/Origin/CSRF, private attachment headers and sanitized failures. The initial POST 201 finding was fixed with explicit HTTP 200 and this run verifies it.
- Full disposable native PostgreSQL suite: **24 passed**, deploying all 26 migrations. Focused lifecycle also passed. Export cases include owner/delegate authority combinations, stale display snapshot, change during archive rendering, expiry during final audit, audit/renderer failure, rollback and runtime audit-grant restrictions. No Docker; clusters cleaned up by script traps.
- Browser: **22 passed** desktop/mobile summary/chronology/export tests, followed by **8 passed** export-focused runs adding cancellation and 320px scrolling/consent reset. Eight earlier cases overlap; this is not 30 distinct scenarios. Both themes, axe, keyboard focus, source navigation, errors/retry, actual browser download event, and zero fixture page errors were checked.
- Frontend unit/proxy: **66 passed**. Pure summary/archive subset: **8 passed**, including independent system unzip verification of three fixed entries, exact JSON, Unicode/markup and pre-aborted generation.
- Workspace build/types, lint, format, diff checks and secret detection passed. Existing Vite bundle-size/config-loader warnings remain.
- Hosted **read-only** preflight passed for `nyjkrcznezyrgntwvpjj`: verified TLS, owner/restricted runtime roles, UTC, 25 applied migration checksums and exactly one pending migration. No hosted write performed.
- Production dependency audit: **zero advisories**. The approved, advisory-specific development exception is enforced by the checked-in audit wrapper; production is scanned without exceptions. See the reviewed scope/expiry below.

Actual synthetic screenshots (mobile 390×844 CSS px, desktop 1440×1000) were captured and visually inspected in both themes: `.local/screenshots/summary-export-{mobile,desktop}-{light,dark}.png`. Mobile screenshots show the scrolled confirmation/retry region; controls and content remain reachable. Screenshots are ignored local artifacts, not source commits. No live patient records, hosted authenticated end-to-end delivery, Safari/native OS download behavior or disk-delivery confirmation is claimed.

## Review and remaining gate

Supervisor implementation and review only: native worker/Astra quota remained unavailable; OpenCode stayed disabled. Applied existing project Frontend Design/UI UX Pro Max/Baseline UI/React architecture conventions, canonical design docs, existing Radix/shared controls, Playwright and axe. No independent agent signoff or performance profiling is claimed; no performance defect was observed or speculative optimization introduced. Approved Overview/global design remain unchanged.

Required CI `pnpm security:dependencies` reports pre-existing **GHSA-fc5q-39xc-vjpf**, picomatch 4.0.7, through development-only `typescript-eslint → typescript-estree → tinyglobby`. The same version exists at HEAD before this feature. The upstream advisory lists no patched release: https://github.com/advisories/GHSA-fc5q-39xc-vjpf . Repeated extglob patterns from an attacker can cause ReDoS; reviewed app production dependencies do not contain it, and current tooling patterns are trusted repository/config input. This is an exposure assessment, not a fix or universal safety guarantee. A separate moderate minimatch advisory is also reported; the existing high-severity gate does not fail on it. The user explicitly approved a temporary exception on 18 November. `infra/ci/dependency-audit.mjs` permits only this exact GHSA/CVE, picomatch 4.0.7 and the observed development path, after a separate unfiltered production scan. It does not persist pnpm ignore configuration and fails closed on malformed/failed audit responses, changed paths/version, another high/critical issue or expiry at 25 November 2026 00:00 UTC. Four gate tests pass. See `docs/security/dependency-exceptions.md`; the dependency gate must pass before push. Hosted migration approval remains separate after verification/push.


Exception implementation files: `infra/ci/dependency-audit.mjs`, `infra/ci/test/dependency-audit.test.mjs`, `docs/security/dependency-exceptions.md`, and the root `package.json` audit-script entry. No CI job or severity threshold was removed.
