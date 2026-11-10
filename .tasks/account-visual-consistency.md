# Existing-screen visual consistency: Account first

- User authorizes inventory/order plus implementation of only the first screen, followed by a stop for review.
- Inventory: functional Account/personal profile; sign-in, registration, recovery, reset and verification states. Documents/Trends/Medications/Family Access are current placeholder destinations only.
- Order: Account/profile → sign-in → registration → recovery/reset → verification → existing placeholder presentation if requested. No future functionality.
- First screen: #account, including its implemented profile-create, existing-profile, loading and failure states.
- Requirements: UX-01/02/04/05; screen-spec Account and existing identity flows.
- Reuse shared Button/Input, semantic tokens and existing PersonPanel; improve their account-scoped presentation first, then panel hierarchy/spacing.
- Terra owns new account.css only; supervisor adds a presentation-only account class/import to AuthRoot and independently reviews.
- Overview CSS/App/shared styles/art stay byte-for-byte unchanged. No auth state, APIs, authorization, models, dependencies, routes or other screens change.
- Verify existing auth/person browser flows, theme accessibility, 320px/390px/desktop/zoom-equivalent layout and desktop/mobile screenshots in both themes.
- Stop after Account; no commit, push or work on the next screen without approval.
- Delivered: account-scoped ambient canvas, layered profile panel, accessible creation CTA and quieter account actions. Reused existing controls, without modifying shared wrappers or Overview.
- Models used: native Terra for styling and independent screenshot review, Luna for bounded visual tests; supervisor reviewed changes and repaired fixture reload/containment assertions.
- Passed: 28 existing auth/person functional checks, four visual matrix tests (both themes, create/existing states, 320/390/720/1440 widths, axe, 44px controls, long identity containment and return navigation), build/typecheck, lint/format.
- SHA-1 checks confirm Overview CSS, App, shared global styles and illustration remained byte-for-byte unchanged. Only AuthRoot's CSS import and conditional presentation class were added to existing code.
- Eight create/existing desktop/mobile captures are in ignored .local/ui-review/account/. Terra reviewed all eight with no material visual issues.
- Waiting for approval before Sign in; no other screen was refined.
- 2026-11-10: user deferred further UI work and authorized pushing the accumulated changes; subsequent work returns to functionality.
