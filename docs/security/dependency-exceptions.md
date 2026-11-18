# Temporary dependency audit exception

Approved explicitly by the repository owner on 18 November 2026. This is an advisory-specific, development-only risk acceptance, not a dependency fix.

- Advisory: [GHSA-fc5q-39xc-vjpf / CVE-2026-112366](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), high severity picomatch repeated-extglob ReDoS. Upstream lists no patched release as reviewed on 18 November.
- Observed dependency: existing picomatch 4.0.7 through development tooling `typescript-eslint → typescript-estree → tinyglobby`. It predates the summary-export feature. Current application production dependency audit has zero advisories. Build/lint glob input is trusted repository/configuration input; never feed untrusted user patterns into these tools. This assessment does not make the vulnerable package safe in other contexts.
- Gate: `pnpm security:dependencies` first audits **production without exceptions**, then audits **all dependencies**, excluding only this exact CVE. All other high/critical findings, registry errors and process failures remain blocking. No broad ignore-unfixable or ignore-registry-errors option, severity reduction or package-version override is used. Raw `pnpm audit --audit-level=high` still exposes the advisory.
- Expiry: **25 November 2026 at 00:00 UTC**. The checked-in wrapper fails closed at expiry. The exception is not automatically renewed. Remove it earlier if a patched compatible dependency becomes available; rerun full unfiltered audit and related tooling checks. Any extension or broader exception needs explicit review/approval.
- Responsibility: project maintainer reviews/removes the exception. This does not authorize a hosted migration, production deployment, or future production exposure to the advisory.

A separate moderate minimatch development advisory remains visible under the existing high-severity gate; this change neither exempts it nor changes the established severity threshold.
