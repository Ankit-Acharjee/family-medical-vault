# Independent backup options — checked 19 November 2026

Provider comparison only: no accounts, buckets, paid resources or credentials were created. Actual account allowances and usable capacity must be verified before uploads.

| Option | Verified allowance / constraint | Recommendation |
| --- | --- | --- |
| **Backblaze B2** | Official developer documentation offers 10 GB storage free. Its pricing page describes S3-compatible storage and paid usage above allowances. This is an account allowance, not a guarantee for each bucket. | Recommended starting option for a small development vault, subject to capacity and spending-limit checks. Use a private dedicated bucket and verify constrained credentials. |
| **Oracle Object Storage** | Official Always Free documentation lists 20 GB combined Standard/Infrequent/Archive storage for an eligible free-only account after trial, plus 50,000 monthly API requests. Trial/paid allocations differ. | More storage headroom if the user already has a functioning eligible Oracle tenancy; verify home-region and Standard-tier availability before selecting it. |

A rough capacity example: about 13 weekly full copies of a 1 GB vault need about 13 GB before database, manifests and encryption overhead. A 10 GB free allowance would not cover that example. This is planning arithmetic, not measured project usage. Do not reduce the approved 90-day recovery window to fit a provider quota; fail safely or request a revised storage budget.

**Encryption proposal:** install the standalone `age` **v1.3.2** CLI in the ignored project-local tools directory, with pinned release integrity verification. No frontend/server package dependency or global installation. Use a dedicated backup public recipient on the runner and keep the private recovery identity offline. No keys generated yet; installation requires explicit approval. Encryption alone does not attest who produced a backup: the implementation plan must independently authenticate the completed ciphertext manifest and verify it during recovery.

Sources:
- [Backblaze developer quickstart — free storage allowance](https://www.backblaze.com/docs/cloud-storage-python-developer-quick-start-guide).
- [Backblaze B2 pricing — storage and usage costs](https://www.backblaze.com/cloud-storage/pricing).
- [Oracle Always Free resources — Object and Archive Storage](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).
- [Oracle S3 Compatibility API](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/s3compatibleapi.htm).
- [age usage and key handling](https://github.com/FiloSottile/age), [pinned v1.3.2 release](https://github.com/FiloSottile/age/releases/tag/v1.3.2).

Pending choices: destination and approval for the new encryption tool. Then guide private account/bucket setup and offline recovery-key custody; separately approve hosted probes, uploads and scheduler activation. See p6-backup-readiness.md for consistency, provider Auth recovery, restore reconciliation and release gates. No restore guarantee or regulatory certification is claimed.
