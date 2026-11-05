# P0.2 API scaffold
Approved: user go ahead for NestJS API foundation. Native Codex route.
Requirements: SEC-05 foundation; REL-01 health independent of external providers.
Read AGENTS.md and docs/architecture/decisions.md.
Allowed edits ONLY: apps/server/src/app.module.ts, apps/server/src/health/**.
Implement NestJS AppModule importing HealthModule; no other modules yet.
HealthModule owns GET /health returning exactly {status:'ok'}; process liveness only.
Use Swagger ApiTags/ApiOperation/ApiOkResponse and DTO with ApiProperty.
Use .js suffix relative imports (ESM NodeNext). Explicit return types.
No database, login/auth routes, medical records, external services, logging.
No main.ts or config/manifests edits; supervisor owns bootstrap and safeguards.
No installs, commits, pushes, secrets or network calls.
Verification: supervisor will run build and API integration tests after dependencies installed.
Return FILES CHANGED, TESTS RUN + RESULTS, UNFINISHED, BLOCKERS.
