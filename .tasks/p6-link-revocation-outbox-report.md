# DEL-03 / SHARE-02 — local revocation evidence foundation

Approved 22 November: independent confirmation is required before reporting protected completion; local denial must survive ledger failure. This slice prepares local evidence only, not completed independent protection.

The source link's immutable revoked_at is the durable pending intent. An explicit restricted definer function copies only that existing link ID, patient ID, timestamp and fixed event kind into an append-only runtime-read-only table. Uniqueness makes retry idempotent. No token, document snapshot, name or clinical value is copied. No source foreign key or cleanup job removes evidence; a DELETE guard retains revoked source intents, including ordinary parent cascades, until a separately implemented receipt/retention policy exists. Neither the source intent nor its local copy is an independent receipt or gap-free external sequence.

Astra review rejected the first atomic trigger design: capture failure rolled back local denial. Replaced it before release with separate post-commit capture; source revocation has no new ledger dependency. No publisher, independent receipt, owner-facing completion projection or automatic restore reopen is activated here. Existing API/UI local-revocation wording remains a subsequent integration dependency, not proof of the approved end-to-end policy.

Actual workers: native GPT-6.2 Astra independent architecture/security review; native GPT-6.1 Sol bounded synthetic database tests. Supervisor owns SQL/model/integration. No OpenCode execution claimed.

Verification: final native28 plus encrypted synthetic restore drill passed after review correction; infra44, lint, formatting, secret detection, Prisma validation/build and diff checks passed. Direct intent deletion, projection failure/retry and non-bypass owner are exercised. Parent cascade is covered by the guard definition but not isolated by the fixture, whose other restrictive FKs also prevent parent deletion. Hosted read-only TLS/UTC/restricted-role and32 checksum preflight passed. Migration 33 is local only; development currently has 32 applied. Separate hosted approval required. No actual records or keys used by disposable native tests.

Next: integrate explicit post-commit capture and pending-protection owner response without a false confirmed state; provision narrowly scoped independent producer/signing trust with separate hosted-write approval. Retain source pending intents; do not enable cleanup or infer source-loss coverage from an empty queue/listing.
