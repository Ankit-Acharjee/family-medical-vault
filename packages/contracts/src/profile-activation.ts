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
