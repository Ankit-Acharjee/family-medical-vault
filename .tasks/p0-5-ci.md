# P0.5 CI and integration quality gates
Approved: user requested push P0.4 and move to next phase P0.5. Native Codex delegation.
Requirement IDs: SEC-05, REL-01, UX foundations; no product features completed.
Supervisor owns workflow/security tooling configuration and integration.
CI: pushes/PRs develop/main + manual dispatch; pinned official actions; contents-read only;
quality checks build/typecheck/lint/format/OpenAPI and API/browser/local-runner tests;
security scans full Git history and working source with local Gitleaks (no raw findings/log artifacts),
dependency audit fails on high/critical advisories and registry failures; actionlint verifies YAML.
Cloud runner only for Docker: isolated DB migration/security tests + API runtime smoke; always cleanup.
No production secrets, provider accounts, image publishing, deployments or patient data in CI/artifacts.
Local verification stays Docker-free per device resource preference.
Documentation worker edits README.md only after actual scripts/workflow exist.
Independent reviewer inspects safe workflow permissions, secret handling and scanner integrity.
No commit/push of P0.5 without separately established authorization.
