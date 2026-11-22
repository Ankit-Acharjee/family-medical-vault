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
