# Private R2 development setup

This runbook supports DOC-02 and DOC-07. It covers a dedicated **development** bucket and synthetic verification; it is not a production deployment or backup procedure. Creating provider resources, accepting billing terms, hosted migration writes and live object writes require their own authorization. Do not use real medical records for this check.

## Prepare private resources

1. In the intended Cloudflare account, create or identify a dedicated development bucket. Follow [Cloudflare's bucket guide](https://developers.cloudflare.com/r2/buckets/create-buckets/). Confirm that public `r2.dev` access is disabled and no custom domain exposes the bucket. Do not configure browser CORS, direct browser uploads or presigned URLs.
2. Create an R2 API credential limited to object read/write for that bucket, following [Cloudflare's R2 token guide](https://developers.cloudflare.com/r2/api/tokens/). Do not grant bucket administration or access to unrelated buckets. The server uses the [AWS SDK for JavaScript v3 with R2](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/) and derives the HTTPS endpoint from the account ID.
3. Store `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` only in the ignored repository-root `.env`, following `.env.example`. Restrict it with `chmod 600 .env`; do not paste credentials, database URLs or `.env` contents into chat, logs or tickets. These values are server-only: never use a `VITE_` prefix or configure a public R2 URL.
4. Keep `R2_ENABLED=false` until the schema and checks below are complete and the synthetic live check has been explicitly authorized. Configuration readiness alone does not establish provider connectivity or bucket privacy.

## Database preflight and migration

Identify the dedicated development database before doing anything that writes to it. Privately verify that the migration owner and restricted `fmv_app` runtime connections target the same intended database and `fmv` schema, that TLS certificate verification succeeds, and that the hosted session pooler accepts the UTC startup setting and reports UTC. Inspect only non-secret metadata; do not print connection strings. Record the existing Person IDs/count and relevant table state securely for comparison.

From the repository root, check the migration ledger using the owner connection configured in the root `.env`:

```sh
pnpm --dir apps/server exec node --env-file=../../.env ./node_modules/prisma/build/index.js migrate status
```

Verify the actual ledger and schema against the reviewed files in `apps/server/prisma/migrations`, including object generations, private patient layout, display titles and protected document Trash. The application has twelve runtime tables; migration count is determined by the reviewed files and ledger rather than a fixed count in this runbook. Stop on unexpected drift, failed or incomplete migrations, an uncertain target, or failed TLS/UTC checks. Do not reset the database, baseline unrelated objects, alter the migration ledger, or touch provider-managed `auth` or `vault` schemas.

**Only after explicit approval for the identified owner connection and development target**, apply reviewed pending migrations from the repository root:

```sh
pnpm --dir apps/server exec node --env-file=../../.env ./node_modules/prisma/build/index.js migrate deploy
```

Run `migrate status` again and verify unchanged Person IDs/count, the expected schema, FORCE RLS and restricted runtime privileges. Check patient/access behavior through the runtime connection. Preserve existing identities and records; these migrations are additive and must not be applied by resetting the database.

## Enable and verify

The adapter can be checked while `R2_ENABLED=false`, without enabling application uploads. Once the four private settings are configured and the server is built, inspect only the target fingerprint:

```sh
node --env-file=.env apps/server/tools/r2-smoke.mjs --show-target
```

This command makes no provider request and prints no account, bucket or credential values. **After separate approval for that private development bucket**, run the exact-target synthetic check, replacing the fingerprint placeholder:

```sh
node --env-file=.env apps/server/tools/r2-smoke.mjs --confirm-private-development-write --expect-target=APPROVED_FINGERPRINT
```

It writes one fresh synthetic object, verifies exact returned bytes and requests deletion of only that generated key. It never lists, reads or deletes existing application objects or changes database rows. A private immutable recovery reservation is fsynced before provider IO under `.local/r2-probes`; it remains after cleanup because a timed-out PUT can finish later. Do not publish these journals or use the probe as a general deletion tool. Failed probes require review of that exact private journal; cleanup acknowledgement is not proof that an ambiguous remote write cannot finish later.

After the migration and all target, TLS, UTC, runtime-role and privacy checks pass, obtain explicit approval for the synthetic live provider write. Only then set `R2_ENABLED=true` in the restricted root `.env` and start the server with its server-only configuration. If any prerequisite fails, leave or return it to `false` and investigate without exposing secrets. `GET /health` is process liveness, not an R2 connectivity or privacy check.

With approval, use a tiny synthetic document and exercise upload, finalize, list, preview and authorized download; verify downloaded bytes match the original. Confirm a revoked caregiver is denied with the same session and that view and export permissions remain independent. Cleanup needs a separately reviewed exact-object procedure that first ensures the object is not READY or current; no general cleanup or safe application deletion workflow is implemented yet. Never record object keys, credentials or medical content in shared output. Report failures without raw provider errors.

## Original-object layout

DOC-02/DOC-07 originals use `originals/v1/<patient-storage-id>/<document-id>/<attempt-id>`, with lowercase opaque identifiers. The patient storage namespace is generated independently of the permanent Person ID and cannot be changed. Each retry reserves a fresh attempt key in the same document group before object IO; category, filename and clinical metadata remain in PostgreSQL. Prefixes do not confer authorization.

Migration `20261111000200_patient_object_layout` adds private patient namespaces and widens the existing key constraints without rewriting any document keys or copying/deleting R2 objects. Existing flat keys remain readable and retain their generation manifests. Apply this migration through the separately approved development-owner connection before using the updated uploader. Moving existing originals requires a separate exact-object migration plan and is not part of this change.

## Recovery and cleanup

Disable R2 if verification fails. Keep the additive tables and migration history in place; rollback does not mean resetting the database or deleting existing objects. Retired and unreferenced object-generation manifests are retained for recovery, and automated cleanup is not implemented. Any future cleanup must take the same upload lock, refuse READY/current active keys, and preserve manifests; it must never delete a READY key or reuse an object generation. Review a concrete recovery plan before acting on orphaned objects.
