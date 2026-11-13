# Next slice: Find within current extracted text

Status: implemented and verified under the user-approved autonomous roadmap workflow, after selected-page PDF OCR was reviewed and pushed as 35d97fa.
Requirements: bounded DOC-05 progress, preserving AI-01/AI-05/AI-06 and current authorization. This is not persisted extraction or vault-wide full-text search; indexing remains an open architecture decision.

## Scope
- Reuse the common extracted-text presentation for embedded PDF text and image/selected-page OCR.
- Offer a clearly labeled local Find field against only the currently displayed extracted text, with literal case-insensitive matching, safe text-node highlighting, match count, Previous/Next and Clear.
- Preserve every page/source label, original text, unverified disclosure and partial-output warning. Do not infer clinical facts or add requests, processing, persistence, URL state or background extraction.
- Bound query length to 200 characters and rendered matches to 500; disclose capped counts. Define punctuation and Unicode behavior explicitly; never interpret user text as regex or HTML.
- Keep query/results local to the current result identity. Clear on source/page change, retry, revalidation, denial, Trash, close or session/patient change through the existing result lifetime.
- Reuse existing Input/Button, semantic colors, focus patterns and both canonical themes; no global styling or approved Overview changes.

## Delegation and acceptance
1. Supervisor owns result lifetime, bounded matching semantics and integration; independent native review checks privacy and accessibility.
2. Bounded worker implements the pure matching helper and meaningful adversarial tests; a separate worker can implement synthetic browser tests after the interface is frozen. OpenCode receives sanitized interfaces only when useful, never private source.
3. Verify literal punctuation, mixed case, Unicode, unsafe markup as text, page boundaries, no-match/clear states, capped matches/500k source, source invalidation and no additional network/storage.
4. Verify keyboard navigation/focus, mobile overflow, both themes and existing PDF/image OCR behavior using the configured frontend toolchain.
5. After review and required checks pass, commit with context and push develop under standing authorization. No hosted writes, new providers or dependencies are proposed.
