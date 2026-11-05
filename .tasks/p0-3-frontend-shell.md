# P0.3 responsive frontend shell
Approved: user go ahead for frontend and develop/main branching; native Codex route.
Requirement IDs: UX-01, UX-02, UX-04, UX-05; UX-03 prominent entry only (upload later).
Read AGENTS.md, docs/design/design-system.md and docs/design/ux-flows.md.
Allowed edits: apps/web/src/App.tsx, apps/web/src/styles.css ONLY.
Supervisor owns manifests, entry, Vite, reusable ui primitives, theme hook and tests.
Implement polished restrained application shell with no invented medical data or metrics.
Use React/lucide-react; import Button from './components/ui/button'; Input from './components/ui/input'.
Use Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription from './components/ui/dialog'.
Theme API: import { useTheme } from './hooks/use-theme'; returns {theme:'light'|'dark',toggleTheme:()=>void}.
Default export App. App imports './styles.css'. Icons only lucide outline, no emoji, no external images.
Desktop narrow expandable navigation rail, mobile labeled bottom nav. Primary destinations Overview, Documents, Trends, Medications, Family Access.
Use hash destinations (#overview #documents #trends #medications #family-access), back/forward supported.
Clearly visible patient selector labeled 'Select patient', showing 'No patient selected'; opens accessible dialog explaining no profiles available. No mock people, no fake auth.
Global Search documents input visible but disabled with accessible description until patient selected.
Prominent Upload button opens a dialog 'Select a patient first' with explanatory copy (no file input or upload simulation).
All destinations reachable and show meaningful empty state. Overview attractive whitespace, useful contextual information, document-first. No invented numbers/charts/records.
Reusable empty/state UI can be local; don't create domain features, settings, auth, invites or network calls.
Theme control accessible names 'Switch to dark theme' / 'Switch to light theme'. Rail toggle 'Expand navigation' / 'Collapse navigation'.
CSS: @import 'tailwindcss'; @import '@fontsource-variable/inter'; define approved light/dark tokens and shadcn semantic mappings.
Light default #FAFAFA canvas #FFF surface #171717 text; graphite dark #101116 canvas #1D202A surface #F5F5F6 text. Use readable muted text adjusted for AA if needed.
Inter; >=14px essential reading; 4px spacing; card radius12; controls radius8; near-no shadows.
44px touch targets; visible focus; skip link to #main-content; semantic header/nav/main; aria-current; reduced motion.
No horizontal overflow at 320/390/768/1440 widths and 200% zoom. Bottom bar can use short labels (Family) with full accessible names.
No patient data in storage; no serviceworker; no localStorage in App. Theme hook persists theme only.
No installs, manifests, root config, git operations, network, commits, pushes or deployments.
No API integration; no demo fixtures. Existing P0.1/P0.2 changes must be preserved.
Report FILES CHANGED, CHECKS, UNFINISHED, BLOCKERS.
