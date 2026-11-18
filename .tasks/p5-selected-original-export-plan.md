# SHARE-01 — next slice: selected-original ZIP export

Status: readiness inspection started after summary-export commit `ca63bcd` was pushed to develop. Summary export migration26 is now separately approved, applied and verified on development. No additional hosted write is authorized by this plan.

## Existing foundations and authority

`DocumentsService.read(..., 'export')` and `DocumentIntake.read` already validate current document Export permission, READY/non-Trash state, active object identity and actual bytes/hash, auditing source access and rechecking permission. `DocumentsController.bytes` uses private no-store/nosniff/attachment/CSP headers. Preserve those independent per-document semantics: summary-wide View + Export is specific to aggregate summaries, not a new prerequisite for an independently authorized original download. Do not silently add a View prerequisite or patient-wide Export requirement to original exports. The user selects explicit documents within one patient; never default to all records or include derived clinical data.

## Proposed implementation boundaries

1. Reuse the installed server-only ZIP writer. Add a strict bounded selection contract and a guarded POST, with current session/Origin/CSRF. Bound selected count and aggregate bytes explicitly; validate metadata/size before object reads, retrieve sequentially and cap active archive generation. No plaintext temp files or persistent/public artifacts.
2. Pre-authorize every selected source before fetching any file. Revalidate all selected source identities/lifecycle and permissions after generation and immediately before delivery. One denied, stale, missing, oversized or failed source rejects the whole archive; do not silently export a partial selection. Avoid holding a database lock while fetching remote bytes or rendering an archive.
3. Preserve original bytes, MIME and SHA-256 exactly. Use fixed, server-generated UUID paths and validated MIME extensions instead of user filenames as archive paths. A JSON manifest may carry authorized display names and source fingerprints without object keys, account identifiers or unselected records. Test path/control/Unicode and duplicate filename cases.
4. Integrate explicit document selection and patient-specific confirmation into existing Documents controls, without refactoring unrelated layouts. Explain originals-only contents, exact selected count/size and irreversible downloaded copies. Stable selection during same-context rechecks; abort/clear protected selection on context change or denial. Check keyboard/focus, 320px, both themes, cancellation and safe explicit retries.
5. Reuse ordinary source-access auditing truthfully; determine whether a separate batch-generated audit is required before changing schema. Any new hosted migration remains separately approved. Do not reuse summary audit scope/meaning incorrectly or call a generated/read event confirmed delivery to disk.

## Required verification / remaining design work

Inspect existing document-list selection patterns and all relevant store transaction/authorization hooks before implementation. Decide concrete count/byte limits consistent with 25-MiB originals and limited local resources. Cover independent Export-without-View cases, mixed scoped grants, cross-patient IDs, duplicate selection, revocation/expiry/Trash/Restore and byte/source changes, object-fetch failures, cancellation, archive integrity and audit failure. Browser tests must intercept synthetic APIs before navigation and capture actual mobile/desktop light/dark confirmation/download states. Keep existing per-document download/preview/upload/search/Trash behavior intact.

No selected-original runtime code, policy expansion, dependency addition, hosted write or fake data has been introduced by this readiness document. Codex-native review availability remains limited; do not claim independent agent signoff or fall back to OpenCode.
