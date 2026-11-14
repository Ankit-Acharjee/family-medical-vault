# P3 — Local metadata suggestions delivery

- Incremental DOC-03 / AI-02 / AI-05 slice: source-linked, unverified type/date/provider/label suggestions in Saved text. Full persisted classification, acceptance and clinical verification are not implemented by this slice.
- Suggestions use conservative deterministic English headings/explicit labels; no external processor, model inference, new API, hosted write, migration, dependency or category/grant/timeline change.
- Keep original date wording and visible report/collection roles. Ambiguous numeric dates are tentative; invalid dates, unrelated clinical fields and overlong lines abstain. No calibration/accuracy percentage is claimed.
- Page/exact excerpt, saved revision, method and rule version preserve context. Character-capped final lines are excluded, duplicate date roles remain distinct, and existing partial/OCR warnings remain visible.
- Default-collapsed native disclosure keeps source Find accessible; evidence is keyboard accessible with semantic theme tokens and responsive wrapping. Existing View/revalidation/denial behavior controls all derived displays.

## Files

- `apps/web/src/features/documents/metadataSuggestionRules.ts`: bounded pure rules, caps/dedup, literal provenance and truncated-line protection.
- `apps/web/src/features/documents/MetadataSuggestions.tsx`: compact read-only disclosure and evidence.
- `apps/web/src/features/documents/SavedExtractionDialog.tsx`: authorized-snapshot integration only.
- `apps/web/test/metadata-suggestions.test.mjs`: 13 helper tests, including negative/adversarial/bounds/date-role/truncation cases.
- `apps/web/test/fixtures/metadata-suggestion-vectors.json`: sanitized synthetic worker-generated inputs, independently corrected expectations.
- `apps/web/e2e/saved-extraction.spec.ts`: existing regression suite plus metadata/revision/retry/revocation/character-limit and visual tests.
- `.tasks/p3-metadata-suggestions-plan.md` and this report: scope, review and evidence.

## Actual review and verification

- Native Sol workers implemented independent rules/tests and UI. Astra reviewed architecture and final source; all findings fixed (upstream character truncation, visible date role, role-aware React keys). Root independently integrated, reviewed and verified.
- OpenCode `opencode/glm-5.3-flash-free` produced synthetic adversarial vectors from a generic interface-only brief in `/tmp/fmv-metadata-worker`; OS sandbox denied home/project access. No private source, credentials or records were supplied. Root corrected its future-date and Unicode-match assumptions before tests.
- Passed: 13 Node helper tests; 38 development-browser checks; 12 built-preview browser checks (overlapping cases, not 50 distinct cases). Browser APIs were intercepted with synthetic fixtures, not hosted end-to-end validation.
- Passed: web build/typecheck, repository lint/format/secrets and diff whitespace checks. No Docker session was needed.
- Rendered screenshots inspected at 1440px desktop and 320px mobile in both themes, collapsed and expanded. Axe, keyboard disclosure/focus restoration, source Find, reduced-motion, no horizontal overflow and no external requests passed. Evidence: `.local/screenshots/metadata-{compact,suggestions}-{light,dark}-{desktop,mobile}.png` (local ignored files).
- Limits: explicit supported line grammar only, max 12 suggestions / 50 pages / 500k UTF-16 units / 5k lines per page. Arbitrary layouts/languages and handwriting are not guaranteed; partial extraction can omit suggestions. Saved-text source hashes are linkage, not proof of transcription truth.
- Next: define persisted metadata acceptance/correction and date/provider semantics before changing document organization; related-document inference and clinical review remain pending P3 work.
