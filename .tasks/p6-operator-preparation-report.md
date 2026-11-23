# DEL-03 — bounded dedicated-operator event preparation

The approved initial public-recipient pin was applied and verified read-only against its frozen plan. The private recovery identity stayed outside the process. No operator login or provider publishing was enabled by that pin.

The operator-only CLI/core selects at most ten currently unstaged identities, validates the exact pinned canonical payload and encrypts locally over age stdin/stdout. No source lock remains held during encryption. SQL revalidates the source and pin, retains the immutable winner and commits each confirmed result. Failed/uncertain batches may have earlier committed events; retries skip staged rows. Counts include concurrent winners and never assert newly inserted rows, independent confirmation, exhausted evidence or source-loss coverage.

The URL accepts only the dedicated development worker and strict verified TLS. Preflight checks role attributes, two-connection limit, memberships in both directions, no inherited schema authority and no general-app staging EXECUTE. No owner/app credential fallback, private key, signer, provider SDK or scheduler exists.

Reviewed bootstrap SQL creates only a NOLOGIN, NOINHERIT worker with a non-admin SET-only capability grant. Unknown roles or memberships abort. It sets no password and enables no login. Private psql password/conditional LOGIN steps are documented. Actual worker authentication remains unverified until credential setup; activation and hosted event preparation need separate approval.

NativeSol added URL/options tests and actual bootstrap, dry-run, pin-change-during-encryption, mandatory partial-failure retention and safe retry tests. Astra reviewed privilege and operations boundaries; findings were addressed. The publication drill now creates its own guarded synthetic link and commits uncaptured denial instead of deleting existing evidence.

Infra57, native29 plus complete encrypted staging/publication/recovery drill, lint, formatting, secrets and diff checks passed. No Docker used. Hosted operator preflight was read-only: public pin matches and worker is absent. No hosted operator, password, login or event artifact was created.
