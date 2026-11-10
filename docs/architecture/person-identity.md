# Personal identity foundation (P1.2)

Implements AUTH-02 and the identity-separation foundation of AUTH-07; supports
ACCESS-01 and SEC-02/05/06. Managed profiles, activation, household association,
duplicate review and medical-data permissions are later slices.

Signing in does not create or claim a Person. On the account page an explicit
onboarding action creates an internal account and its own Person together. The
server generates both UUIDs. A repeated request returns the existing Person and
does not change its name or ID. Names are presentation text, never identity keys.

`fmv.app_accounts` maps the verified provider issuer and stable subject to an
internal account UUID. `fmv.persons` has a separate UUID and unique account link.
Email, external OAuth identity names and household membership do not select or
merge people. Provider changes that retain the same Supabase subject preserve
the Person; different subjects, even with identical emails, remain separate.
Changing to a different auth tenant or reconciling separately registered accounts
requires a future explicit reconciliation workflow.

`GET /api/auth/person` returns only the current account's Person (or null).
`POST /api/auth/person` accepts only a trimmed `displayName` of 1–100 characters.
It never accepts a Person ID, account ID, issuer or subject. Both endpoints use
the existing rate limits and current verified account session; POST also requires
the existing Origin, JSON and CSRF boundary. Recovery sessions cannot onboard.
The backend resolves issuer/subject from the refreshed session for every request.

Onboarding uses one READ COMMITTED transaction. Unique provider and account
constraints serialize competing inserts. INSERT ON CONFLICT DO NOTHING followed
by a separate read observes a concurrent winner without UPDATE privileges.
Failure of either insert rolls back the entire operation. Foreign-key deletion
is restricted; no account deactivation, profile deletion or merge endpoint exists.

The runtime role receives SELECT and INSERT only on these two tables. Forced RLS
limits them to the backend role; the backend is trusted to enforce the own-account
predicate. These are not end-user RLS policies: never expose `fmv` through Data API
or share its runtime credential. Identity linkage does not authorize medical
document operations; later permissions must check current patient-specific grants.

No Person data is persisted in browser storage. Pending creation responses are
discarded after account-view or authentication transitions, including logout, so
one account's delayed response cannot populate another account's screen.

Apply the new migration only after review and explicit hosted-write authorization.
Existing Supabase `vault` objects and earlier local-volume histories stay intact.
Live-provider validation is tracked separately in the operations checklist.
