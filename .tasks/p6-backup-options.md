# Independent backup options — researched19 November2026

Preliminary readiness research, not a provider selection or approval to create resources. Actual account tier, private-bucket permissions, usable capacity, restore costs and a synthetic verification probe must be checked before implementation. No credentials, bucket or paid resource was created.

| Candidate | Current primary-source evidence | Project consequence |
| --- | --- | --- |
| Oracle Object Storage | Official Always Free documentation lists20GB combined Standard/Infrequent/Archive for free-only accounts after trial, with50,000 monthly API requests. Paid/trial tier allocations differ; limits must be checked in the user's tenancy/home region. | Potential no-cost independent destination if actual Standard capacity covers the recovery window. Do not assume trial capacity, Archive retrieval behavior or VM availability. |
| Backblaze B2 | Current official pricing describes S3-compatible storage starting at$6.95/TB/month. The current fetched page did not establish a guaranteed first10GB free allowance. | Independent fallback candidate requiring explicit cost approval; do not recommend as verified free storage based on older articles. |

Capacity must include every retained recovery set plus database/manifests/encryption overhead. Rough planning only: about13 weekly complete copies of a1GB vault require about13GB before overhead; full-copy retention could therefore exhaust a small free allocation. This is arithmetic, not a prediction of actual stored size. Incremental/deduplicated archives would need their own correctness and restore design.

Encryption candidate: the established `age` CLI supports public-recipient encryption, streaming via standard input/output and separate private identity files. A proposed runner would receive only a backup-specific public recipient; offline recovery identities and rotation/recovery drills remain separate. Installing/pinning a new tool requires explicit approval; nothing installed and no keys generated. Do not reuse Git SSH or application session keys by default, and do not invent a custom cryptographic protocol.

Primary sources checked:
- [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), Object and Archive Storage section.
- [Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing).
- [age project and usage](https://github.com/FiloSottile/age).

Destination choice remains pending. If an independent destination already exists, validate that candidate instead of provisioning another service. Scheduler, consistent database/object snapshot, provider Auth recovery, critical-retention governance and stale-backup revocation/deletion reconciliation remain separate release requirements described in p6-backup-readiness.md.
