# R2 integration contract — approved 11 November 2026

Root owns all production intake/store/schema/config/module changes and dependency installation. Workers do not touch secrets, Git, providers, dependency manifests or schema.

## Adapter
Implement `R2ObjectStore(config:R2Config, sender?:R2Sender)` preserving ObjectStore, with `destroy()` lifecycle method. Root creates `storage.config.ts`: R2Config `{accountId,bucket,accessKeyId,secretAccessKey}`; `storageConfig(env=process.env):R2Config|null`. Endpoint derived `https://${accountId}.r2.cloudflarestorage.com`, region auto, explicit credentials, no default AWS chain. Enabled config validated; disabled returns null.
Injectable sender interface may use `send(command: PutObjectCommand|GetObjectCommand|DeleteObjectCommand, options:{abortSignal:AbortSignal}):Promise<unknown>` for tests; export it and check every unknown result at runtime. Adapter owns one total 8s deadline per command including stream consumption, no SDK mutation retries (`maxAttempts:1`); consume GET incrementally <=25MiB, validate content length/body/truncation, destroy stream on all exits. Key exact32lowerhex, bucket validated, MIME accepted formats/bytes1..25MiB, all failures sanitized. Configured-ready is not a provider health claim. No startup API call, presigners, direct browser access, bucket administration or public ACL parameters.

## Durable object generations (root production implementation)
Never PUT a previously used key. A retry keeps upload/document/idempotency identity but uses a new opaque key.
`IntakeMetadata` gains `reserveObject(documentId):Promise<string>`, `useObject(uploadId,objectKey):Promise<void>`, `objectActive(objectKey):Promise<boolean>`, `retireObject(documentId,objectKey):Promise<void>`.
`reserveObject` must commit an immutable object manifest in a separate metadata connection before any external PUT. `retireObject` must commit retirement before any external DELETE; it refuses a READY current key. These durable writes survive outer upload-transaction rollback. Core metadata locks serialize operations for the upload. The separate manifest pool avoids nested pool starvation.
The new `document_object_attempts` table records key/document/createdAt/retiredAt. Existing keys backfilled; begin creates initial empty manifest atomically. Runtime only INSERT/SELECT/retire timestamp update, no DELETE. Parent object-key pointer may update only while non-READY to a reserved active key for that document. Never delete manifests automatically. Retired/unreferenced manifests retain recoverable orphan information.
Content: authorize/validate; READY returns unchanged; retire/compensate old key; reserve fresh key; switch pointer in outer tx to fresh key; write bytes; pending until finalize. On write failure mark failed, durable-retire fresh key, then compensate. Finalize/read reject retired keys, including after outer transaction rollback; existing READY errors never delete the object. Delayed DELETEs can affect only retired generations, never a retry generation. Aborted PUT may leave retired orphan bytes, whose manifest stays recorded for later exact-key cleanup.
Any future cleanup process must use the same upload lock, refuse READY/current active keys and never delete/reassign manifests. This batch does not introduce a background cleanup scheduler.

## Tests and ownership
- Adapter worker: only `r2-object-store.ts`; unit self-checks can use a separately assigned test file if root agrees.
- Independent adapter tests worker: `test/r2-object-store.test.mjs`, `test/storage-config.test.mjs` only.
- Intake regression worker: `test/document-intake.test.mjs`, `test/support/document-fixture.mjs`, necessary expectations in `test/documents.test.mjs` only. Memory metadata models durable manifests outside transactional snapshot rollback.
- Root updates actual PostgreSQL integration tests and module/config tests, preserving current routes/UI and baseline behavior.
