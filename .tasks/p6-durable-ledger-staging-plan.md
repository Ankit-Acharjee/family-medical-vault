# DEL-03 — next production dependency: stable encrypted staging

Status: architecture reviewed by Astra; implementation not started. The user is choosing whether ledger encryption uses the verified development age recipient or a separate recovery identity. Do not choose a key, generate a second identity or activate hosted staging before this answer.

## Planned boundary
- Pin an operator-approved public recipient, ledger/environment identity and envelope version. Never pass private recovery material to the app or staging process.
- Encode each exact authoritative event as a standalone versioned envelope. Current restore transcripts require contiguous authoritative ordering and must not be populated with guessed sequence numbers for production staging.
- Persist exact ciphertext before attempting provider publication; concurrent valid age encryptions differ, so one immutable stored winner must serve every retry.
- Use a dedicated trusted staging identity; broad fmv_app must not be able to permanently poison a publication slot. New role creation/grants, recipient activation and hosted writes need concrete separately reviewed approval.
- Derive source binding from the authoritative event, compute ciphertext length/digest in PostgreSQL and retain original recipient/context per publication across rotation. Source/policy relationships must restrict deletion, never cascade away protection evidence.
- Race-safe compare-and-insert must read the persisted winner in a separate READ COMMITTED statement or retry. Do not rely on a single INSERT/SELECT CTE snapshot after conflict.
- Test two independent sessions, missing/changed source, wrong recipient/context, ciphertext integrity, role/RLS denial, capture failure, key rotation and retry before enabling operational preparation.

## Provider integration after staging
Use separate constrained producer credentials, independently observed ciphertext/version receipts and pinned signing trust. B2 writeFiles also authorizes hiding files; a write-only label does not establish append-only history. Official API documentation was checked through Context7: https://www.backblaze.com/apidocs/b2-create-key and https://www.backblaze.com/apidocs/b2-hide-file . No provider key was created and no cloud object was uploaded.

Per-event receipt confirmation is separate from complete source-loss coverage. Unknown/unsent tails, missing trust or unverified current-head coverage keep restored services closed. No automatic owner fallback, cleanup, Object Lock activation, scheduler, purge or paid capacity is inferred.
