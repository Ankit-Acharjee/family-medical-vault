# Saved extraction delivery — 13 November 2026

## Scope and behavior
Implements AI-01/AI-02/AI-05/AI-06 and DOC-05 foundations: explicit saving and reopening of completed browser PDF text, image OCR and selected-page PDF OCR. The latest successful result is retained; text remains explicitly unverified. No external AI, background jobs, medical fact promotion, vault-wide indexing or dependency additions.

The approved policy permits owners or users with both current scoped Edit and View to save; View may read. Metadata is captured before extraction. Source hash, revision and Trash/restore lifecycle fences prevent stale replacements; exact retries are idempotent. Reads and writes use original-document locks, current authorization, private audit events and no-store responses. Failed replacements preserve the previous success. Original bytes and object keys are unaffected.

## Implementation and review
Shared strict bounded contracts; additive PostgreSQL migration with FORCE RLS, narrow runtime privileges, source/JSON guards and lifecycle trigger; authenticated bounded streaming endpoint; existing document result UI reused for Save and Saved text. Synthetic test data only.

Astra completed architecture/security design review. Three native Sol workers contributed partial implementation before their quota was exhausted; the supervisor integrated, reviewed and tested the final implementation. OpenCode GLM 5.3 Flash Free supplied sanitized interface-only validator vectors; no private source or records were submitted. Native independent final implementation review was unavailable after quota exhaustion; it is not claimed.

Verification also found a development-only PDF worker bootstrap problem: normal Vite connection debug messages were treated as parser failure. Only the two exact development handshake messages are now ignored in development; other diagnostics still fail privately. Development fault-injection tests now target the actual worker rather than Vite URL stubs.

## Evidence
- 199 server checks passed; 25 focused API/contract checks passed again after expanded edge cases.
- 19 disposable native PostgreSQL checks passed, including concurrent replacement, Save/Trash locking, rollback, scoped permissions, lifecycle/revision/hash guards, Unicode limits and restricted privileges. No Docker or hosted writes.
- 284 production browser checks passed (two pre-existing mobile visual skips); 102 development checks passed, including real selected-page OCR and worker failure cases. After the final worker bootstrap correction, all 90 targeted production checks passed; counts overlap and are not unique totals.
- Workspace typecheck, server/web builds, lint, formatting and secret scan passed; final formatting, lint, secret scan and diff checks also passed.
- Actual synthetic screenshots inspected in light/dark at desktop 1440px and mobile 320px: `.local/screenshots/saved-extraction-{light,dark}-{desktop,mobile}.png`. Responsive overflow, axe, Find and focus checks passed.

## Hosted activation and limits
Read-only TLS/UTC/role/migration-ledger preflight passed against dedicated development project nyjkrcznezyrgntwvpjj: all ten existing migration checksums match. After the user's separate approval, migration `20261113000100_saved_extractions` was applied to that development project. Read-only postflight verified all eleven ledger checksums, verified TLS, UTC, both source/lifecycle triggers, forced RLS and restricted runtime SELECT/INSERT/result-UPDATE privileges without DELETE or saved-at UPDATE. No record content was queried during postflight. Existing local extraction remains available if optional persistence metadata is unavailable. Authenticated real-account end-to-end saving against hosted development has not been exercised by this verification.

No production deployment, physical-phone verification or production purge/backup validation is claimed. Historical extraction-engine upgrades need an explicit compatibility policy before changing the fixed engine allowlist. Vault-wide search remains deferred pending documented semantics and synthetic benchmarks.
