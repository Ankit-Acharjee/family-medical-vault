# Core application acceptance — 24 November

User direction: keep both application and infrastructure simple. Set aside the Lambda/independent-signer expansion; do not add providers or durable stores without a concrete requirement and approval. Preserve working B2 configuration and the user's recovery copies. Bitwarden is optional personal password/recovery-key storage, not an application dependency and not something family users must install.

## Current task: Overview search handoff (DOC-05, UX-04/05, F-03)

Observed gap: the Overview/shared search field was always disabled and said search was unavailable, although authorized metadata/saved-text search already exists in Documents. Connect this entry point to the existing implementation rather than adding a second search service, API or index.

Implementation: selected-patient search form with Enter and labeled44px submit control; transfer a one-shot patient-bound query in React memory to Documents. Keep queries out of URL/history parameters, storage and logs. Reuse existing filters, current-permission checks, POST search, incomplete-result errors and no-results states. Disable without validated patient context; preserve same-patient focus revalidation while clearing state on actual patient/access change. Consume only after matching context is validated and discard unconsumed handoffs when navigating away.

Supervisor owns integration; native Sol supplies synthetic browser acceptance tests. Astra reviews patient/refresh/history boundaries. Follow existing semantic tokens, accessible Button/Input and approved layout; no redesign, new dependency, backend contract or database change.

## Acceptance batch

- Upload: file-picker return/cancel, retained queue, partial failure/retry and automatic success dismissal.
- Find/view: Overview handoff, metadata/saved-text matches, no-result/error recovery and original preview/download.
- Isolation: patient switches, permission revocation, late responses and browser history do not replay another context.
- Share/export/Trash: only current authorized sources are exposed; existing expiry and denied states remain usable. Any unresolved recovery-release requirement stays documented instead of prompting new infrastructure automatically.

Run existing focused browser suites with fully intercepted synthetic APIs in desktop/mobile and both themes. No live medical records, storage writes or new provider account is required. Record actual results before marking a flow verified; synthetic checks do not claim live production acceptance.

## Search delivery verification

Native Sol supplied20 desktop/mobile browser cases; supervisor corrected synthetic category data and a test helper shadowing the browser document global. Astra identified the initial-mount focus-refresh race; supervisor delayed seed consumption until the matching validated patient returns. Final review found no blocking issue.

The finalized combined run passed78 of80 cases; two existing mobile multi-viewport accessibility checks exceeded their30-second browser-evaluation budget. Both passed unchanged when rerun serially (17.6seconds total). Thus all80 acceptance/regression cases were observed passing, with the initial timeouts recorded rather than hidden. New search cases all passed, including keyboard/button, metadata plus saved-text results, incomplete-search recovery, patient switch/revocation, history, focus revalidation, 320px overflow and axe in both themes.

Supervisor inspected actual1440px desktop and390px mobile screenshots in both themes under `.local/screenshots/overview-search-*.png`; search controls and result handoff remain within the existing approved presentation. Synthetic screenshots remain ignored. Web typecheck/build, lint, formatting, secrets and diff checks passed. The existing large-bundle build warning remains; no unrelated performance refactor was introduced. No backend/API/schema or live-provider check was required for this handoff.

Next observed gap: global Upload with no selected patient offers a dismiss-only "Got it" message. Reuse PatientPicker in that same dialog and continue to the existing upload form after explicit choice, preserving permission denial, keyboard focus and cancellation behavior. No new feature/service or auto-selected patient.

## Upload entry delivery — 25 November

The existing patient picker now occupies the upload dialog until an explicit patient choice; the same dialog continues to the existing upload form. A one-time transition focuses its accessible title; cancellation restores the original Upload trigger. No automatic patient choice, backend permission change, API, database or infrastructure dependency is introduced.

Explicit dialog-step state retains the patient picker through access refreshes before selection, preserving managed-profile drafts and uncertain-creation request IDs. After selection, the existing file form stays mounted through same-patient revalidation and clears on actual access loss. Opening Upload during an in-progress refresh also synchronizes to the confirmed selection, preventing the next refresh from discarding its file queue. Astra identified both refresh edges and independently reviewed the final source with no material findings.

Native Sol supplied the initial entry, permission, cancellation, draft and idempotent-creation tests; the supervisor added the opening-during-refresh queue regression. The focused16 desktop/mobile cases passed against synthetic API fixtures. Existing upload focus/duplicate/shell regressions and final presentation captures are the remaining verification step before pushing this slice. No hosted uploads or real profile creations were performed.

Final upload verification:70 browser cases passed, with2 existing mobile skips for tests that explicitly exercise all viewport sizes in the desktop project. This includes all16 new entry cases, native-picker return/cancel, partial-batch retry, success dismissal, context/permission loss, both-theme axe and keyboard focus. Supervisor inspected1440px light desktop and390px dark mobile patient-selection/file-form screenshots. Build/typecheck, lint, formatting, secrets and diff checks passed. No app dependency, provider, backend or database change was needed.

## Core vault acceptance batch complete — 25 November

After pushing upload fix b6384d6, all46 existing vault/preview, selected-original export, shared-recipient and Trash browser cases passed serially in desktop/mobile Chrome. Coverage includes original bytes/integrity, export-only versus View rights, failed/stale/cancelled delivery, context refresh, expiry/revocation, hidden token fragments, patient switching, source retry/finalization and both-theme narrow-screen accessibility. No additional implementation defect was observed in this batch and no new service was introduced to obtain the result.

These are intercepted synthetic frontend acceptance checks, not proof of hosted production behavior, complete disaster recovery or a real-family pilot. The bounded core application batch is complete; broader identity/emergency/deployment and recovery gaps remain as recorded in the completion assessment. Do not return automatically to Lambda/signing infrastructure or count this verification as finishing the entire roadmap.

## Caregiver and activation acceptance — 25 November

Following recent-document delivery2160e54, existing family-access, managed-profile and profile-activation browser suites passed26/26 in desktop/mobile Chrome with synthetic API fixtures. They cover explicit scoped invitation/proposal approval, no automatic claim, explicit managed creation/selection, idempotent uncertain retries, consent reset on refresh, creator-only activation approval, existing-identity deferral and protected-state clearing on denial. No new defect, hosted change or product feature was introduced. This verifies existing frontend behavior against controlled responses, not real email/OAuth delivery or a production identity transfer.
