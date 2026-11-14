# P3 — Navigate metadata evidence in saved source text

Status: implemented and verified under the standing roadmap workflow; see p3-source-navigation-report.md.

- AI-03 / AI-05 / DOC-05: make existing local and persisted metadata provenance actionable through “Show in source”; this does not verify clinical facts.
- Resolve exact excerpt on its recorded page within the current authorized saved extraction. Never match a different page or normalize source offsets.
- Highlight/focus/scroll the actual text; retain ordinary Find and explicit clearing. No extra API, original fetch, persistence, route or dependency.
- Bind requests to the displayed saved snapshot; source reload/revalidation/denial clears navigation state. Respect reduced motion and both themes/layouts.
- Sandbox GLM worker: standalone generic locator and synthetic vectors only, no private source. Root: independently review/import helper, integrate UI, validate behavior and regressions, push develop.
- Verify wrong/repeated page, Unicode offsets, invalid/bounded input, local and persisted actions, Find recovery, source changes/access loss, keyboard/focus, both themes and mobile.
