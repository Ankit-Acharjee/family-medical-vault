# P3 accessible clinical confirmation history

Status: implemented and verified; see `.tasks/p3-clinical-history-report.md`.

- LAB-01/LAB-02 and AI-03/AI-05: make earlier immutable owner-confirmed sets accessible from the existing saved-text review, so retained provenance can actually be inspected.
- Current View is required on every read; no additional verification or edit authority. Read one previous set per request using a strictly bounded revision cursor and existing document lock/authorization; no schema migration or original-file access.
- Show immutable raw fields, source excerpts, extraction provenance and original confirmation time. Older extraction evidence must not jump into a different current source revision. Never allow historical entries to overwrite current review or prefill corrections for a different source.
- Keep existing latest review and unsent drafts stable. Hide/clear protected history during source/access/context changes. Handle no history, load failure/retry, stale context, denial, keyboard/focus and mobile/light/dark accessibly using existing primitives.
- Root owns authorization/store integration and final review. Delegate only a sanitized generic revision-pagination invariant review to sandboxed GLM; no private source/records/credentials supplied. Native Astra/Sol quotas remain exhausted.
- Verify current/denied reads, deterministic cursor validation, source/lifecycle fences, immutable originals, exact historical evidence and failed/retry paths. Add native database, HTTP/contracts and actual desktop/mobile browser checks; then commit/push develop and proceed without routine approval.
