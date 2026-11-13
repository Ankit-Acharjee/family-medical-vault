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

### Implemented saved-text search semantics — November 2026

Active document search combines literal title/original-filename matching with saved-text matches under current View authority. Saved text uses PostgreSQL simple, case-folded whole-term matching: all normalized query terms may occur across the saved pages. It provides no stemming, prefix, fuzzy, phrase or accent/Unicode-normalization guarantee. Unsaved or partial extraction cannot supply missing text; unverified matches are labeled. Export-only authority permits existing filename metadata, not text match membership. Trash is excluded; restored snapshots remain eligible under current View.

Queries travel in authenticated POST bodies, never query-string URLs or audit content. Optional category and local upload-day bounds apply before the 200-text-hit cap; a further authorized match signals truncation without exposing a total. Returned text hits emit ordinary document-view access events. Failed text search leaves filename matching usable with an incomplete-results notice; denied authority clears cached protected context. Search terms are not persisted in browser storage.

## DOC-06 — Deduplication
**Requirement:** Detect potential duplicate uploads and related pages without silently removing distinct originals.

**Acceptance check:** Potential duplicates are surfaced non-destructively.

## DOC-07 — Upload integrity
**Requirement:** Use recoverable, idempotent upload lifecycle and safe compensation for partial failures.

**Acceptance check:** A failed metadata transaction cannot display file as READY or create duplicate active items on retry.
