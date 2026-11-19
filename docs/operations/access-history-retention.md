# Ordinary access-history maintenance

Implements only the SEC-04 approved 90-day ordinary-access policy. This development-only operator tool is separate from API requests and the restricted `fmv_app` role. It never purges originals, clinical history, grants, sharing creation/revocation, activation or account history. Critical-event retention remains an open policy decision.

Local unit and disposable PostgreSQL verification passed. Hosted purge execution has not been authorized or performed. Do not enable a scheduler or treat this as deployed retention enforcement.

## Scope and safeguards

- Explicit local disposable or dedicated development Supabase target only. Production targets are rejected.
- A separate private `DATABASE_MAINTENANCE_URL` is required; no fallback to runtime or migration environment variables. The development operator connection must have RLS bypass and explicit Select/Delete authority for both ordinary event tables. No new runtime grants are introduced.
- Default dry-run uses a read-only transaction and reports capped candidate counts only. Apply requires both explicit flags shown below.
- Each pass processes at most 500 rows per class (1,000 total), with a transaction advisory lock, row locks that skip competing work, lock/statement timeouts and one atomic commit. A failure rolls back both classes. Busy means another pass owns the lock; it is not proof that retention is complete.
- Both event age of at least 90 days and the stored retention deadline must have elapsed. An early deadline cannot delete young rows; a later deadline is not shortened. Only `document.viewed`, `document.exported`, `link.opened` and `original.accessed` are eligible.
- Output contains counts and a generic error code, never URLs, credentials, identifiers, labels or clinical values. A capped dry-run is not a total count. Repeat bounded passes only within an approved maintenance window.

## Development operator commands

Keep the maintenance connection in private local configuration; never paste it into chat, Git, shell arguments or logs. Hosted connections require verified TLS and an absolute CA path. Separate approval is required before an agent executes hosted writes or purge operations; a migration approval does not approve purging events.

From the repository root, preview only:

```sh
node --env-file=.env infra/scripts/access-history-retention.mjs --target=nyjkrcznezyrgntwvpjj
```

After separately approved maintenance authorization, one bounded write pass is:

```sh
node --env-file=.env infra/scripts/access-history-retention.mjs --target=nyjkrcznezyrgntwvpjj --apply --confirm=purge-ordinary-access-history
```

For the disposable native test database, use `--target=local` and only its generated maintenance connection. Tests must not read project `.env` or contact hosted services.

## Release and recovery gates

Native PostgreSQL tests must verify dry-run preservation, exact classes/age/deadline, rollback, batch bounds, contention, repeated passes and runtime-role denial. Unit tests alone do not prove SQL behavior. Hosted execution, a production least-privilege maintenance role, cloud scheduling, alerting and retention reconciliation after restores remain separate release work. Restored expired ordinary events must be filtered and purged before restored services reopen; this tool does not reconcile deleted medical files or revoked permissions.
