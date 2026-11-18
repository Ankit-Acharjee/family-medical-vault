# Informational schedules — development deployment

The user explicitly approved migration `20261117000500_medication_schedules` on 17 November 2026 for dedicated development Supabase project `nyjkrcznezyrgntwvpjj` while owner-interface work continued.

Fresh read-only preflight verified exact target/TLS/UTC, restricted runtime role, all24 applied checksums and exactly migration25 pending. Prisma successfully applied migration25. Read-only postflight verified all25 checksums, medication/inventory/schedule forced RLS, append-only grants, private invoker functions, enabled source/revision guards, claim provenance and pure schedule-validator parity. No clinical field values were read and no synthetic hosted schedule rows or verification writes were created. Providers remain disabled.

Schedules now have their development schema. Hosted authenticated user flows remain unverified; no production deployment or notification enablement is implied.
