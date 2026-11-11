# Wave 1 implementation contract — approved batch

Base: develop 5986cab. Root owns shared contracts/schema/auth/module/App wiring. No worker edits those files.
All workers read AGENTS and their domain brief. No installs, secrets, Docker, hosted writes, commits or pushes.

## A: Access service (root owns implementation; Sol owns tests)
- `apps/server/src/access/access.store.ts`: abstract AccessStore with `load(principal,patientId): Promise<AccessSnapshot>`, `list(principal): Promise<PatientSummary[]>`, `document(documentId): Promise<DocumentAuthority|null>`, `category(categoryId): Promise<boolean>`.
- `AccessSnapshot`: `{accountId:string|null,patient:{id:string,displayName:string,ownerAccountId:string}|null,grants:StoredGrant[],now:Date}`.
- `StoredGrant`: `{id:string,patientId:string,granteeAccountId:string,actions:PermissionAction[],scope:PermissionScope,expiresAt:Date|null,revokedAt:Date|null}`.
- `DocumentAuthority`: `{id:string,patientId:string,categoryId:string,state:'pending'|'ready'|'failed'}`.
- `apps/server/src/access/permission.service.ts`: `new PermissionService(store)`; `patients(principal):Promise<PatientsResult>`; `require(principal,patientId,action,target:PermissionScope={kind:'patient'}):Promise<{accountId:string,patientId:string}>`; protected failure generic404, storage503.
- GET `/api/patients`: current verified account's summaries; `createApplication({auth,people,access})` injects AccessStore for tests.
- Explicit owner rule: current DB ownerAccountId grants five independent actions; resource targets must exist and match patient even for owner. Grants cannot imply other actions; expired/revoked grants deny using snapshot DB time.
- No public grant mutation yet. Unknown resources deny; document/category resolvers use the real registry once B migration exists.

## B: Document intake core (Sol owns module + tests)
- Allowed paths `apps/server/src/documents/intake.ts`, `object-store.ts`, `memory-object-store.ts`, `apps/server/test/document-intake.test.mjs`. Root will implement Prisma store/routes separately.
- No SQL/schema/dependencies/HTTP/auth code. Core interfaces may be defined in these owned files and reported to root promptly.
- ObjectStore interface: `ready:boolean; put(key:string,bytes:Buffer,mime:DocumentMimeType):Promise<void>; get(key:string):Promise<Buffer>; remove(key:string):Promise<void>`; default unavailable adapter fails closed, memory adapter for tests only.
- Intake core must validate 25MiB max and PDF/JPEG/PNG/WebP signatures, declared MIME/size/checksum; use opaque random object keys, never filenames.
- Recoverable metadata interface supports idempotency, conflict detection, pending/ready/failed, checksum failures, cleanup after object/metadata failure and concurrent retries. No in-memory adapter may become the production default.
- Require authorization callbacks on begin/content/finalize/read as appropriate; root supplies real current policy. Do not hold assumptions about source truth or production R2 readiness.

## C: Patient context (Terra owns frontend feature only)
- Allowed paths `apps/web/src/features/patients/` and `apps/web/e2e/patient-context.spec.ts`; no App/AuthRoot/shared style edits.
- GET `/api/patients` → PatientsResult from shared contracts; auth/account now returns opaque `contextId`, not a token. Production root will remount context when it changes; no email identity keys.
- Export `PatientProvider({sessionKey:string,children})`, `usePatientContext()` and `PatientPicker({onSelected?:()=>void})` from feature index.
- Context provides `{patients,selectedPatient,loading,error,selectPatient(id),clearSelection(),reload()}`. Fetch same-origin/no-store; validate response shape; generation/abort guards and focus/visibility refresh; selected ID memory-only, no automatic selection.
- On 401/403/removal or refresh uncertainty hide stale selection/list; don't automatically replace a revoked patient. Scope all asynchronous results to sessionKey and selection generations.
- Picker renders accessible list buttons/current state, busy/empty/error/retry and existing Account link for empty profiles. Parent hosts it in existing Dialog and renders selected patient in header.
- No fixture patients in production, no palettes/Overview redesign. Tests mock API explicitly and cover race, logout/session-key change, revoked selection and no storage.
