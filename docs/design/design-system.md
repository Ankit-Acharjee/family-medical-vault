# Family Medical Vault — Canonical Design System

**Status:** FINAL — approved visual direction.  
**Version:** 2.0 (2026-11-05)  
**Replaces:** Adaptive monochrome / graphite dark (v1).  
**Approved themes:** **Arctic Blue** (light, default) + **Obsidian & Electric Blue** (dark).  
**Reference:** User-approved blue light/dark mobile dashboard comparison; earlier user-supplied dark dashboard and minimalist white mobile references. Linear's precise layout and Apple Health's accessible medical presentation remain *interaction inspiration*, not a license to copy product content.

> **Scope:** This document governs visual and interaction presentation. It does **not** supersede product functionality, permissions, privacy, API contracts, medical verification, or the approved technology stack. Preserve existing completed workflows and routes while migrating styling.

## 1. Design objective and non-negotiables

**Premium, clear, trustworthy, subtly expressive.** Cool blue surfaces and purposeful depth should provide personality without looking like a gaming dashboard, fintech app, or a bland administrative template.

1. **Calm, not flat:** distinguish app canvas, shell, surface, raised surface, and selected states through controlled contrast, borders, and slight elevation.
2. **Blue is intentional:** reserve cobalt/electric blue for primary actions, active navigation, links, focus, and a few meaningful illustrations. Avoid multiple competing primary CTAs.
3. **Clinical meaning over aesthetics:** values, units, dates, source, verification status, errors, and permission context remain legible. Never fake medical insights or dashboard data.
4. **Minimal clicks, not missing information:** one obvious next action, progressive disclosure for secondary details, accessible destinations.
5. **One product, two modes:** consistent information architecture, spacing, components, and states. Only the appearance tokens change between themes.
6. **Functional-first migration:** preserve all implemented routes, interactions, tests and working layouts unless a separately approved UX change is required.
7. **Polish without spectacle:** no large gradients on normal cards, neon outlines, glassmorphism, flashing indicators, excessive shadows, random decorative elements, or animated dashboard fillers.

## 2. Design token contract

Use **semantic CSS custom properties** through Tailwind/shadcn theme mappings. Components MUST NOT hardcode hex colors. When using shadcn, map its `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `border`, `input`, `ring`, `destructive` variables to these values (don't create two conflicting token systems). `--accent` below means *brand accent*, whereas shadcn `--accent` commonly means hovered neutral surface; map intentionally, not by name alone.

### 2.1 Canonical palette (sRGB HEX)

| Semantic role | Token | Arctic Blue (light) | Obsidian & Electric Blue (dark) | Intended use |
|---|---|---|---|---|
| Canvas | `--fmv-bg` | `#F4F8FC` | `#0B111A` | Entire application backdrop |
| Subtle canvas | `--fmv-bg-subtle` | `#EDF3F9` | `#101826` | Shell/subtle regions |
| Surface | `--fmv-surface` | `#FFFFFF` | `#131D2B` | Main cards, menus |
| Muted surface | `--fmv-surface-muted` | `#F7FAFD` | `#182334` | Nested content, list grouping |
| Hover surface | `--fmv-surface-hover` | `#EEF4FB` | `#1B2940` | Hovered neutral controls |
| Border | `--fmv-border` | `#D9E4F0` | `#243247` | Card/input outline |
| Subtle border | `--fmv-border-soft` | `#E7EEF6` | `#1D2A3C` | Separators |
| Strong border | `--fmv-border-strong` | `#C8D6E6` | `#334865` | Emphasis/focused contours |
| Primary text | `--fmv-text` | `#0F1724` | `#F5F8FC` | Headings/body |
| Secondary text | `--fmv-text-secondary` | `#4C5B6B` | `#B8C3D3` | Secondary information |
| Tertiary text | `--fmv-text-tertiary` | `#748497` | `#8090A6` | Non-essential captions only |
| On-primary | `--fmv-on-primary` | `#FFFFFF` | `#0B111A` | Text on solid primary; check actual contrast |
| Primary accent | `--fmv-primary` | `#2F6FED` | `#4A8DFF` | Primary CTA, active nav, links |
| Primary hover | `--fmv-primary-hover` | `#255ED0` | `#6BA3FF` | Hover/focus intent |
| Primary tint | `--fmv-primary-soft` | `#E8F0FF` | `#11284B` | Selected backgrounds |
| Strong accent | `--fmv-primary-strong` | `#1749B3` | `#83B3FF` | Accent text where appropriate |
| Focus ring | `--fmv-focus` | `#77A8FF` | `#7FB0FF` | Focus outline (plus contrast backing where needed) |
| Success | `--fmv-success` | `#1E9E6A` | `#34C38F` | Success state |
| Success tint | `--fmv-success-soft` | `#E9F8F1` | `#103126` | Success badge background |
| Warning | `--fmv-warning` | `#C98A1A` | `#E3A93C` | Warnings |
| Warning tint | `--fmv-warning-soft` | `#FFF6E5` | `#36270C` | Warning background |
| Destructive | `--fmv-danger` | `#D64545` | `#FF6B6B` | Delete/security errors |
| Destructive tint | `--fmv-danger-soft` | `#FDECEC` | `#3B1D23` | Destructive background |
| Info | `--fmv-info` | `#2F6FED` | `#4A8DFF` | Informational status |
| Info tint | `--fmv-info-soft` | `#EAF1FF` | `#132641` | Info background |

**Accessibility gate:** These are brand starting values. Check the **rendered foreground/background pairs** against WCAG 2.2 AA (normal text 4.5:1, large text 3:1; non-text UI indicators 3:1). If a specific color pairing fails, derive a contrast-compliant *semantic variant* and document it centrally; don't silently change the entire palette or ship low-contrast text. In particular, status colors should not be assumed to work as text over white, and `--fmv-on-primary` must pass on each primary button background in both themes.

### 2.2 Implementation reference: CSS variables

```css
/* Reference values; adapt formatting to existing shadcn/Tailwind configuration. */
:root {
  color-scheme: light;
  --fmv-bg: #F4F8FC;
  --fmv-bg-subtle: #EDF3F9;
  --fmv-surface: #FFFFFF;
  --fmv-surface-muted: #F7FAFD;
  --fmv-surface-hover: #EEF4FB;
  --fmv-border: #D9E4F0;
  --fmv-border-soft: #E7EEF6;
  --fmv-border-strong: #C8D6E6;
  --fmv-text: #0F1724;
  --fmv-text-secondary: #4C5B6B;
  --fmv-text-tertiary: #748497;
  --fmv-on-primary: #FFFFFF;
  --fmv-primary: #2F6FED;
  --fmv-primary-hover: #255ED0;
  --fmv-primary-soft: #E8F0FF;
  --fmv-primary-strong: #1749B3;
  --fmv-focus: #77A8FF;
  --fmv-success: #1E9E6A;
  --fmv-success-soft: #E9F8F1;
  --fmv-warning: #C98A1A;
  --fmv-warning-soft: #FFF6E5;
  --fmv-danger: #D64545;
  --fmv-danger-soft: #FDECEC;
  --fmv-info: #2F6FED;
  --fmv-info-soft: #EAF1FF;
}

.dark,
[data-theme="dark"] {
  color-scheme: dark;
  --fmv-bg: #0B111A;
  --fmv-bg-subtle: #101826;
  --fmv-surface: #131D2B;
  --fmv-surface-muted: #182334;
  --fmv-surface-hover: #1B2940;
  --fmv-border: #243247;
  --fmv-border-soft: #1D2A3C;
  --fmv-border-strong: #334865;
  --fmv-text: #F5F8FC;
  --fmv-text-secondary: #B8C3D3;
  --fmv-text-tertiary: #8090A6;
  --fmv-on-primary: #0B111A;
  --fmv-primary: #4A8DFF;
  --fmv-primary-hover: #6BA3FF;
  --fmv-primary-soft: #11284B;
  --fmv-primary-strong: #83B3FF;
  --fmv-focus: #7FB0FF;
  --fmv-success: #34C38F;
  --fmv-success-soft: #103126;
  --fmv-warning: #E3A93C;
  --fmv-warning-soft: #36270C;
  --fmv-danger: #FF6B6B;
  --fmv-danger-soft: #3B1D23;
  --fmv-info: #4A8DFF;
  --fmv-info-soft: #132641;
}
```

Theme selection: **light by default**; offer Light / Dark / System in settings if existing theme architecture permits it. Honor user choice across app routes; avoid theme flicker before hydration and don't infer that dark mode means different data or capabilities. Ensure native inputs, document preview chrome, scrollbars, and chart tooltips follow the active theme. Display PDF pages faithfully (do not invert medical document pixels in dark mode).

### 2.3 Elevation and illustrative decoration

- Base layout: soft canvas behind defined content surfaces. Elevation through border + relative luminance, not heavy shadows.
- Light card elevation: optional soft `0 4px 18px rgba(18, 54, 94, .06)` on hero and overlays only; avoid repeating on every row.
- Dark card elevation: subtle border and depth; no luminous border around whole panels. Restrict any glow to carefully reviewed primary CTAs or **one** empty-state illustration, with reduced-motion safeguards.
- **Gradients:** restrained, low-opacity blue ambient wash permitted **only** in a hero/empty-state illustration or selected accent visual. Never use gradient backgrounds on every card, input, or tab.
- Decorative illustrations: optional, compressed and responsive, alt text appropriate; decorative artwork is `aria-hidden` and cannot replace text.

## 3. Typography, geometry, motion

- Font: **Inter**, system sans fallback. Do not add competing font families.
- Typography (size / line height / weight): page heading `28/36/650`, section `20/28/600`, card title `16/24/600`, body `15/24/400`, secondary `14/22/400`, small label `12/16/500` (nonessential UI only). Use `32/40/650` only for a purposeful wide-screen hero, **not** an oversized mobile empty state.
- Medical results: `14–16px` minimum usable size, tabular numerals, no clipped units, show report date and source.
- Spacing: 4px base, canonical scale `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.
- Corners: `10px` small, `12px` controls, `16px` standard cards, `20px` large panels. Avoid a different radius on each page.
- Touch targets: target at least **44 × 44px** on mobile (WCAG minimum plus usability), even if visual icon is 20px.
- Content: avoid a very tall empty-state hero; use 16–24px typical mobile page padding and visually consistent vertical rhythm.
- Motion: 120–180ms standard hover/selection, 180–240ms overlays; no motion required to understand data; honor `prefers-reduced-motion`.

## 4. App shell and navigation

**Desktop:** compact icon rail with accessible tooltips/labels, a discernible active indicator, optional expand behavior; main content pane with clear page title and patient context. Hover must not be the only way to learn navigation labels. Keep global search and upload easy to reach. Content max width ~1200px when appropriate; full-width tables can use more space.

**Mobile:** compact patient switcher in header, accessible global upload, labeled bottom navigation: `Home`, `Docs`, `Trends`, `Meds`, `Family`. No unlabeled icon-only primary navigation. Bottom-nav active state uses `--fmv-primary-soft` plus an accent icon/label, not a solid neon tile. Respect safe areas and keyboard overlap.

**Primary destination mapping:** Overview, Documents, Trends, Medications, Family Access. Security Activity and Settings are secondary (profile/account menu or contextual navigation), but remain easily discoverable.

**Patient context:** every patient-scoped route, download, upload, sharing action and edit MUST visibly identify the active patient. If no patient is selected, show a useful empty state and disable patient-dependent actions without causing confusing errors. Don't automatically select a different person when a permission changes.

**Breakpoints:** fluid/content-driven; guidance only: mobile <768px, tablet 768–1199px, desktop >=1200px. Support 200% browser zoom and narrow viewports. Don't assume all tablets are landscape or all phones have safe-area insets.

## 5. Shared component specification

| Component | Appearance | Interaction, semantics, states |
|---|---|---|
| `Button/Primary` | Solid blue, restrained elevation, 12px radius | One dominant CTA per content area; disabled/loading visibly distinct; contrast check required |
| `Button/Secondary` | Tinted/outlined neutral surface | Never visually compete with primary; clear hover/focus |
| `Button/Ghost` | No card treatment at rest | Toolbars, menu actions, icon+accessible label |
| `Button/Destructive` | Semantic red on confirmation | Explicit target, consequence and permission; avoid accidental click |
| `PatientSwitcher` | Compact named identity + chevron | Accessible selector with search where needed; clear patient role; empty state |
| `Search` | Balanced input, not oversized | Label, keyboard shortcut optional, patient scope visible, zero-results state |
| `DocumentRow` | Single responsive list pattern | Type, title, date, optional verification state; click target and actions clear |
| `DocumentCard` | Reserved for mobile/previews when helpful | Original file preview, safe metadata, privacy-aware loading |
| `Panel/Card` | Layered surface, soft border, 16px radius | No random metrics/decoration; predictable padding |
| `Badge` | Neutral/semantic tint + text | Only meaningful statuses: Pending, Verified, Failed, Revoked, Expiring |
| `Dialog` | Distinct overlay with focused task | Clear title, focus trap, escape behavior, safe destructive confirmations |
| `Drawer` | Supporting details | No nested drawer/dialog stacks for common flows |
| `Tabs` | Subtle underline/selected surface | Use for closely-related content, not mandatory primary navigation |
| `Table` | Compact row dividers | Desktop; header, sort/filter, horizontal strategy if needed |
| `MobileList` | Responsive alternative to table | Retain units and source/date, not a truncated summary of clinically important results |
| `Chart` | One subtle blue primary series; semantic alerts only | Units, dates, legend/status, accessible data table, reference/comparability notes |
| `Toast` | Quiet, short | No patient names, diagnoses, report titles, tokens or medical values in lock-screen style previews |
| `Skeleton` | Shape-preserving neutral surfaces | Never imply trusted data has loaded; reduced-motion alternative |
| `EmptyState` | Compact, informative | Short headline, one actionable CTA; illustration optional, never dominant |

Use shadcn/ui standardized via Tailwind semantic variables and shared wrappers. **Lucide React** outline icons, usually 18–20px with consistent ~1.75–2px stroke. Icons convey purpose, not decoration; no emoji navigation and no second icon family.

## 6. Screen hierarchy and behavior guardrails

Canonical screen layouts and states are documented in **[`screen-spec.md`](./screen-spec.md)**. It is normative for UI composition **only**; it may not override the SRS, authorization rules, API contracts, or existing completed feature behavior.

Global hierarchy: **current patient → page title/context → primary action/search → relevant content → secondary controls**. Do not render filler analytics when the selected patient has no records. If there is no active patient, the overview's main hero should have a compact call to action rather than a giant block.

Empty, loading, failure, insufficient permission, offline, no patient, processing pending, verified/unverified, and success states must all have intentional visual patterns. Keep the distinction between storage success and OCR success explicit.

## 7. Medical accessibility and privacy

- Target **WCAG 2.2 AA**: semantic regions, labeled controls, keyboard traversal, focus visibility, screen-reader status, contrast, reduced motion, non-color-only interpretation, 200% zoom and responsive reflow.
- Data charts must not imply diagnostic conclusions; clearly differentiate manually entered, OCR-extracted, and verified data; retain test units, reference intervals and source report links.
- Respect active patient and caregiver permissions on every sensitive action; never display protected data as background placeholder or mocked content in production.
- Don't persist document previews/medical details in service-worker cache or browser offline storage by default; redact sensitive toast and analytics payloads.
- Secure sharing, AI consent and account recovery must prioritize clear language over clever interface patterns.

## 8. Migration rules for an already-implemented application

These rules apply **now**, because development is underway and roadmap **P1.2 is complete**.

1. **Do not scaffold a new app or rebuild functioning views.** Inspect existing styles, tokens, components, routing, responsiveness and test coverage first.
2. Make a single design-token update; adapt existing shared components rather than adding parallel UI libraries.
3. Migrate shared shell first, then screens incrementally. A screen's behavior, routes, API calls, permissions and form validation must remain unchanged unless the SRS requires otherwise.
4. Preserve user-facing labels and workflows unless the wording/structure violates an explicit design requirement; do not add placeholder medical data.
5. Avoid mass restyling without screenshots at mobile + desktop widths in light + dark.
6. Document accepted exceptions (e.g., missing APIs/empty state) instead of inventing new functionality.
7. Do not declare redesign complete solely on passing TypeScript/lint. Review contrast, both themes, screen states, mobile viewport, focus and functionality.
8. Existing UI approved implementation takes precedence over speculative layout changes; escalate conflicts instead of silently changing scope.

## 9. Design QA checklist / acceptance

- [ ] Light Arctic Blue and dark Obsidian themes render using semantic tokens on each principal view.
- [ ] Switching themes doesn't change data, navigation, authorization or medical behavior.
- [ ] Active patient name/context is prominent; no-patient state never exposes unrelated patient data.
- [ ] Primary CTA and active navigation visually prominent without multiple competing neon elements.
- [ ] Search, lists, charts, buttons, badges, dialogs and empty/error/loading states coherent across themes.
- [ ] Keyboard, focus, contrast, zoom, mobile safe areas and responsive width checked.
- [ ] No arbitrary palette additions, random gradients, overlarge empty-state headlines or filler stats.
- [ ] Clinical data always displays provenance, units, dates and verification as applicable.
- [ ] Existing P1.2 interactions and tests remain operational after style migration.

**Conflict order:** SRS and security requirements → approved architecture/API contracts → this canonical design system → screen-specific presentation spec → individual mockups. Mockups illustrate appearance, not undocumented features or permissions.
