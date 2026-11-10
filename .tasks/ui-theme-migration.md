# Approved theme migration

- Approval: user approved the P0/P1/P2 audit checklist with “go ahead”.
- Scope: existing frontend presentation through P1.2 only; no new features.
- Authority: docs/design/design-system.md, screen-spec.md, ux-flows.md.
- Supervisor: semantic tokens, shell, shared controls, overview; Terra: auth/profile styling.
- Preserve routes, API contracts, authentication, authorization, state and focus behavior.
- Reuse existing components; no dependencies, Docker, commits or pushes.
- Verify web build, lint, formatting and existing browser flows in both themes.
- OpenCode preflight blocked by local log-directory sandbox permissions; retry only with enforced sanitized worker isolation.
- Executed GLM 5.3 Flash Free successfully using a synthetic CSS-only brief in an OS sandbox blocking repository and credentials; integrated reviewed status-icon rules. Terra implemented auth/profile presentation and independently reviewed global changes.
- Centrally documented CSS variants: darker light-theme status text/focus; stronger input boundaries in both themes for non-text contrast. Canonical brand values remain intact.
- Corrected the existing overview screenshot check to use a synthetic authenticated account and require the Overview heading before capture.
