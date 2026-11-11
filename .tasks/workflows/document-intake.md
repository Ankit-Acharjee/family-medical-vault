# Workflow B — Private original-document intake and retrieval

Status: approved local implementation verified with synthetic objects and real disposable PostgreSQL; real R2 adapter/configuration and hosted checks remain pending. See ../parallel-functional-delivery-report.md.
Requirements: DOC-01/02/05/07, ACCESS-04/05, SEC-01/02/03/05.
Read: AGENTS.md, docs/domains/documents.md, docs/security/access-control.md, docs/architecture/decisions.md.

## Ownership
- Sol implementer: bounded storage interface, synthetic adapter, file validation and recoverable upload core under apps/server/src/documents/.
- Independent Sol tester/reviewer: failure/idempotency/integrity matrix and privacy review.
- Supervisor: document/upload schema, migrations, authorized route integration and real-provider configuration.

## Independent work
- Validate explicitly supported file types/limits and original-byte integrity without medical fixtures.
- Opaque object keys, recoverable upload states, retry/idempotency rules and safe compensation.
- Synthetic storage failures, interrupted writes, conflicting retries, checksum mismatch and metadata rollback tests.
- Never expose incomplete objects as READY or make originals depend on extraction.

## Integration after A
- Enforce current permission at initiation and finalization, and independently on list/preview/download/range requests.
- Connect upload/list/preview/download to the existing Documents route using current patient context.
- Resolve patient ownership/category from server data; separate view from export.
- Audit protected operations without leaking filenames, signed URLs or medical content to logs.
- No public bucket, permanent direct read URL or browser-persisted protected file cache.

## Boundaries and gates
- Frozen storage/upload DTOs first; shared exports/module wiring/migrations remain supervisor-only.
- Synthetic adapter success is not proof of live R2 behavior. External SDK/setup/write steps require their own concrete review/authorization.
- No OCR/AI/grouping engine or extra product features in this baseline.
- No secrets, installs, provider writes, Docker, commits, pushes or deployment by workers.
Focused checks: document unit/API lifecycle tests, browser upload/read flows and supervisor-owned DB/private-object integration.
Report FILES CHANGED; TESTS RUN/RESULTS; UNFINISHED; BLOCKERS.
