export type IssueProfileActivation = {
  requestId: string;
  expiresInHours: number;
  confirmed: true;
};
export type ApproveProfileActivation = {
  requestId: string;
  claimantRef: string;
  confirmed: true;
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown) =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    v,
  );
export function isIssueProfileActivation(
  v: unknown,
): v is IssueProfileActivation {
  return (
    record(v) &&
    Object.keys(v).length === 3 &&
    uuid(v.requestId) &&
    Number.isInteger(v.expiresInHours) &&
    (v.expiresInHours as number) >= 1 &&
    (v.expiresInHours as number) <= 168 &&
    v.confirmed === true
  );
}
export function isApproveProfileActivation(
  v: unknown,
): v is ApproveProfileActivation {
  return (
    record(v) &&
    Object.keys(v).length === 3 &&
    uuid(v.requestId) &&
    uuid(v.claimantRef) &&
    v.confirmed === true
  );
}
export type ProfileActivationSummary = {
  id: string;
  patientId: string;
  state: 'pending' | 'claimed' | 'accepted' | 'revoked' | 'expired';
  claimantRef: string | null;
  expiresAt: string;
  createdAt: string;
};
const stamp = (v: unknown) =>
  typeof v === 'string' &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
export function isProfileActivationSummary(
  v: unknown,
): v is ProfileActivationSummary {
  return (
    record(v) &&
    Object.keys(v).length === 6 &&
    uuid(v.id) &&
    uuid(v.patientId) &&
    ['pending', 'claimed', 'accepted', 'revoked', 'expired'].includes(
      v.state as string,
    ) &&
    (v.claimantRef === null || uuid(v.claimantRef)) &&
    (!['claimed', 'accepted'].includes(v.state as string) ||
      uuid(v.claimantRef)) &&
    stamp(v.expiresAt) &&
    stamp(v.createdAt)
  );
}
export type ProfileActivationList = {
  patientId: string;
  activations: ProfileActivationSummary[];
  limited: boolean;
};
export function isProfileActivationList(
  v: unknown,
): v is ProfileActivationList {
  return (
    record(v) &&
    Object.keys(v).length === 3 &&
    uuid(v.patientId) &&
    typeof v.limited === 'boolean' &&
    Array.isArray(v.activations) &&
    v.activations.length <= 20 &&
    v.activations.every(
      (a) => isProfileActivationSummary(a) && a.patientId === v.patientId,
    ) &&
    new Set(v.activations.map((a) => a.id)).size === v.activations.length
  );
}
export const isActivationToken = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
export type IssuedProfileActivation = {
  activation: ProfileActivationSummary;
  token: string | null;
  created: boolean;
};
export function isIssuedProfileActivation(
  v: unknown,
): v is IssuedProfileActivation {
  return (
    record(v) &&
    Object.keys(v).length === 3 &&
    isProfileActivationSummary(v.activation) &&
    typeof v.created === 'boolean' &&
    (v.created ? isActivationToken(v.token) : v.token === null)
  );
}
export type ActivationInspection = {
  patientId: string;
  patientName: string;
  expiresAt: string;
  claimantRef: string | null;
  state: 'pending' | 'claimed';
};
export function isActivationInspection(v: unknown): v is ActivationInspection {
  return (
    record(v) &&
    Object.keys(v).length === 5 &&
    uuid(v.patientId) &&
    typeof v.patientName === 'string' &&
    v.patientName.length > 0 &&
    Array.from(v.patientName).length <= 100 &&
    stamp(v.expiresAt) &&
    (v.state === 'pending'
      ? v.claimantRef === null
      : v.state === 'claimed' && uuid(v.claimantRef))
  );
}
export type ActivationClaimStatus = {
  patientId: string;
  claimantRef: string;
  state: 'claimed' | 'accepted';
};
export function isActivationClaimStatus(
  v: unknown,
): v is ActivationClaimStatus {
  return (
    record(v) &&
    Object.keys(v).length === 3 &&
    uuid(v.patientId) &&
    uuid(v.claimantRef) &&
    ['claimed', 'accepted'].includes(v.state as string)
  );
}
