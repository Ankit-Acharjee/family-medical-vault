# Open technical validations — not open product requirements

These are implementation feasibility checks. Do **not** fill them with guesses or silently alter approved requirements.

1. **Backend host:** Oracle Always Free eligible ARM VM capacity, operational hardening, remote-access configuration and HTTPS endpoint; Render fallback sleep/reliability constraints.
2. **Domain:** Stable DNS + TLS for API and auth callbacks without buying a domain; provider subdomain may be available for web, but does not confer DNS control for sending mail.
3. **SMTP:** Verify Resend/Brevo free allotment, verified sender-domain requirements and Supabase Auth SMTP configuration; account recovery must remain reliable.
4. **Backup destination:** Independent provider and usable free capacity for rolling 90-day recovery points; exact encryption, key escrow and dedup strategy; verify restore drills.
5. **Backup job:** GitHub Actions scheduler reliability and security; idempotent script, missed-run alarms and quota handling.
6. **Production database deployment validation:** Prisma 7 and Prisma Migrate selected in P0.4 (see decisions.md). Validate Supabase PostgreSQL version compatibility, separate runtime/migration credentials, direct vs pooled connections, TLS and deployment grants before production. Local role restrictions do not establish production RLS or patient authorization.
7. **Full-text search:** PostgreSQL native text search vs adjunct indices after testing expected report text volumes.
8. **External AI processors:** None preapproved. Vet lawful processing, data retention, model-training terms and revocation before any provider integration.
9. **Critical-event retention:** Ordinary access events fixed at 90 days; critical categories, statutory retention and audit anonymization need implementation policy review.
10. **Consent/legal basis:** Assess applicable privacy and medical-data law before public release; don't claim regulatory certification.

Never add a paid dependency or reduce backup retention without explicit approval.
