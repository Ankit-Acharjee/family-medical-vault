# Find within extracted text — DOC-05 continuation

Approved under the autonomous development workflow, following selected-page PDF OCR commit `35d97fa`. This is local Find within the currently displayed extraction, not persisted extraction, vault-wide full-text search or completion of P3.

## Behavior

Embedded PDF text, image OCR and selected-page PDF OCR share the same result presentation. A labeled **Find in this text** field performs literal, Unicode-aware case-insensitive matching within each displayed page. Punctuation is escaped, source spelling/UTF-16 offsets stay intact, matches never join page boundaries, and original text is rendered through ordinary React text nodes. There is no HTML interpretation, clinical inference, additional acquisition or external processing.

The query is limited to 200 UTF-16 code units, matching native input maxlength behavior. At most 500 nonoverlapping matches are highlighted; finding another match produces an explicit capped-count/refine message. Previous/Next wrap within that displayed set; Enter/Shift+Enter work from the field, Clear restores field focus, and active navigation scrolls only the inner text viewport instantly. No new animation or dependency was added. Existing Input/Button primitives, semantic tokens, source/page headings, unverified disclosure and partial-result warnings remain intact.

Queries, matches and active position are component-local memory. The existing result lifetime unmounts them on close, retry, page/source/context changes or access revalidation. Revalidation still requires explicit Retry before extracting again; it does not resume background processing. Lost VIEW/Trash/session/patient changes retain existing clearing behavior. No search query is sent to an API, URL, storage or logger.

## Delegation and review

Native Sol workers implemented the existing-component UI integration, synthetic browser tests and an independent final read-only review. Native Luna wrote the matching-helper unit tests. The actual sandboxed OpenCode `opencode/glm-5.3-flash-free` worker received only a generic source-free matching interface and produced a helper artifact. Its missing Unicode flag was caught by the independent unit test; the supervisor corrected it, removed misleading commentary, simplified the bounded loop and integrated it. No private repository source, records or credentials were sent to OpenCode. Root review checked source lifetime, caps, safe rendering, focus and scroll ownership. Astra remained quota-unavailable; no Astra final review is claimed.

The browser test's initial revalidation expectation incorrectly assumed automatic extraction resumption. It was corrected to require the existing explicit Retry action; application behavior was preserved.

## Verification

- All **188 production browser checks passed** in one final run (4.9 minutes): 30 Find cases plus 158 existing embedded-PDF, selected-page PDF OCR and image OCR cases. The initial new-case run exposed only the incorrect automatic-resumption test expectation described above; no application behavior was changed to satisfy it.
- All **7 matching-helper unit tests passed**, including Unicode case folding/UTF-16 offsets, complete regex punctuation, exact500 versus501 results, 500,000-character input, unchanged source strings and HTML-like text.
- Production web build/typecheck, root ESLint, scoped Prettier, secret detection and diff checks passed. Independent review found no remaining material issue in matching, result lifetime, safe rendering, focus or scroll ownership.
- Both themes passed axe, keyboard focus and overflow checks at 320px mobile/1440px desktop. Actual screenshots were visually inspected and copied to stable local artifact paths below.

Tests use synthetic text and valid synthetic PDF/image fixtures, installed Chrome desktop and mobile emulation. No real medical data, hosted writes or Docker were used.

Screenshots cover both canonical themes at 320px mobile and 1440px desktop, height 1000px, with long synthetic source text and highlighted matches. Assets remain local browser artifacts: [mobile light](../.local/screenshots/extracted-text-find-light-mobile.png), [mobile dark](../.local/screenshots/extracted-text-find-dark-mobile.png), [desktop light](../.local/screenshots/extracted-text-find-light-desktop.png), [desktop dark](../.local/screenshots/extracted-text-find-dark-desktop.png).

## Files

- `.tasks/p3-extracted-text-find-{plan,report}.md`: scope, workflow and verification.
- `apps/web/src/features/documents/{ExtractedTextResult.tsx,textMatches.ts,PdfTextContent.tsx}`: shared result presentation and bounded matching.
- `apps/web/test/text-matches.test.mjs`: Unicode, punctuation, offsets, page boundaries, exact/overflow caps, safe text and 500,000-character source tests.
- `apps/web/e2e/extracted-text-find.spec.ts`: actual app/parser/OCR, privacy, lifecycle, keyboard, limits and responsive accessibility.

Limitations: JavaScript Unicode case folding is not locale-specific collation or accent/normalization-insensitive search. Only extracted text already shown is searched; unsupported OCR, capped extraction and other unopened documents remain outside the result. This feature does not introduce persisted indexing or verified clinical facts. Real-phone/Safari acceptance remains unverified.

The following technical proposal is queued separately: `.tasks/p3-persisted-extraction-plan.md`. It identifies derived-write permissions, replacement/retention and hosted migration checkpoints; no server or schema work is claimed here.
