/** Consent references only: no payload, credential, clinical field or authority claim. */
export type ProcessingDataCategory = 'original-document' | 'saved-text';
export type ProcessingPurpose = 'document-extraction';
export type SaveProcessingConsent = {
  requestId: string;
  expectedRevision: number;
  sourceSha256: string;
  sourceRevision: number;
  lifecycleVersion: number;
  providerId: string;
  policyVersion: string;
  purpose: ProcessingPurpose;
  dataCategories: ProcessingDataCategory[];
  expiresAt: string;
  confirmed: true;
};
export type WithdrawProcessingConsent = {
  requestId: string;
  expectedRevision: number;
};
/** A valid shape is not evidence of provider vetting or permission to process. */
export type ProcessingProviderPolicy = {
  providerId: string;
  policyVersion: string;
  purposes: [ProcessingPurpose];
  dataCategories: ProcessingDataCategory[];
  expiresAt: string;
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((key) => Object.hasOwn(v, key));
const integer = (v: unknown, min = 0): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 2147483647;
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
const slug = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length <= 64 &&
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v);
const instant = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
const categories = (v: unknown): v is ProcessingDataCategory[] =>
  Array.isArray(v) &&
  v.length >= 1 &&
  v.length <= 2 &&
  Array.from(v).every(
    (item) => item === 'original-document' || item === 'saved-text',
  ) &&
  new Set(v).size === v.length;

/** Shape validation only; the server must evaluate expiry using its own clock. */
export function isSaveProcessingConsent(
  value: unknown,
): value is SaveProcessingConsent {
  return (
    record(value) &&
    exact(value, [
      'requestId',
      'expectedRevision',
      'sourceSha256',
      'sourceRevision',
      'lifecycleVersion',
      'providerId',
      'policyVersion',
      'purpose',
      'dataCategories',
      'expiresAt',
      'confirmed',
    ]) &&
    uuid(value.requestId) &&
    integer(value.expectedRevision) &&
    typeof value.sourceSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sourceSha256) &&
    integer(value.sourceRevision) &&
    integer(value.lifecycleVersion) &&
    slug(value.providerId) &&
    slug(value.policyVersion) &&
    value.purpose === 'document-extraction' &&
    categories(value.dataCategories) &&
    instant(value.expiresAt) &&
    value.confirmed === true
  );
}
export function isWithdrawProcessingConsent(
  value: unknown,
): value is WithdrawProcessingConsent {
  return (
    record(value) &&
    exact(value, ['requestId', 'expectedRevision']) &&
    uuid(value.requestId) &&
    integer(value.expectedRevision, 1)
  );
}
export function isProcessingProviderPolicy(
  value: unknown,
): value is ProcessingProviderPolicy {
  return (
    record(value) &&
    exact(value, [
      'providerId',
      'policyVersion',
      'purposes',
      'dataCategories',
      'expiresAt',
    ]) &&
    slug(value.providerId) &&
    slug(value.policyVersion) &&
    Array.isArray(value.purposes) &&
    value.purposes.length === 1 &&
    value.purposes[0] === 'document-extraction' &&
    categories(value.dataCategories) &&
    instant(value.expiresAt)
  );
}

export type ProcessingConsentContext = {
  sourceSha256: string;
  sourceRevision: number;
  lifecycleVersion: number;
  revision: number;
};
export type ProcessingConsentSnapshot = {
  revision: number;
  action: 'grant' | 'withdrawal';
  sourceSha256: string;
  sourceRevision: number;
  lifecycleVersion: number;
  providerId: string;
  policyVersion: string;
  purpose: ProcessingPurpose;
  dataCategories: ProcessingDataCategory[];
  expiresAt: string;
  recordedAt: string;
};
export type ProcessingConsentResult = {
  context: ProcessingConsentContext;
  snapshot: ProcessingConsentSnapshot | null;
  policies: ProcessingProviderPolicy[];
  effective: boolean;
  externalProcessingEnabled: false;
};
export type ProcessingConsentHistoryResult = {
  context: ProcessingConsentContext;
  snapshot: ProcessingConsentSnapshot | null;
  nextBefore: number | null;
};
const sha = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function consentContext(value: unknown): value is ProcessingConsentContext {
  return (
    record(value) &&
    exact(value, [
      'sourceSha256',
      'sourceRevision',
      'lifecycleVersion',
      'revision',
    ]) &&
    sha(value.sourceSha256) &&
    integer(value.sourceRevision) &&
    integer(value.lifecycleVersion) &&
    integer(value.revision)
  );
}
function consentSnapshot(
  value: unknown,
  context: ProcessingConsentContext,
): value is ProcessingConsentSnapshot {
  return (
    record(value) &&
    exact(value, [
      'revision',
      'action',
      'sourceSha256',
      'sourceRevision',
      'lifecycleVersion',
      'providerId',
      'policyVersion',
      'purpose',
      'dataCategories',
      'expiresAt',
      'recordedAt',
    ]) &&
    integer(value.revision, 1) &&
    value.revision <= context.revision &&
    (value.action === 'grant' || value.action === 'withdrawal') &&
    sha(value.sourceSha256) &&
    integer(value.sourceRevision) &&
    value.sourceRevision <= context.sourceRevision &&
    integer(value.lifecycleVersion) &&
    value.lifecycleVersion <= context.lifecycleVersion &&
    slug(value.providerId) &&
    slug(value.policyVersion) &&
    value.purpose === 'document-extraction' &&
    categories(value.dataCategories) &&
    (!value.dataCategories.includes('saved-text') ||
      value.sourceRevision > 0) &&
    instant(value.expiresAt) &&
    instant(value.recordedAt)
  );
}
/** Effective consent still never enables processing; provider/time checks belong to the server. */
export function isProcessingConsentResult(
  value: unknown,
): value is ProcessingConsentResult {
  if (
    !record(value) ||
    !exact(value, [
      'context',
      'snapshot',
      'policies',
      'effective',
      'externalProcessingEnabled',
    ]) ||
    !consentContext(value.context) ||
    !Array.isArray(value.policies) ||
    value.policies.length > 20 ||
    !Array.from(value.policies).every(isProcessingProviderPolicy) ||
    new Set(value.policies.map((policy) => policy.providerId)).size !==
      value.policies.length ||
    typeof value.effective !== 'boolean' ||
    value.externalProcessingEnabled !== false
  )
    return false;
  if (value.snapshot === null)
    return value.context.revision === 0 && value.effective === false;
  if (
    !consentSnapshot(value.snapshot, value.context) ||
    value.snapshot.revision !== value.context.revision
  )
    return false;
  return (
    !value.effective ||
    (value.snapshot.action === 'grant' &&
      value.snapshot.sourceSha256 === value.context.sourceSha256 &&
      value.snapshot.sourceRevision === value.context.sourceRevision &&
      value.snapshot.lifecycleVersion === value.context.lifecycleVersion)
  );
}
export function isProcessingConsentHistoryResult(
  value: unknown,
): value is ProcessingConsentHistoryResult {
  if (
    !record(value) ||
    !exact(value, ['context', 'snapshot', 'nextBefore']) ||
    !consentContext(value.context)
  )
    return false;
  return value.snapshot === null
    ? value.nextBefore === null
    : consentSnapshot(value.snapshot, value.context) &&
        (value.nextBefore === null ||
          (value.nextBefore === value.snapshot.revision &&
            value.snapshot.revision > 1));
}
