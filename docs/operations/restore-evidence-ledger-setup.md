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
