# P1.1 authentication boundary

Implements AUTH-01 and the session/recovery portion of AUTH-06; supports ACCESS-01, SEC-05 and SEC-06. Approved as part of the P1.1 review plan. Person identity and patient permissions remain subsequent slices; authentication alone grants no patient access.

## Browser and provider boundary

The React client talks only to same-origin `/api/auth/*` endpoints. Nest performs Supabase Auth requests using a publishable key. No service-role key is required. Supabase owns password hashing, email verification and Google identity verification. Provider tokens never enter browser storage or API response bodies.

The browser receives a random 256-bit opaque session cookie. Production cookies use the `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`, root path, and no Domain attribute. HTTP cookies are permitted only on development loopback origins. Session IDs rotate on successful login and callback; only SHA-256 hashes are stored in PostgreSQL. AES-256-GCM encrypts provider credentials and flow metadata with a server-only 32-byte key, authenticated against the row hash. Losing/changing that key invalidates existing sessions; do not reuse the database password or publish the key.

Sessions have a 12-hour absolute limit and a 30-minute inactivity limit. Account/recovery liveness probes do not renew inactivity; no patient operations exist in this slice. Future authenticated business operations must explicitly define activity renewal. Expired rows are deleted on access and by bounded periodic cleanup. Expiry enforcement does not depend on cleanup succeeding.

## Current session checks and concurrency

Every protected operation exchanges the stored refresh token with Supabase. The provider verifies current session validity and banned-user status. Locally, a PostgreSQL row lock serializes refreshes across API processes; the rotated tokens are persisted before the response. This deliberately favors immediate provider revocation checks over fewer network calls for this small initial cohort. It does not replace the future patient-grant lookup.

Supabase JWT signatures or `getUser` alone are insufficient evidence that a session remains unrevoked. Provider failures deny access. If refresh has an uncertain outcome, the local session is deleted when the transaction can commit; database failures also deny access, and a later request must revalidate with the provider. Transaction/lock deadlines bound resource usage.

Logout commits local session consumption before provider signout. Recovery first verifies a restricted recovery session, commits deletion of that user's application sessions, then changes the password and requests global provider signout. Only the winning consumer may change the password; failures after consumption cannot restore the recovery session. Provider logout failure is reported generically; local invalidation still holds. These are ordered operations across two systems, not a distributed transaction.

## Redirects and recovery

Google, signup and recovery each receive an independent random PKCE verifier and state in an encrypted, 30-minute browser-bound flow. Only its S256 challenge goes to the provider. Supabase callbacks return to the fixed configured origin/path with the flow state. A callback requires the HttpOnly flow cookie, matching state and a successful code/verifier exchange. Flow consumption commits before exchange, including when the provider later fails. Callback responses redirect immediately to a fixed fragment route with `Referrer-Policy: no-referrer`; codes never reach React or logs. Email verification/recovery must finish in the browser that initiated the request.

Recovery produces a session restricted to password reset (10 minutes), never ordinary account/patient access. Reset is single-use and requires a new sign-in. Resend reuses the initiating flow's verifier/challenge; starting another flow invalidates the old browser flow. Existing/unknown account responses use the same generic email notice. Email timing/delivery behavior remains provider-dependent and requires live validation.

## Request and database boundary

State-changing requests require an exact configured Origin, JSON, and a random CSRF value returned by bootstrap and echoed in a custom header matching an HttpOnly cookie. Fetch Metadata rejects cross-site requests except the state-bound callback. No credentialed CORS is enabled. Fixed redirects ignore supplied return targets.

Database-backed atomic limits are shared across processes: 30 writes and 120 reads per IP per minute, plus 8 email-address attempts per 15-minute window. Bucket identifiers are hashed. Forwarded client addresses are not trusted; reverse proxy configuration must be reviewed before production. Provider-side limits remain additional defenses. Bootstrap does not access the database or issue provider calls.

Only `vault.auth_sessions` and `vault.auth_rate_limits` receive explicit backend runtime privileges and forced RLS policies for the dedicated `fmv_app` role. These are server-internal session stores, not patient grants. Never grant access to Supabase `anon`/`authenticated`, expose `vault` through the Data API, or run the API with an owner/bypass-RLS credential. Production role/TLS provisioning is a separate verification gate.

## Validation status and limits

Automated provider mocks test application boundaries; PostgreSQL integration tests exercise actual Prisma row locks, restricted roles, rate-limit atomicity and durable consumption. Neither proves hosted email/Google configuration. Live signup, resend, recovery, Google callbacks, provider revocation/ban and HTTPS cookies must be tested in a dedicated development project before this slice is called provider-verified. No production rollout, patient permissions, critical-event audit ledger or stronger authentication is completed here.

References checked for this implementation: [Supabase sessions](https://supabase.com/docs/guides/auth/sessions), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [official refresh validation](https://github.com/supabase/auth/blob/master/internal/tokens/service.go), [official Auth client request shapes](https://github.com/supabase/auth-js/blob/master/src/GoTrueClient.ts), and [resend PKCE support](https://github.com/supabase/auth/blob/master/internal/api/resend.go). Hosted provider behavior still requires execution checks.
