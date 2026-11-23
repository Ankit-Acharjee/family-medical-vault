# DEL-03 / BACKUP-01 / BACKUP-04 — local publication and receipt core

The user supplied a successful producer-preflight result: exact development prefix, separate writeFiles-only key, same private bucket/account, no lifecycle expiration rules and no publication. This is user-run evidence, not an agent-executed hosted upload.

## Local protocol

The portable core accepts one exact staged ciphertext and frozen opaque context from a trusted caller. It computes the ciphertext SHA-256 and checks bounded size and age framing before invoking any adapter. It does not decrypt or prove the claimed plaintext/source digest; those values must come from the previously validated immutable staging artifact.

The development object key is `fmv-restore-evidence/v1/development/<ledgerId>/events/<eventId>.age`. It intentionally omits the ciphertext digest: changed bytes for the same staged identity must conflict at the same key instead of silently creating another name. The signed receipt binds the digest as well as the exact key and provider version.

Discovery must return complete bounded exact-key metadata from a trusted, independently authenticated reader adapter. Empty discovery permits at most one upload attempt per invocation. Both successful and lost upload acknowledgements require discovery again. Missing, ambiguous or conflicting results remain unconfirmed; no blind upload retry or cross-invocation exactly-once guarantee exists. Exactly one completed upload version is accepted; duplicates, hide markers and unfinished versions are rejected. Exact-version downloaded bytes must equal the staged ciphertext, and another discovery must still show that same single version before receipt acquisition.

The canonical receipt includes environment, trusted destination identity, ledger/policy/event identity, recipient/source/payload/ciphertext hashes, ciphertext length, exact object key/version and verification timestamp. The verifier accepts a separately supplied public Ed25519 SPKI PEM pin and exactly64 signature bytes over a dedicated domain namespace plus canonical receipt bytes. It rejects extra/reordered wire fields, altered context, wrong pins, future verification times and accessors/hooks. Every expected field is compared even if it is non-enumerable. The core freezes caller-owned context/buffers before awaits and bounds adapter waits with cancellation and a30-second deadline. A trusted clock function may be evaluated after receipt acquisition; numeric clocks support deterministic tests.

## Scope and remaining boundaries

This module has no provider transport, network, DB, keyfile or private-key access. Adapters must implement provider account/bucket identity checks, exact-key pagination and by-ID reads, bounded response streaming, independent signer custody and durable idempotent receipts. No real signer, key generation, hosted write, receipt persistence or application completion is activated. The success result attests only to cryptographic per-event binding and observed bytes; hosting independence, immutable history, source-loss completeness, completion authority and automatic reopening remain false.

Astra independently reviewed the protocol and code; supervisor fixed non-enumerable expected-field comparison and primitive-ID validation findings. Sol implements synthetic success, retry/crash, ambiguity, binding and cancellation tests. No real secrets or records are used by workers.

Verification: infra90 passed, including14 new publication/receipt tests with ephemeral in-memory Ed25519 keys and callback-backed synthetic storage. Astra independently reran all14 new tests after fixes. Lint, formatting, secret scan and diff checks passed. No schema, native database or app changes; no Docker or actual hosted publication performed.
