# Non-destructive duplicate warnings — DOC-06

Approved 12 November 2026. Base: develop at 71da796.

## Behavior and privacy
- Completed uploads and already-READY begin replays can return `potentialDuplicate: true` when another READY original for the same patient has the same SHA256 and byte count, and current independent view or export permission covers that existing record. Names and display titles do not drive matching.
- No flag is returned for hidden matches, upload/edit/manage-only grants or no match. Matching titles, identifiers, hashes, keys and counts are never added to the upload response. Permissions are re-read after metadata IO, including a final current upload check.
- Existing metadata listing supplies the server-side comparison; no schema/query change, object fetch, copy, merge or deletion is introduced by detection. Each independently uploaded original remains stored. A duplicate-metadata lookup failure suppresses the advisory without changing committed READY state; inability to authorize an operation still fails closed.
- Generic accessible feedback preserves full-success modal dismissal and focus restoration. Partial batches retain their failed items and retry only those using existing idempotency keys. Advisory flags expire on retry and access revalidation; file drafts remain intact. Page feedback is bound to the current patient and clears on new upload, patient/session change or revalidation.
- This is potential exact-byte duplicate detection, not OCR/page similarity, clinical equivalence or automatic deduplication. An omitted warning is not a guarantee that no duplicate exists.

## Delegation and checks
OpenCode `glm-5.3-flash-free` generated the small semantic-token warning presentation from a synthetic interface brief within an OS sandbox blocking project/home data. The supervisor reviewed/integrated it and owns matching/authorization. Native GPT-6.1 Sol independently implemented API/browser tests and reviewed the integrated change; no actionable security/lifecycle findings remained.

- Full server suite: 167 passed, including 22 dedicated duplicate privacy, scope, revocation, idempotency, integrity-metadata and failure tests.
- Dedicated Chrome browser suite: 25 passed; one redundant mobile visual case skipped because its desktop case explicitly tests desktop/390px/320px in both themes. Includes true/absent/false flags, malformed responses, partial retries, READY replay, context invalidation, late responses, focus and accessibility.
- Affected existing upload/document/browsing regressions: 39 passed, one existing redundant mobile visual case skipped. Final success-dismissal and viewport/theme checks passed again after placing feedback under the page heading, where it is visible after the modal closes. Six persistent actual-browser screenshots are saved under `.local/screenshots/upload-duplicate-{light,dark}-{1440,390,320}.png`; mobile and desktop images were inspected for wrapping and clipping.
- Server build/typecheck, web build/typecheck, focused lint, formatting and secret detection pass. No new dependencies, hosted writes or Docker. Database schema and query structure are unchanged, so the previously verified native PostgreSQL suite was not unnecessarily repeated.

## Files
- `packages/contracts/src/index.ts`: optional advisory flag.
- `apps/server/src/documents/documents.service.ts`: authorized advisory calculation after persistence/replay.
- `apps/server/test/document-duplicates.test.mjs`: independent synthetic API regressions.
- `apps/web/src/features/documents/DuplicateUploadNotice.tsx`: generic accessible presentation.
- `apps/web/src/features/documents/index.tsx`: validated result parsing, partial-batch advisory lifecycle and completion context.
- `apps/web/src/App.tsx`: patient-bound successful upload feedback.
- `apps/web/e2e/upload-duplicates.spec.ts`: actual App lifecycle/privacy/responsive tests.
- This report and the approved task plan.
