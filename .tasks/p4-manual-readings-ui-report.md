# LAB-04 manual-reading interface — 17 November 2026

The existing Trends route now has a separate manual/user-reported panel for BP, weight, pulse and glucose, backed by the approved/deployed migration21 and owner-only API. This does not verify laboratory data or add manual charts/clinical interpretation.

## Changes

- `apps/web/src/features/manual-readings/index.tsx`: bounded current-list/history paging, owner create/correction/withdrawal flows, explicit patient context, current-versus-historical distinction, clear withdrawal state, loading/empty/error/retry and read-only states. History paging retains a separate current state; editing always binds that current revision. Category/document-only delegates see the patient-wide-View explanation without fetching manual data or losing their permitted lab/document context.
- `ManualReadingForm.tsx`, `draft.ts`: reused semantic Input/Button/native select conventions, separate BP fields and explicit units/time/UTC offset, exact decimal-string preservation, immutable reading kind on correction, clear manual provenance/format limits. UTC-offset guidance is a description rather than part of the control name. No automatic timezone guessing, unit conversion or medical plausibility validation.
- `api.ts`: bounded no-store reads with identity tokens, patient/reading response guards, deadlines and stale-response suppression. Explicit writes fetch fresh CSRF, seal idempotent request bodies, block duplicate/pending submission, preserve uncertain retries and require conflict refresh. Fields/acknowledgement cannot change under an uncertain request.
- Revalidation hides protected contents while same-context controlled drafts persist; changes to the draft reset acknowledgement, changed baseline revisions cannot save, and lost access clears state. Successful writes dismiss/refetch/restore focus. Dialog size is preserved during revalidation using the actual mounted Radix element; an initial callback-timing defect reproduced526px desktop/422px mobile shrinkage, and the corrected flow verifies at most2px change. This is functional layout measurement, not a claimed rendering-performance optimization.
- `apps/web/src/features/measurements/index.tsx` mounts the separate panel without changing approved Overview/global styling. Existing comparison browser fixtures now supply an empty synthetic manual-reading response. No backend/schema/API changes in this UI slice and no dependency added.

## Actual verification

Frontend unit/proxy suite passed45 tests, including exact UTC-offset/decimal draft round trips and type changes. Combined actual Chrome run passed46 manual/lab checks; final manual18 checks passed after the explicit patient label and zero-fetch category-scope assertion, plus2 focused stalled/late-response checks. Thus20 manual-reading and28 existing lab cases are covered across desktop1440x1000/mobile390x844, with narrow320x780 overflow checks. Coverage includes all four metrics and selected units, empty profile, correction/withdrawal/history retention, safe identical retry, pending Escape/close, draft/acknowledgement retention, stable geometry, stale baseline/conflict, read-only/category-only access, keyset/history paging, malformed/unavailable/denied responses, history retry, access revocation and read timeout. No page errors/unexpected API routes were found in asserted flows.

Axe passes in both-theme dialogs, reduced motion is respected, and actual screenshots were inspected. Shared approved Arctic Blue/Obsidian tokens, Inter/Lucide and Radix/shadcn primitives remain. Local frontend toolchain guidance was used; actual browser work used installed Playwright CLI/Chrome and axe, not unavailable MCP tools. No speculative profiling claim, native Safari/device certification or screen-reader certification. Native workers remain quota-limited; supervisor implemented/reviewed/verified without claiming Astra signoff or using OpenCode.

Web build/types, lint, formatting, whitespace and secret checks pass. Existing Vite chunk/config-loader warnings remain. Backend API339/native24 and hosted21-migration metadata postflight are the separately completed foundation, not rerun UI tests. Browser APIs were fully intercepted synthetic fixtures; no hosted medical rows were read or synthetic verification records written. Actual hosted user-flow verification remains unclaimed.

## Screenshots (synthetic, intentionally ignored by Git)

- [Desktop Arctic Blue](../.local/screenshots/manual-reading-desktop-light.png)
- [Desktop Obsidian](../.local/screenshots/manual-reading-desktop-dark.png)
- [Mobile Arctic Blue](../.local/screenshots/manual-reading-mobile-light.png) and [actions at the bottom](../.local/screenshots/manual-reading-mobile-light-actions.png)
- [Mobile Obsidian](../.local/screenshots/manual-reading-mobile-dark.png) and [actions at the bottom](../.local/screenshots/manual-reading-mobile-dark-actions.png)

Lists page by latest update, not a frozen snapshot or clinical observation-time chart. Refresh resets list paging; manual numeric/offset validation is representation-only. Terminal withdrawal preserves authorized history; physical privacy purge/retention remains P6. Next independent roadmap work is explicit owner-only reconciliation of already owner-reviewed medication source fields, with preserved history and no prescribing/scheduling inference.
