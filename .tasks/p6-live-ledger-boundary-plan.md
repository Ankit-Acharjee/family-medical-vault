# Next boundary: live ledger adapters and independent receipt custody

Status: local publication/receipt core verified; live transport and signer deployment are not implemented or approved. User-run producer preflight succeeded. No new recovery or signing identity has been generated.

## Ready implementation slices after runtime decision

1. Provider adapter: authenticate reader/producer independently, bind account/bucket/prefix to a separately frozen destination pin, discover every exact-name version using scoped cursors and bounded streaming, upload only the staged age bytes with provider length/checksum verification, download by exact version through the reader and revalidate returned bucket/name/length/hash. No hide/delete/key-management operation. Mock redirects, identity changes, pagination failures, partial writes and lost acknowledgements before live execution.
2. Receipt receiver: run outside the primary app/database credential boundary. A private Ed25519 signing identity must remain exclusively with that receiver, with a separately distributed public verification pin. Receiver independently reads the exact stored version and derives its digest/length; it must never sign a producer-supplied expected object without its own scoped read. Persist one idempotent event/context/version receipt before acknowledging; reject changed binding and test crash/restart/concurrent submissions. Existing age recovery identity remains encryption-only and unchanged.
3. Receipt consumption: recover the same durable receipt after lost acknowledgements, verify its exact context/public pin and store evidence without promoting source completion or recovery safety until all required lifecycle/coverage conditions are satisfied. Any signing/DB/provider outage leaves local denial effective and protection pending.
4. Concrete hosted pilot: only after deployment topology, signing-key custody and exact code/data/credential scope are reviewable, request separate approval for the limited provider and receiver writes. Do not manufacture live source events to produce a nonempty queue. If the queue is empty, report it and use separately approved synthetic namespaces for any hosted pilot.

## Explicit unresolved boundaries

- Independent verifier runtime/account, deployment and private signing-key custody. No automatic selection of a paid service, account creation or key generation. A user question is pending about whether a separate runtime exists.
- Stable destination/public-key trust distribution and rotation. A pin supplied from the same receipt/object is never trusted.
- Producer writeFiles can hide versions; neither a private bucket nor a valid receipt proves WORM history. Separate retention/immutability changes need their own reviewed policy and hosted approval.
- An event receipt does not authenticate an exhaustive current head. Source-loss coverage, missing tails, rollback and ledger retention remain separate recovery gates. Restored services stay closed; no inferred sequence or activation authority.

No changes to application routes, patient permissions, source completion behavior or backend hosting are authorized by this plan alone.
