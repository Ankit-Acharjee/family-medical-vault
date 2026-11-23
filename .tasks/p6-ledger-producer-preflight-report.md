# DEL-03 / BACKUP-01 / BACKUP-04 — producer authorization readiness

The dedicated staging connection and approved first batch succeeded, with zero pending events. The next boundary is independent-provider publication. This slice adds only an authorization-metadata preflight; it creates no application key and attempts no publication.

The existing independent reader must first verify the separate private ledger bucket and empty lifecycle rules. A second, distinct producer key then authenticates only to the fixed B2 authorization endpoint. Its account and single bucket ID must match that reader, its prefix must be exactly the development ledger namespace, and its sole capability must be writeFiles. Expired/malformed keys, unexpected endpoints, excessive permissions and reused reader/backup key IDs fail closed. A null bucket name is permitted only after matching the independently verified ID. Responses are bounded; redirects and ambient credentials are disabled. Provider tokens and identity metadata stay in memory and never enter returned flags or CLI output.

No object access, upload URL, upload, hide, delete, key creation, retention change, signing or scheduler is included. writeFiles can hide versions and therefore establishes no immutability guarantee. Individual-event delivery, independent receipt authenticity, exhaustive source-loss coverage and restore reopening remain unverified and disabled.

Supervisor implemented the security-sensitive checks. Codex-native Sol owns synthetic request/denial tests; Astra independently reviewed the implementation and found no material issues. No secrets or real records were sent to workers. Real producer validation remains blocked by missing separate credentials; it must not be claimed from mock tests.

Verification: all76 infra tests passed, including9 new producer cases; lint, scoped formatting, secret scanning and diff checks passed. No database migration or native DB test was necessary for this HTTP metadata-only change. No Docker or live producer operation was used.
