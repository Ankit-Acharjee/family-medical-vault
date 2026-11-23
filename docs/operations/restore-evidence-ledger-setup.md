# Development restore-safety ledger destination

The approved retention rule in [backup/recovery](backup-recovery.md) keeps encrypted deletion/revocation evidence while any affected backup exists and disables automatic evidence deletion pending a separate critical-event policy. Ledger evidence must therefore have its own lifecycle boundary rather than inherit the backup bucket's eventual 90-day expiration.

## Empty private bucket only

In the existing Backblaze account, open **B2 Cloud Storage → Buckets → Create a Bucket**:

1. Choose a unique non-sensitive name such as `fmv-restore-ledger-dev-<unique-suffix>`.
2. Choose **Private**.
3. Leave automatic lifecycle deletion disabled. Do not add an expiration rule or reuse the backup bucket's retention configuration.
4. Do not enable Object Lock yet: its actual retention and source-loss behavior need separate review before any hosted settings are applied.
5. Create the empty bucket. Keep its name/endpoint private and reply **“ledger bucket ready.”** No application keys or uploads are needed at this step.

An empty bucket does not prove durability, free capacity, immutability or restore readiness. This is a separate bucket in the already selected independent provider, not an additional primary database. Account-wide allowances still apply; no paid upgrade or real-record upload is authorized by this guide.

After bucket readiness, prepare separate read verification and narrowly scoped producer credentials. Never reuse primary R2/database credentials, the backup decryption identity or a master key in the application. A B2 write-only label alone is not enough: scope/capabilities and complete version discovery must be verified before the adapter is enabled. All hosted object writes, signing trust and activation remain separate reviewed steps.

## Bucket ready: create its separate Read Only key

In **B2 Cloud Storage → Application Keys → Add a New Application Key**:

1. Name the key `fmv-restore-ledger-dev-read`.
2. Restrict **Allow access to buckets** to the new ledger bucket only, not All and not the existing backup bucket.
3. Choose **Read Only**. Leave **Allow list all bucket names** unchecked.
4. Set **File name prefix** to `fmv-restore-evidence/v1/development/`, exactly. Do not leave it empty or use the backup prefix.
5. Save the returned **keyID** and one-time **applicationKey** privately. Use a new standard application key, not the master key or the existing backup key. Keep them out of chat/screenshots.

These controls follow [B2 application keys](https://www.backblaze.com/docs/cloud-storage-application-keys). The checker uses [Native API filtered bucket metadata](https://www.backblaze.com/apidocs/b2-list-buckets), so S3-wide bucket listing is unnecessary.

Append these settings to the existing repository-root `.env`; do not overwrite the file or change existing database, R2 or backup credentials:

```dotenv
BACKUP_LEDGER_ENABLED=false
BACKUP_LEDGER_B2_BUCKET=replace_with_your_ledger_bucket_name
BACKUP_LEDGER_B2_ENDPOINT=replace_with_actual_https_s3_endpoint
BACKUP_LEDGER_B2_READ_KEY_ID=replace_with_keyID
BACKUP_LEDGER_B2_READ_APPLICATION_KEY=replace_with_applicationKey
```

The endpoint needs `https://` even if the B2 dashboard omits it. Use the actual displayed S3 endpoint without the bucket name/path. Keep the existing `BACKUP_ENABLED=false` too. Run `chmod 600 .env`, then reply **“ledger configured.”**

The agent can run `node --env-file=.env infra/scripts/check-restore-ledger-destination.mjs`. It verifies distinct private bucket, restricted Read Only access and an explicit empty lifecycle-rule list. Missing/hidden lifecycle metadata, any configured lifecycle rule, source-bucket/key reuse, broad/write/admin capabilities and unrestricted/wrong prefixes fail closed. Output contains only verification flags. It performs no object listing/download/upload/deletion and does not prove immutable storage, sufficient capacity or actual restore readiness. Producer keys, complete version discovery, signing trust and hosted writes remain later gates.

## Read-only version-metadata readiness

After private-bucket verification, `node --env-file=.env infra/scripts/check-restore-ledger-versions.mjs` checks the same bucket/key/prefix again and scans matching version metadata through the [Native version-list API](https://www.backblaze.com/apidocs/b2-list-file-versions). It includes hide markers, older versions and unfinished uploads rather than assuming the newest filename represents the current ledger.

The scan is bounded to 100 pages of at most 100 entries, a 30-second operation deadline and an 8 MiB maximum version-page response; authorization/bucket responses retain the tighter 64 KiB limit. Scope mismatch, duplicate IDs, malformed/stuck cursors, unknown actions, provider errors, budget exhaustion or cancellation fail without partial-success flags. Console output contains only counts/flags, never names, IDs, tokens or file contents.

`versionPaginationExhausted` means only that the API returned a terminal cursor within this scan. Listings are not atomic: concurrent inserts or previously deleted versions can remain unknown. Snapshot consistency, immutable history, authoritative current-head trust and recovery safety remain explicitly unverified. The checker does not download/decrypt objects, create producer keys, upload/delete anything, modify lifecycle rules or enable ledger writes.

## Initial development public-recipient pin

The user approved reusing the verified development age public recipient on 23 November. Migration34 provides an empty policy catalog and a NOLOGIN staging capability, without granting an operator login. Pinning the recipient is a separate hosted configuration write: do not infer that approval from migration deployment or key selection.

From the repository root, prepare the local frozen plan using only `secrets/development-backup-recipient.txt` (the public recipient):

```sh
node --env-file=.env infra/scripts/configure-development-ledger-policy.mjs --prepare-plan
node --env-file=.env infra/scripts/configure-development-ledger-policy.mjs --check --target=nyjkrcznezyrgntwvpjj
```

Preparation validates the public recipient with an encrypted synthetic probe and preserves a canonical plan in ignored `.local/development-ledger-policy-plan.json`. It reads no recovery private key, creates no replacement key and makes no hosted write. The check verifies exact development target/TLS/owner, all34 migration checksums, isolated staging privileges and an empty or exactly matching initial catalog. Only fixed verification flags are printed.

After explicit approval of this exact initial pin, the reviewed apply command is:

```sh
node --env-file=.env infra/scripts/configure-development-ledger-policy.mjs --apply --target=nyjkrcznezyrgntwvpjj
```

Apply locks the policy table, rechecks prerequisites inside the transaction, inserts only the initial context, and accepts an exact idempotent replay. It rejects changed, disabled or additional history; rotation needs a separate reviewed operation. Keep both backup/ledger execution flags false. This enables no staging login, signing identity, provider credential, object upload, scheduler or restore reopening. If the public file or frozen plan changes, stop for review rather than regenerating a plan over an existing pin.

## Dedicated development staging operator (separate approval required)

The initial public recipient is now pinned. Ongoing preparation uses a dedicated `fmv_ledger_worker` identity; never use app or migration-owner credentials in the job. The reviewed bootstrap asset is `infra/postgres/create-development-ledger-operator.sql`. It creates the worker **NOLOGIN**, without a password, with a two-connection limit and only a SET-only membership in `fmv_ledger_stager`. Existing operators or unexpected capability memberships abort instead of being overwritten. Apply it only through the separately approved, verified development owner connection.

After that operator activation is explicitly approved, set its password privately in the established development owner psql session:

```sql
SET password_encryption='scram-sha-256';
\password fmv_ledger_worker
ALTER ROLE fmv_ledger_worker LOGIN;
```

Choose a strong unique password, keep it private, and save it in the password manager. The password prompt does not echo it or put it into SQL command history; see the [PostgreSQL psql reference](https://www.postgresql.org/docs/17/app-psql.html). No extra paper recovery identity is required for this replaceable database credential. Keep recovery **private keys** outside this operator entirely.

Add `DATABASE_LEDGER_STAGING_URL` privately to root `.env`, using the same verified session-pooler host, database and CA settings as the existing connections, but user `fmv_ledger_worker.nyjkrcznezyrgntwvpjj` and this worker's password. URL-encode reserved password characters. Keep `.env` mode600 and both execution flags false. Never add a VITE-prefixed copy. The CLI rejects owner/app identities, relaxed TLS, query-parameter overrides and unapproved memberships in either direction.

```sh
node --env-file=.env infra/scripts/prepare-development-ledger-events.mjs --check --target=nyjkrcznezyrgntwvpjj
```

Check mode is read-only and reports bounded counts only. A separately approved preparation run uses `--prepare` with the same explicit target. It scans at most10 currently unstaged events by identity, encrypts canonical bytes locally through pinned age without holding database locks, and stages the immutable winner. It reads no private recovery key and attempts no provider publication. A failed batch may have committed earlier events; retry safely selects only still-unstaged events. Counts report confirmed staging results, including a concurrent worker's winner, not necessarily newly inserted rows or complete source coverage.

The initial-pin tool deliberately refuses new operator memberships, so use it only for the initial configuration boundary. After provisioning the worker, use this dedicated operator's check and the reviewed membership/postflight checks; do not weaken the initial tool or silently repin. No scheduler, signer, B2 writer or restore reopening is enabled by these steps.
