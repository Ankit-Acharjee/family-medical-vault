# DEL-03 — Independent restore-safety ledger boundary

Status: design/readiness only. The user is being asked whether encrypted deletion/revocation evidence must remain while any affected backup exists, with automatic evidence deletion disabled until a separate critical-event retention policy is approved. No retention duration, statutory basis, hosted write, Object Lock setting or purge authority is inferred.

## Necessary evidence

Only opaque event/resource identities, exact lifecycle/version, transition kind, ordering and timestamps belong in the encrypted evidence envelope. Do not include patient names, original filenames, extracted text or clinical facts. Initial scope must cover document deletion/Trash/Restore version transitions and effective grant/link revocations; permanent-purge evidence cannot be implemented before its legal-exception and propagation policy is settled. Existing source DB audit rows alone are not independent evidence.

## Required security and crash behavior

- Use storage independent of the primary database, isolated producer credentials and separately trusted verification keys. An encrypted, signed record is not enough if the expected sequence/high-water mark is unknown.
- A transactional source outbox alone cannot prove recovery safety after losing the source DB: an acknowledged revocation may not yet have reached the independent store. Model the event/receipt/publication ordering and each crash window. Do not silently reopen from a stale independently exported prefix.
- Revocation must deny subsequent source operations even during backup-provider failures. A restored environment must remain closed when independent evidence completeness cannot be proven. Any owner-assisted fallback or bulk reauthorization would need its own explicit product policy; do not invent one.
- Reconciliation must be idempotent, exact-resource/version bound, preserve history and invalidate dependent grants/links/derived data. A later Restore must not silently reactivate older links or trusted facts.
- Apply and verify evidence before enabling routes, background processing or external links in the recovered environment. Unknown gaps, conflicting versions, failed signatures or missing evidence fail closed.
- B2 writeFiles can create/hide newer object versions ([official hide-file API](https://www.backblaze.com/apidocs/b2-hide-file)); a write-only credential is not by itself proof of immutable/WORM storage. Version discovery, independent receipt anchors and any Object Lock/retention configuration require explicit validation. Never promise immutability based on a dashboard key label.
- Do not add an ambient administrator HTTP bypass. Operational restore work needs a narrow isolated tool/credential boundary, separately approved hosted execution and synthetic crash/race tests first.

## Remaining integration gates

Define protected storage/receipt trust and source-loss behavior; obtain the retention decision; provision separate constrained write credentials; test out-of-order delivery, missing tail, overwritten/hidden versions, database loss, rollback and failed reconciliation; then seek concrete hosted-write approval. No real ledger, producer signing key or hosted write exists yet.
