# Infrastructure contract (documentation only)

- Docker/Compose are approved for local app/server and a portable production server image. Static frontend may deploy directly to Cloudflare Pages.
- Managed Supabase PostgreSQL/Auth and private Cloudflare R2 remain outside local production containers.
- OCI Always Free preferred backend host; Render a constrained fallback. Both require validation before use with real medical data.
- GitHub Actions is the preferred **external scheduler** for weekly backups; the backup script must remain independently runnable and include verification and missed-run alerts.
- Do not embed credentials or medical records in the repository, Docker layers, CI artifacts, GitHub logs, or example env files.
- Provider-independent encrypted archives with consistent DB/object manifest; 90-day rolling weekly retention; restore authorization/deletion reconciliation.
