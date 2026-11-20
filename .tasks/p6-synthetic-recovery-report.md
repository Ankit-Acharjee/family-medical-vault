# BACKUP-04 / DEL-03 — Disposable database recovery drill

The user completed Bitwarden two-step setup, saved the development age identity, made a paper copy and reported a successful saved-copy recipient/decryption check. No private or public key values are recorded here. Key custody does not by itself activate backups.

Extended the existing Docker-free disposable PostgreSQL runner with an actual fmv-only custom-format dump, age encryption/decryption using an ephemeral synthetic identity, fresh-database restore and table-by-table deterministic content/migration-ledger comparison. A read-only repeatable-read transaction exports the snapshot shared with pg_dump; a separate connection commits a later probe row that must remain absent from the restored snapshot. Table ACL and RLS flags must match; runtime schema creation/deletion stays denied and foreign-key enforcement is exercised. A synthetic nonapplication schema must be excluded.

The drill explicitly demonstrates that a post-snapshot grant revocation is absent from a stale restore, then applies that one synthetic evidence item and confirms the restored revoked state. This is a test fixture, not a separately protected production ledger or service-reopening mechanism. No deployed reconciliation, original-file restoration, Supabase Auth recovery or fully recoverable backup set is claimed. Both databases remain in the same disposable cluster and are removed afterward. The application and hosted services are never started or changed.

Commands receive only generated local test credentials; no .env or cloud access. Dumps, passfile and synthetic keys stay in temporary private directories and are cleaned up. No real recovery identity is used, no new dependency or global installation, and no secure-SSD-erasure claim.

Validation: server build, all 28 native database lifecycle tests plus the new actual encrypted restore/snapshot drill, 21 infrastructure tests, lint, formatting, secret detection and diff checks passed. Native repeat after adding concurrent snapshot coverage also passed. Temporary clusters stopped and removed. Supervisor implementation and review; no external model review is claimed.

Snapshot behavior follows the standard [PostgreSQL pg_dump snapshot option](https://www.postgresql.org/docs/17/app-pgdump.html). The test uses the already installed local PostgreSQL binaries; this does not establish hosted pooler snapshot support.
