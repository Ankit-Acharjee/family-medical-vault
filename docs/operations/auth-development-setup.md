# Development authentication setup

Use a dedicated test project and synthetic accounts. This guide does not authorize production setup, cloud database writes or a public release. Keep keys and passwords out of chat.

## 1. Create the development project

1. Open [Supabase Dashboard](https://supabase.com/dashboard), create a project named `family-medical-vault-dev`, select the available free plan and a suitable region, and save its database password in your password manager.
2. Wait for the project to become ready. From its Connect/API settings, locate the project URL (`https://<project-ref>.supabase.co`) and **publishable** key (`sb_publishable_…`). We do not need a secret/service-role key for authentication. Dashboard labels can change; see [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).
3. In Authentication settings, enable email/password signup and keep **Confirm email enabled**. Do not enable automatic confirmation to make tests pass.

## 2. Set development redirects

Use `http://localhost:5173` consistently in the browser and `AUTH_ORIGIN`; do not mix it with `127.0.0.1` when testing cookie-bound links.

In Authentication URL configuration:

- Site URL: `http://localhost:5173`.
- Additional redirect URL: `http://localhost:5173/api/auth/callback?state=*` (restricted development callback with a random state query).
- Keep email templates using Supabase's confirmation link (`{{ .ConfirmationURL }}`); do not switch them to implicit token-fragment redirects.

The API chooses this fixed callback; arbitrary return URLs are ignored. Verify the configured query wildcard against an actual generated email/Google flow, following [Supabase redirect matching](https://supabase.com/docs/guides/auth/redirect-urls). Do not add broad production wildcards. Open verification/recovery email links in the same browser that requested them, within 30 minutes.

## 3. Test email delivery

Supabase's default email service is restricted to authorized project-team addresses and is intended for testing; confirm your test recipient is eligible. It is not suitable for public signup. If delivery fails or wider testing is needed, configure a verified SMTP sender before continuing. Check [Supabase SMTP restrictions](https://supabase.com/docs/guides/auth/auth-smtp); do not assume a free sender/domain is already available.

## 4. Configure Google for this test project

1. Open [Google Cloud Console](https://console.cloud.google.com/), select/create a development project, and configure its Google Auth consent/branding and audience. Keep the app in testing and add your own Google account as a test user where required.
2. Create an OAuth client of type **Web application**. Use the exact callback URL shown in Supabase's Google provider settings as the Google authorized redirect URI; normally `https://<project-ref>.supabase.co/auth/v1/callback`.
3. If Google requires authorized JavaScript origins for this configuration, add `http://localhost:5173`. The application uses Supabase's redirect-based flow, not a Google browser-token SDK.
4. Enter the Google client ID and client secret only in Supabase's Google provider configuration, enable it and save. Do not put the Google secret in this repository, frontend or chat.

Use the current [official Google/Supabase setup guide](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) if dashboard wording differs.

## 5. Configure the application locally

Copy the repository's `.env.example` to an ignored root `.env`, restrict it with `chmod 600 .env`, and fill it locally. A server-only random session encryption key can be generated into the file without displaying it:

```sh
node --input-type=module -e 'import {readFileSync,writeFileSync} from "node:fs"; import {randomBytes} from "node:crypto"; const p=".env"; const s=readFileSync(p,"utf8"); if (!/^AUTH_SESSION_KEY=replace_with_64_random_hex_characters$/m.test(s)) throw Error("Expected unchanged placeholder; existing keys are preserved"); writeFileSync(p,s.replace(/^AUTH_SESSION_KEY=replace_with_64_random_hex_characters$/m,"AUTH_SESSION_KEY="+randomBytes(32).toString("hex")),{mode:0o600});'
```

Keep `AUTH_ENABLED=false` until the database role and migration are ready. No frontend `VITE_` auth secrets are required; Vite proxies `/api/auth` to the API on port 3000. The server's development command loads the root `.env`.

Application tables and the Prisma migration ledger belong to `fmv`. Supabase already owns a different schema named `vault`; never baseline, drop or modify its secrets objects. Set `schema=fmv` on database URLs and replace every connection/certificate placeholder with actual local values. Keep Supabase's existing database and public-schema privileges intact when creating the runtime role: local Docker provisioning revocations are not hosted Supabase provisioning instructions.

The initial migrations were corrected before their first successful hosted application. Existing Docker development volumes with the earlier `vault` migration history need a separately reviewed transition; do not reset them or rewrite their migration ledger. Fresh databases use the corrected `fmv` migrations.

The application needs a **restricted runtime database URL**, separate from the migration/owner URL. A newly created Supabase project does not automatically provide the `fmv_app` role required by the reviewed migration. Before enabling auth, we must separately verify the development database connection, TLS, direct/session-pooler compatibility, create that restricted role with private credentials, and apply the reviewed Prisma migration using the owner role. Do not point the running API at the owner URL or manually invent broad grants. This database provisioning is a separate reviewable step once your project exists.

After that verification, set `AUTH_ENABLED=true` and run `pnpm dev`. The default Docker-free checks use synthetic mocks and require no Supabase project. Real-provider tests require the configured database and provider; public signup remains blocked until sender/HTTPS/production configuration is verified.

## 6. Verify the configured provider

Check registration → verification → login; resend; Google callback; recovery → reset → fresh login; expired/reused links; logout/replay; and provider-side revocation or account ban while an app cookie remains unexpired. A recovery link must never open the ordinary account view before password reset. No provider tokens should appear in browser storage, responses or application logs.

When the project, redirects and Google/email settings are ready, tell us they are configured. Share no keys; further connection/provisioning checks use local configuration.
