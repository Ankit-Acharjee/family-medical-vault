# EMG-01 — Private emergency-profile readiness

User approved owner-only editing, current patient-wide View for reading, and public QR remaining disabled pending a separate field/exposure/consent decision. Canonical SRS and screen spec define a private overview and minimal opt-in QR but no field schema. A narrow field decision is pending: optional owner-entered emergency contact name/relationship/phone and a short owner-reported note, without automatic clinical inference.

Implementation boundary: a separate patient-scoped module and validated contract, using the existing explicit owner and patient-wide View authorization service; no source-document permission inference. Preserve drafts through same-context rechecks, hide private values until revalidated, clear them on denied or changed context. Reuse existing form/dialog and theme primitives; add no global UI changes or dependencies.

Data integrity plan: bounded plain text only, blank means not supplied (never “none known”), optimistic version checking for concurrent edits, DB timestamps, immutable correction history and actor references, narrow runtime privileges and value-free audit. Use existing patient lock and transaction authorization rechecks for reads/writes. Do not treat owner-reported notes as verified clinical facts or feed them to clinical summaries/automation. No public route, QR, external request or export authority follows from private access.

Verification plan: owner write/read; patient-wide View read but no write; document/category-only View denied; revoked/expired grants and changed context clear content; invalid/oversized fields, stale revisions, audit failure rollback and immutable history; native migrations and browser keyboard/drafts/retry/both themes/320px. Migration remains local until separately approved for development hosting. Public QR needs separate lifecycle/field policy before implementation.

Native workers remain quota-limited. Supervisor can implement bounded work after the missing field policy is answered; no OpenCode fallback or invented independent review.
