# OCR, Extraction & AI

**Canonical owner:** This file owns the requirement IDs below. Consult adjacent domain docs only for cross-domain work.

## AI-01 — Browser-first extraction
**Requirement:** Parse embedded PDF text and use local/browser OCR for scans where feasible.

**Acceptance check:** Core file saving and opening work when text extraction is unavailable.

## AI-02 — Provisional output
**Requirement:** Store suggested classification and extracted medical facts with confidence/source, never silently promote clinical values to verified.

**Acceptance check:** Unreviewed dose, diagnosis and lab values are labeled unverified and excluded from trusted automation.

## AI-03 — Risk-based verification
**Requirement:** Provide targeted and batch verification for high-risk extracted values with minimum form friction.

**Acceptance check:** A user can defer reviewing a batch and still retrieve originals.

## AI-04 — External AI consent
**Requirement:** External provider processing is disabled by default and requires explicit scoped patient/delegate opt-in and vetted privacy conditions.

**Acceptance check:** No document payload leaves approved infrastructure absent valid consent and provider policy.

## AI-05 — AI boundaries
**Requirement:** AI results are untrusted, source-linked assistance; no autonomous permission changes, sharing, diagnosis or prescribing.

**Acceptance check:** Prompt instructions inside documents cannot alter authorization or account settings.

## AI-06 — Resilience
**Requirement:** Processing jobs are retryable, idempotent and cannot republish deleted content.

**Acceptance check:** An OCR failure leaves the original safely stored; deleted resources stay absent.
