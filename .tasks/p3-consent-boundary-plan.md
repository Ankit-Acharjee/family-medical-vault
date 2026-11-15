# P3 external-processing consent boundary — preparation

Status: preparation started after medication-source review `9d7fe71` was verified and pushed. No implementation or hosted changes in this task yet. Use Codex-native workers only; current native worker quota is exhausted, so supervisor continues available read-only planning. No OpenCode fallback.

Requirements: AI-04, SEC-07 and roadmap P3 work package5. Canonical owners: docs/domains/extraction.md and docs/security/access-control.md; provider vetting remains explicitly unverified in docs/architecture/open-decisions.md. No processor is approved, so external processing must remain disabled. No provider SDK, outgoing document request, external model processing, provider guarantee or activation UI may be introduced.

Proposed bounded sequence:
1. Resolve consent authority against the existing five independent permission actions: the canonical documents require patient/delegate opt-in but do not specify which current delegate actions authorize granting/withdrawal or whether delegates can withdraw another actor's consent. Do not infer this from verification or saved-text policies. This is a product/security decision, not a routine implementation choice.
2. After that decision, define exact consent references: provider policy/version, purpose, explicit data categories, scope and consent version/withdrawal. Keep immutable evidence of grants and withdrawals and source/document lifecycle fences; never log document payloads. Resolve expiry/scope/cascade requirements before finalizing persistence rather than fabricating indefinite consent semantics.
3. Design one authoritative current-consent gate composed with existing document View and current actor authority. Independently require an approved provider policy; no approved provider means deny, regardless of ledger records or configuration/client input. Revocation must prevent future submission; do not claim processor deletion until a vetted provider supports a tested mechanism.
4. Delegate isolated contract/HTTP/native/browser tests in parallel with native implementation once workers are available. Root retains migrations/authority/integration, Astra independent review when available. Synthetic source-free test data only; no Docker.
5. Verify denial when no provider is approved, stale/withdrawn/scope-mismatched consent, permission changes, Trash/deletion, exact retry/atomic audit and policy-version fences. Hosted migration remains separately approved only after implementation/review/tests and push.

This is a boundary/ledger task, not permission to enable external AI or begin P4 regimens, schedules or summaries. Medication migration17 remains pending separate approval.
