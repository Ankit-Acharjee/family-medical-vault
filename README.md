# Family Medical Vault

A private medical records vault for individuals and authorized family caregivers.

Repository initialized from the approved November 4, 2026 specification pack. Application implementation has not started; no runnable apps, dependencies, credentials, or deployment configuration are included yet.

## Project layout

- `apps/web/` — React, Vite, TypeScript frontend.
- `apps/server/` — NestJS TypeScript modular monolith.
- `packages/contracts/` — Shared validated API schemas.
- `infra/` — Infrastructure and backup contract; deployment implementation pending.
- `docs/` — Canonical specifications and implementation decision records.

## Source of truth

Start with [AGENTS.md](AGENTS.md) and the [documentation router](docs/README.md). The [requirements index](docs/product/requirements-index.md) routes requirement IDs to their canonical domain owners. The [SRS](docs/product/Family_Medical_Vault_SRS_v1.0.md) records the approved baseline.

Use the [design system](docs/design/design-system.md): adaptive monochrome, light default, graphite dark. Approved stack choices are in [architecture decisions](docs/architecture/decisions.md); unresolved choices remain in [open decisions](docs/architecture/open-decisions.md).

## Implementation status

This setup establishes repository structure and preserves specifications. It implements no functional requirement IDs. The pnpm workspace declares the intended package locations; application manifests and development commands will be added with the initial implementation.

Never commit credentials, patient records, uploads, or backup archives.
