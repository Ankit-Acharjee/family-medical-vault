# Private R2 and development integration

Prepared 11 November 2026 after pushing d122a73 to develop.
User approved this plan and the named SDK on 11 November 2026. Native Codex implementation is authorized. Credentials, provider writes and hosted migration execution retain their separate target/approval gates.

Update: the user explicitly approved development migrations for `nyjkrcznezyrgntwvpjj` on 11 November. Five pending migrations were applied and verified; the hosted schema now has seven successful migrations and twelve application tables. R2 provider-write approval remains separate. See [delivery report](r2-development-integration-report.md).

Provider update: after private configuration validation, the user separately approved the synthetic R2 roundtrip. Upload, exact-byte readback and exact-key cleanup passed; recovery metadata was retained. `R2_ENABLED` remains false pending the user's application-level testing.

## Deliverable

Connect the existing ObjectStore interface to a dedicated private development R2 bucket, preserving current authorization, original-byte integrity, upload recovery and preview/export separation. Apply only the already-reviewed development migrations after target/role/TLS/UTC preflight succeeds. Do not change UI design or add clinical features.

## Concrete dependency proposal

Add `@aws-sdk/client-s3` to `@fmv/server`, pinned to an exact compatible release when installed. Its transitive dependencies will be reviewed/scanned; add no presigner, multipart-upload framework or frontend package. Cloudflare documents this SDK for the R2 S3-compatible endpoint: https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/ . This uses a maintained signing/transport implementation instead of introducing custom AWS signing code.

## Parallel native Codex workflow after the dependency decision

1. Supervisor owns the configuration validator, SDK installation/lockfile, module wiring, public-URL prevention, deadline/error policy and development migration preflight.
2. Sol implementation worker owns `apps/server/src/documents/r2-object-store.ts`: PutObject, GetObject and DeleteObject only; explicit credentials, endpoint and bucket; no ambient AWS credential chain or public URLs.
3. Independent Sol worker owns adapter tests: exact bytes, missing/failed objects, partial streams, oversize reads, timeouts, retry/uncertain writes, compensation and redacted errors. Use an injected transport/local synthetic endpoint; no worker provider access.
4. A separate review checks adapter and configuration boundaries before supervisor integration. Preserve the existing 90 API/96 browser/14 database baseline and run focused new checks plus affected regression checks.

## Configuration and storage boundary

- Server-only environment configuration, disabled by default. Explicit account ID, bucket, access key ID and secret access key; derive the HTTPS R2 endpoint from a validated account ID instead of accepting arbitrary URLs.
- Missing/invalid enabled configuration fails closed with a sanitized error. Disabled storage keeps the existing honest unavailable state.
- Dedicated development bucket only. Keep public r2.dev access and custom-domain exposure disabled; do not add browser CORS/direct upload or presigned read links.
- Scope the R2 credential to object read/write on that bucket. Runtime bucket creation, public-access changes, listing unrelated buckets and credential administration are excluded.
- Validate opaque object keys and supported MIME/size at the adapter boundary. Read streams incrementally with a 25 MiB hard bound; reject missing/oversized/truncated responses. The intake core remains authoritative for checksum/signature verification.
- Use bounded SDK retries with an absolute per-command abort deadline that fits inside the existing metadata transaction timeout. Preserve stable object keys for idempotent retries and compensation; never log provider exceptions, request headers, keys or credentials.
- Before enabling R2, resolve uncertain deletion ordering: a timed-out DELETE can finish after a retry PUT to the same key and remove a newly READY object. A successful later DELETE does not prove the earlier request finished. Independently test this interleaving and select a durable solution (per-attempt object generations with retained cleanup manifests, or durable quarantine that prevents reusing uncertain keys). This may require a narrowly reviewed intake/metadata migration; do not conceal the risk in an in-memory adapter flag or a no-op remove implementation. Keep storage disabled until this gate passes.
- No real medical records in verification. Live verification uses a tiny synthetic document in the dedicated bucket and removes only the exact generated test object afterward; obtain concrete provider-write approval first.

## Development database preflight and application

- Confirm the intended dedicated development Supabase project and that owner/runtime URLs target the same database and application `fmv` schema. Inspect non-secret metadata only; do not print URLs/passwords or read them into worker prompts.
- Verify owner connectivity, TLS verification, current migration ledger and runtime `fmv_app` identity/privileges. Verify the hosted session pooler accepts UTC startup configuration and returns the expected timezone before writes.
- Check expected existing Person IDs/counts and table state. Stop on schema drift or failed/incomplete migrations; do not reset, baseline unrelated objects, rewrite ledgers or touch provider-managed `vault`/`auth` schemas.
- Apply reviewed pending Prisma migrations with the owner connection, then verify status, unchanged Person IDs, FORCE RLS/runtime privileges and API patient/access behavior through the runtime connection.
- Hosted writes require a clearly identified development target and separate approval; current local verification does not substitute for these checks. If blocked, continue SDK/configuration tests independently.

## Acceptance and exclusions

Successful live synthetic upload → finalize → list → preview/download must preserve exact bytes and audit writes. A revoked caregiver must be denied with the same session. Read/export permissions remain independent. Missing storage, provider failures and retries must not expose object keys or phantom READY items.

No Docker required for routine work. No paid service activation, billing acceptance, public buckets, medical data, backups deployment, OCR/AI, new routes or UI redesign. Cloudflare account/bucket setup must be performed explicitly by the user or separately authorized; do not paste credentials into chat.

## Decisions needed before dependent work

1. Approve the single SDK dependency above.
2. Identify whether the dedicated development R2 bucket already exists; if not, provide dashboard setup guidance without accepting billing or enabling public access on the user's behalf.
3. Confirm the exact dedicated development target before hosted migration/provider writes. The user can keep all passwords and keys in local restricted environment files.
