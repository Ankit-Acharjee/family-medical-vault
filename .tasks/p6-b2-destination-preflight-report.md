# BACKUP-01/03 — B2 destination metadata preflight

The user confirmed the empty private development bucket is ready. Added a dependency-free read-only preflight and private configuration/setup instructions. It verifies official API endpoints, a single-bucket read-only standard application key and private bucket metadata. Redirects, write/admin capabilities, public buckets, mismatched endpoints, invalid configuration and oversized responses fail closed. Output and errors omit credentials and provider identifiers.

No object reads, uploads, deletion, scheduler activation or real recovery-key generation occur. Capacity and actual recovery remain unverified. The hosted check awaits the user's private read-key configuration; no real B2 request was made.

Validation: all 13 infra tests, lint, formatting, secret detection and diff checks passed. Tests cover configuration rejection, exact two-request metadata flow, restrictive capability checks and sanitized provider failures. Supervisor reviewed the implementation; previously quota-exhausted workers were not retried and no external worker review is claimed.

Next: user creates the bucket-restricted Read Only application key and appends BACKUP_B2 settings to local .env with BACKUP_ENABLED=false, following docs/operations/backblaze-development-setup.md. Run the metadata preflight after configuration. Real backup writes, recovery identity custody, authenticated completion manifests, capacity planning and restore verification remain separate gates.
