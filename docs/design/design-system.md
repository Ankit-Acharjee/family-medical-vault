# Family Medical Vault — canonical design system

**Decision: FINAL.** Visual inspiration: the two user-provided references (dark restrained dashboard and white monochrome mobile commerce UI), plus Linear's precision and Apple Health's approachable medical presentation. Use the *layout language*, not NFT/e-commerce content. **Adaptive monochrome, light default, polished graphite dark.** This supersedes any older teal-first palette.

## Design principles
- Premium through restraint: whitespace, typography, alignment and consistent rhythm; avoid colorful dashboard cards, decorative gradients, neon, excessive shadows, emoji navigation, glassmorphism and ornamental motion.
- Clarity over decoration: put medical documents, global upload/search and active patient identity first. No statistics merely to fill a dashboard.
- Minimal clicks, not minimal information: retain medical units, source, dates, verification and errors even when visually quiet.
- The same layout semantics and component hierarchy in both themes.

## Semantic tokens
| Token | Light | Graphite dark |
|---|---|---|
| `--bg` | `#FAFAFA` | `#101116` |
| `--surface` | `#FFFFFF` | `#1D202A` |
| `--text` | `#171717` | `#F5F5F6` |
| `--text-muted` | `#737373` | `#A1A1AA` |
| `--border` | `#E5E5E5` | `#30333F` |
| `--accent` | `#262626` | `#D4D4DA` |
| `--focus` | `#5757A2` | `#9494CE` |
| `--danger` | `#B42318` | `#F87171` |

Status colors (success, error, warning, clinically abnormal) are **semantic exceptions**, not brand decoration; use words/icons with color and verify WCAG contrast. Palette values are starting design tokens; change individual values only to pass accessibility contrast tests while preserving the monochrome system.

## Typography and geometry
- Font: **Inter** with system sans fallback (Geist optional only by approved substitution). Body typically 14–16px; essential reading text >=14px; page title ~28px/600; section ~20px/600; card title ~16px/600.
- 4px spacing basis, preferred steps `4/8/12/16/24/32/48/64`.
- Cards: 10–14px radius, thin subtle borders, minimal/no shadows. Controls: 8–10px radius. No arbitrary one-off tokens.
- Use tabular numbers for lab values, totals, dates where helpful.
- Transitions: 120–180ms standard; drawers/dialogs 180–240ms; respect reduced-motion preference.

## Navigation
- Desktop: compact collapsible **icon rail**, accessible labels and visible active state; optional expansion. Don't make discoverability depend on hover alone. A visible current-patient switcher and global search/upload are mandatory.
- Mobile: light, uncluttered, **labeled** bottom navigation for most-used destinations; switcher remains obvious; responsive document list and full-screen document preview.
- Main destinations: Overview, Documents, Trends, Medications, Family Access. Activity, Settings and less frequent tools live in appropriate contextual navigation.
- Recommended breakpoints are content-driven: mobile under ~768px, tablet 768–1199px, desktop >=1200px. Support zoom and narrow desktop windows.

## Component standards
- shadcn/ui components standardized via semantic Tailwind variables and shared wrappers; Lucide React outline icons (usually 20px, 1.75–2px stroke). No mixed icon families.
- One visually dominant primary action per area. Dangerous actions use explicit copy and appropriate confirmation. No nested modal chains.
- Forms: short, labeled, sensible defaults, inline validation, never mandatory consultation metadata on upload.
- Tables desktop; list rows/cards mobile; accessible sorting/filtering and non-overflow of medical units/numbers.
- Dialog for focused decision, drawer for secondary detail, fullscreen for mobile document preview; avoid hidden essential navigation in tabs.
- Badges for meaningful states only (`Pending`, `Verified`, `Failed`, etc.).
- Always provide loading, empty, denied, offline/unavailable, error, pending processing, and success states.
- Charts: subtle lines, source/units/date clearly readable, chart status and comparability footnotes; color is never sole differentiator.

## Accessibility and privacy
- Target WCAG 2.2 AA; keyboard and screen-reader operability, visible focus, appropriate labels, 44x44px mobile targets, 200% zoom and reduced motion.
- Never reveal patient data in toast previews, thumbnail notifications, or persistent offline browser caches by default.
- Sensitive actions show target patient prominently. Temporary sharing, access scope, AI consent and deletion implications must be readable and explicit.

## QA checklist
- Light and dark versions of every principal view; no arbitrary palette additions.
- Confirm active patient on every relevant route and destructive action.
- Keyboard/focus/contrast/zoom/mobile viewport tests.
- No decorative content invented to occupy whitespace.
- Trace medical figures to a source and show verified vs unverified data.
