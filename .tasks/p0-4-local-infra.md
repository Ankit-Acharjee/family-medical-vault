# P0.4 local infrastructure and migration foundations
Approved: user approved local Docker/PostgreSQL/migration task. Native Codex routing.
Requirements: SEC-05 and REL-01 foundations; no patient feature IDs completed.
Supervisor owns containers, secrets/config, migration decisions and SQL.
Documentation worker scope: README.md only, after concrete commands supplied.
Independent reviewer: inspect infrastructure/test safeguards read-only.
Acceptance: local API+PostgreSQL startup, portable API build, non-root runtime,
credential-free examples/layers, repeatable migrations on isolated DB, failure/retry tests.
No patient data, external production services, cloud resources, commits/pushes or destructive resets.
Prisma stable 7 selected for migrations; application domain models/ORM queries deferred to P1.
