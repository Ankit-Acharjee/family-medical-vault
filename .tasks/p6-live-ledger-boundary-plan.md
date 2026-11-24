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

## Hosting proposal for review — 24 November

The user confirmed there is no separate verifier runtime. This proposal is not an approved technology decision or a deployment instruction.

| Option | Suitability and limits |
| --- | --- |
| Dedicated AWS account: Lambda receiver and a narrowly permissioned durable receipt store | Recommended candidate for provider separation from Supabase, primary R2 and the planned Oracle/Render API. Account setup, billing eligibility, region, invocation authentication, key custody and durable storage must be approved and verified first. |
| Cloudflare Worker in a separate account with a durable receipt store | Can separate account credentials, but shares a provider with primary R2. This does not provide equivalent provider-failure independence. Runtime crypto/storage limits need validation; no guaranteed-free claim. |
| GitHub Actions in an isolated repository/environment | Candidate for a development-only asynchronous verification drill, not a substitute for a continuously available authenticated receipt service. Workflow-edit and secret access must be independently protected. No scheduler availability or prompt delivery guarantee. |

### Recommended candidate boundary

- A dedicated AWS account with MFA and separate administration, not application AWS credentials or the primary API runtime. No resources or paid plan selected yet.
- A small authenticated Lambda receiver, no anonymous signing endpoint. Invocation authentication must be designed explicitly before deployment; do not add broad permanent administrative credentials to the app.
- Separate read-only B2 key restricted to the existing encrypted evidence bucket/prefix. The receiver reads exact version bytes itself and never receives originals, plaintext medical fields, the Supabase owner URL or the age recovery private identity.
- A new private Ed25519 signing identity accessible only to the receiver. Candidate custody is a narrowly scoped secret service rather than app configuration; key generation, recovery, rotation and public pin distribution require a concrete approved setup. This is separate from encryption and reuses no SSH login or recovery key.
- A durable idempotent receipt store with conditional create/read and no routine update/delete permission. DynamoDB is a candidate to evaluate, not an approved additional application database. Store opaque bindings and signatures only, no clinical data. The repository's one-primary-database rule requires explicit architecture approval before adopting this additional security evidence store.
- Persist a receipt before acknowledgement. A receiver outage or conflicting receipt keeps protection pending. Separate complete-head/anti-rollback evidence is still needed for source-loss recovery; cloud placement and valid signatures alone do not solve it.
- Treat opaque identifiers and hashes as sensitive metadata: restrict receipt reads and omit them from routine logs. Preserve the trusted public-key pin outside the receiver account as well as outside the received object; losing or compromising that account must not let it silently replace recovery trust.

### Cost and approval boundary

AWS lists [Lambda pricing](https://aws.amazon.com/lambda/pricing/), [DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/) and [account Free Tier terms](https://aws.amazon.com/free/); actual eligibility and aggregate costs must be checked for the account/region, including secrets, requests and logs. Do not promise permanent free operation or treat alerts as a hard spending cap. AWS [recommends a secret service](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html) for sensitive values. Cloudflare has separate [Workers plan and limit terms](https://developers.cloudflare.com/workers/platform/pricing/). GitHub [environment protections](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) depend on plan and repository visibility.

User choice needed: accept the AWS candidate for a detailed cost-bounded architecture/setup review, choose the weaker Cloudflare account boundary explicitly, or defer live integration. No account, billing enrollment, cloud resource, private signing key or hosted write will be created from this proposal alone.
