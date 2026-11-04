# Document Vault & Organization

**Canonical owner:** This file owns the requirement IDs below. Consult adjacent domain docs only for cross-domain work.

## DOC-01 — File intake
**Requirement:** Upload individual/multiple PDFs and common image formats from desktop or mobile camera without required classification forms.

**Acceptance check:** A supported file can be submitted with no doctor, diagnosis or encounter entered.

## DOC-02 — Private originals
**Requirement:** Preserve original binary content in a private object store with random opaque keys and integrity checks.

**Acceptance check:** Downloads reproduce the originally stored file and are authorized per request.

## DOC-03 — Automatic organization
**Requirement:** Extract/suggest type, dates, provider and labels; maintain search across individual records.

**Acceptance check:** Unclassified documents remain findable and previewable.

## DOC-04 — Hybrid grouping
**Requirement:** Optionally infer links to encounters, related documents or episodes; do not require user-curated encounters.

**Acceptance check:** User can access every independent document even if no grouping exists.

## DOC-05 — Timeline & search
**Requirement:** Offer metadata/full-text searching when extracted and a chronological history with filters, source context and per-person boundaries.

**Acceptance check:** Search results never include another patient without a valid grant.

## DOC-06 — Deduplication
**Requirement:** Detect potential duplicate uploads and related pages without silently removing distinct originals.

**Acceptance check:** Potential duplicates are surfaced non-destructively.

## DOC-07 — Upload integrity
**Requirement:** Use recoverable, idempotent upload lifecycle and safe compensation for partial failures.

**Acceptance check:** A failed metadata transaction cannot display file as READY or create duplicate active items on retry.
