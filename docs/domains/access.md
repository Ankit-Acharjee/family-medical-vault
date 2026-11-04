# Patient & Caregiver Permissions

**Canonical owner:** This file owns the requirement IDs below. Consult adjacent domain docs only for cross-domain work.

## ACCESS-01 — Private by default
**Requirement:** Patient profiles and files are never publicly discoverable or accessible by default.

**Acceptance check:** Unauthenticated and unauthorized users cannot list, infer or retrieve patient records.

## ACCESS-02 — Two-way invitations
**Requirement:** Patients can invite caregivers; caregivers can request access by a secure link.

**Acceptance check:** Opening a request link alone never grants access.

## ACCESS-03 — Explicit authorization
**Requirement:** Patient or properly authorized representative approves requested patient-specific scope.

**Acceptance check:** Approval is a logged explicit action and scope is shown in plain language.

## ACCESS-04 — Granularity
**Requirement:** Support scoped view, upload, edit, export and manage grants with patient/category/document restrictions; expiry and revocation.

**Acceptance check:** A read-only caregiver cannot download/export if that ability is excluded.

## ACCESS-05 — Immediate revocation
**Requirement:** Each sensitive operation checks current authoritative grants; revoke related application share access where applicable.

**Acceptance check:** An old session or token cannot access after a grant is revoked.

## ACCESS-06 — Administrative separation
**Requirement:** Infrastructure administrators have no default application-level entitlement to medical files.

**Acceptance check:** Admin account with no patient grant fails ordinary patient-document API access.

## ACCESS-07 — Cross-household identity
**Requirement:** Persons can participate in multiple family groups without granting cross-group access.

**Acceptance check:** Joining a household does not reveal other members’ private medical files.
