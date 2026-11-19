# P6 BACKUP-01–04 / DEL-03 — Backup readiness

## Current boundary

Canonical operations and architecture require independently scheduled portable encrypted recovery sets, a proven independent provider destination, rolling90-day recovery points and an isolated restore drill. GitHub Actions is a scheduler candidate, not a deployed guarantee. No BACKUP_ settings are configured. Supabase and Cloudflare R2 are source services; neither proves an independent backup destination. No cloud backup, new dependency, secrets transfer or scheduler is authorized by this readiness note.

## Implementation sequence after configuration decisions

1. Select and verify a private independent destination with sufficient capacity and constrained credentials; keep all values local/private. Verify retention/list/write/read permissions using separately approved nonmedical probes. Never infer capacity from account signup or free-tier advertising.
2. Choose a standard authenticated encryption/archive tool/format and key-recovery/rotation approach. No custom cryptographic protocol or silently installed dependency. Keep recovery keys separate from archives and test recovery without the original runner/provider.
3. Define a recovery-set manifest bound to one consistent application database snapshot and every required original object. Stable opaque keys and byte/hash checks are necessary; object/version consistency and a future purge-versus-backup lease must be demonstrated. Missing required bytes, checksum mismatch or a failed dump cannot yield a completed set.
4. Export only the approved application scope; never accidentally dump Supabase Vault or provider-managed secrets. Provider Auth/issuer identity restoration and forced session invalidation need a documented recovery boundary; an fmv-only dump alone is not proof of restored sign-in.
5. Stream into encrypted output, use private ephemeral working paths, keep only value-free status/counts, and publish a completion marker only after independent upload/integrity verification. Partial sets are never recovery points. Do not claim secure SSD erasure.
6. Add a disabled/manual scheduler integration first, then separately approve hosted secrets and activation. The job must run without the user's laptop or a persistent Docker session. Missed-run monitoring must not reveal medical contents.
7. Retain verified recovery points by rolling90-day age rather than snapshot count. Define failure-safe expiration behavior and key recovery before enabling deletion; do not silently extend/reduce retention or delete the last good recovery point under an invented exception.
8. Restore into a fresh isolated database/object target, verify migration checksums, originals, derived links and current authorization, then reconcile independently protected deletion/revocation evidence before any service reopens. Restoring stale data must not reactivate access. Existing local migration tests are not this restore drill.

## Decisions/configuration required

- Does a private destination with an independent provider already exist? If not, research options using current primary documentation before recommendation; no paid resource creation without approval.
- Encryption tool/format and offline recovery-key custody are not selected. Present a concrete reviewed proposal before adding a dependency or writing real archives.
- Critical-event retention/erasure governance, primary purge/tombstone design and provider Auth restoration need explicit policy/feasibility work. Preserve current behavior while these remain open.

Independent work can prepare sanitized manifest/consistency interfaces and failure matrices after these boundaries are settled. Do not write a provider-specific uploader, claim a recoverable snapshot or enable cloud scheduling while the destination/encryption/recovery contract is unknown.
