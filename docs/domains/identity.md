# Identity & Authentication

**Canonical owner:** This file owns the requirement IDs below. Consult adjacent domain docs only for cross-domain work.

## AUTH-01 — Open registration
**Requirement:** Support Google OIDC and verified email/password registration.

**Acceptance check:** A user can create an account by either supported method; unverified email/password identities cannot access protected functions.

## AUTH-02 — Stable Person identity
**Requirement:** Issue a provider-independent immutable Person ID separate from login identity and household membership.

**Acceptance check:** Medical records continue to resolve to the same Person ID after login provider changes or caregiver activation.

## AUTH-03 — Managed profiles
**Requirement:** Authorized caregivers may establish profiles for people without login accounts.

**Acceptance check:** Creating a managed profile does not automatically create credentials or expose the profile publicly.

## AUTH-04 — Profile activation
**Requirement:** Support expiring, single-use caregiver-issued activation links redeemed by an authenticated and verified claimant, with secure approval/identity reconciliation.

**Acceptance check:** Existing documents remain attached to the same Person ID; replay or expired link fails.

## AUTH-05 — Duplicate safeguards
**Requirement:** Use private possible-duplicate signals, never name+DOB uniqueness or automatic merge; avoid account enumeration.

**Acceptance check:** Ambiguous identity matches require authorized review; two people with the same name and DOB can coexist.

## AUTH-06 — Account security
**Requirement:** Secure sessions, token rotation/revocation, rate limits, verification, password recovery and optional stronger authentication.

**Acceptance check:** Signing out and forced session revocation prevent continued authenticated requests.

## AUTH-07 — Account/profile lifecycle
**Requirement:** Keep login deactivation separate from Person/profile deletion and reconcile individually registered and managed profiles securely.

**Acceptance check:** Disabling credentials does not automatically delete medical history.
