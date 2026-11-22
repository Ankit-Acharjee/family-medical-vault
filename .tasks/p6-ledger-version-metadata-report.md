# DEL-03 — Read-only ledger metadata and version-discovery readiness

22 November: actual configured ledger destination preflight passed. Verified private bucket, distinct backup/ledger destinations, exact read-key prefix and absent lifecycle rules. No object operations or writes occurred during that preflight.

Continued with bounded prefix-scoped version metadata discovery, reusing the same authorization/private-bucket checks. Validates account/bucket/prefix, version IDs/actions/length/timestamps, pagination progress and limits. Counts older uploaded versions, hide markers and unfinished uploads without choosing an authoritative head. No names/IDs/tokens/file metadata values are printed. The API supports POST with JSON as documented at https://www.backblaze.com/apidocs/b2-list-file-versions.

Actual read-only version check passed: terminal cursor on one page, zero matching versions within the configured prefix. This proves the endpoint/key scope work on an empty prefix, not that nonempty historical recovery, Object Lock or immutability has been demonstrated. No file bodies downloaded, decrypted, written or deleted. No cloud settings/keys changed. Both execution flags remain false.

Independent GPT-6.2 Astra review identified the original 64 KiB shared JSON budget as too small for populated version pages. Added a separate bounded 8 MiB page budget while preserving 64 KiB for authorization/bucket metadata, plus an actual >64 KiB populated response regression and >8 MiB rejection. Astra rechecked with no blocking findings.

Verification: 44 infrastructure tests (including backup and ledger regressions), lint, formatting, secret detection and diff checks. Cases include hidden/older/unfinished versions, empty prefix, cross-scope records, invalid timestamps/IDs, duplicate IDs, missing/cyclic cursors, no progress, page/byte limits, cancellation and provider failures. Supervisor implementation plus native Astra review; no OpenCode worker used.

Pagination exhaustion is not an atomic snapshot, proof of undeleted history, authentic current head or safe service reopening. Real producer credentials/signing trust, durable intent/receipt ordering, independently authenticated head, hosted publication approval and complete restore reconciliation remain outstanding. No producer can write with the current reader-only setup; no actual ledger publisher, backups, purge or scheduler has been enabled.

The user subsequently approved fail-closed write completion: deletion/revocation deny locally immediately, completion is reported only after independent ledger confirmation, and failed confirmation remains pending. This defines the next backend slice; no write behavior is activated by the metadata scanner.
