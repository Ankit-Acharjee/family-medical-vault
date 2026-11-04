# UX, Accessibility & Visual System

**Canonical owner:** This file owns the requirement IDs below. Consult adjacent domain docs only for cross-domain work.

## UX-01 — Classy restraint
**Requirement:** Adaptive monochrome, minimal colors, clean typography, subtle neutral surfaces, concise iconography and low-noise layout.

**Acceptance check:** UI avoids promotional gradients, bright dashboard cards and decorative animation.

## UX-02 — Theme consistency
**Requirement:** Light is the initial default; polished graphite dark theme uses identical information hierarchy and accessible semantic roles.

**Acceptance check:** All major pages are usable in both themes without layout or content changes.

## UX-03 — Low-friction upload
**Requirement:** Upload is global and prominent; only request clinically necessary verification after accepting the document.

**Acceptance check:** A user can upload a valid file without filling a medical intake form.

## UX-04 — Responsive navigation
**Requirement:** Desktop narrow expandable rail; mobile labeled bottom navigation and clear current-patient switcher.

**Acceptance check:** Every primary destination is reachable on mobile without reliance on hover.

## UX-05 — Accessible states
**Requirement:** WCAG 2.2 AA target, keyboard/focus support, reduced motion, 44px touch targets, explicit loading/error/empty/denied states.

**Acceptance check:** Critical workflows complete using keyboard/screen reader and at 200% zoom.

## UX-06 — Clinical clarity
**Requirement:** Source, verification status, unit, time and reference context visible where consequential; never conceal uncertain medical data.

**Acceptance check:** Trend and summary screens clearly distinguish verified and unverified information.

## Canonical task flows
1. **Upload:** select patient → choose files/camera → store originals → show ready/pending status → process/extract asynchronously → review high-risk values later.
2. **Search:** patient → search/filter → document preview → verified facts with source links.
3. **Caregiver:** choose patient → request or issue invitation → explicit scope approval → access log; revoke anytime.
4. **Share:** select scope → confirm recipient/access mode/expiry → create link or export → audit; revoke link.
5. **Delete:** confirm patient/document → 30-day Trash → immediate search/share invalidation → restore or purge.

**No consultation-intake, finance or unnecessary multi-step wizard.**
