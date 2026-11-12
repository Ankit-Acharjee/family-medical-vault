# Approved patient-first object layout — DOC-02 / DOC-07

The user approved option 1: `originals/v1/<patient-storage-id>/<document-id>/<attempt-id>`.

- Each Person receives a database-generated, immutable storage namespace independent of their permanent Person ID. Namespace values are backend-only and do not authorize access.
- New documents and retries share their patient/document prefix; every attempt gets a fresh opaque key. Existing flat keys, bytes, identities, permissions, generation manifests and idempotency semantics remain intact.
- New additive migration: `20261111000200_patient_object_layout`. Existing applied migrations were not edited. No R2 copying, renaming or deletion is part of this change.
- The repository AGENTS.md now records complete UI lifecycle verification, stable draft/form identity and layout through native picker/focus events, success dismissal, partial retry and focus restoration.

## Verification

- Final full server suite passed all 138 tests after the strict-length and namespaced SDK test additions. Server build, typecheck and scoped lint passed; the affected key/intake/SDK suite also passed all 53 tests.
- Final disposable PostgreSQL suite: 16 passed, including eight-migration deployment, legacy-object compatibility, namespace privacy/immutability, restricted runtime privileges, deferred ownership FK and generation retirement. Docker was not used.
- Secret detection and diff checks passed. Independent native Codex review found no critical issues.
- Hosted read-only preflight verified project `nyjkrcznezyrgntwvpjj`, owner/runtime target agreement, verify-full TLS, UTC, restricted runtime role and checksums for seven applied migrations. Exactly the new layout migration is pending.
- The user separately approved this development migration. Execution succeeded against the verified target, bringing the checked migration ledger to eight entries. Private before/after digests confirm Person/account identities, document keys/states and all object-generation manifests are unchanged.
- Hosted post-verification confirmed populated, distinct private namespaces, the enabled immutability trigger, no runtime namespace UPDATE/table DELETE/schema CREATE privileges, and FORCE RLS on all twelve application tables. No R2 objects were written, moved or deleted.
- Final Chrome regression run: 61 passed, one intentional redundant mobile layout case skipped, zero failures across authentication, patient context, document vault and upload lifecycle. Actual fixture screenshots remain under `.local/screenshots/upload-{light,dark}-{desktop,mobile}.png`.
- Delegation resumed with native GPT-6.1 Sol validation and an OpenCode `glm-5.3-flash-free` text-only lifecycle review in an OS sandbox blocking repository/home data. Only a synthetic summary was shared. Its retry/revalidation/in-flight hypotheses require source-level evidence; existing regression and storage tests, rather than the external summary review, establish the implementation results above.
