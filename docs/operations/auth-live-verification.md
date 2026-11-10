# Live authentication verification

Status: **pending**. These notes track real-provider observations; browser E2E
fixtures are synthetic and do not count as live verification.

- Google sign-in and callback: succeeded once, as reported by the user. Not yet
  independently repeated or fully verified end to end.
- Email registration and verification, resend, recovery and reset, logout and
  replay prevention, expired/reused links, forced revocation, and provider ban:
  unverified against the live provider.
- A previous callback attempt failed. The cause is unresolved; do not mark the
  callback flow verified based on the later single reported success.

Record each live check with date, outcome, and non-sensitive notes. Never record
credentials, provider tokens, callback query secrets, or patient data here.

## Manual test sequence (dedicated development project)

1. Start at `http://localhost:5173` in one browser. Register with an eligible
   synthetic test account; before verification, protected actions must deny.
2. Open the confirmation email in that same browser; check sign-in works, and
   reopening the confirmation link cannot create another session.
3. Sign out, then reload the account route. It must require sign-in. Check replay
   rejection only with local browser tooling; do not export cookie values.
4. Request password recovery. A recovery callback must show password reset and
   must not open the normal account view. Reset, sign in with the new password,
   and check the previous session and reused recovery link both fail.
5. Repeat Google login from a fresh flow in the same browser. If it fails, record
   the stage and HTTP status only; never save the full callback URL.
6. Verify provider-side revocation/ban against an otherwise unexpired app session
   with a disposable test identity; restore its state after the check if needed.

P1.2's new migration is not yet applied to the hosted project. Do not test profile
creation there until the migration has been reviewed and explicitly authorized.
