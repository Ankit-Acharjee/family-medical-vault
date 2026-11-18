export type EmergencyProfileFields = {
  contactName: string | null;
  contactRelationship: string | null;
  contactPhone: string | null;
  note: string | null;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown) =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    v,
  );
const limits = {
  contactName: 80,
  contactRelationship: 60,
  contactPhone: 64,
  note: 1000,
} as const;
export function isEmergencyProfileFields(
  v: unknown,
): v is EmergencyProfileFields {
  return (
    object(v) &&
    Object.keys(v).length === 4 &&
    Object.entries(limits).every(
      ([k, max]) =>
        Object.hasOwn(v, k) &&
        (v[k] === null ||
          (typeof v[k] === 'string' &&
            v[k].trim() === v[k] &&
            Array.from(v[k]).length >= 1 &&
            Array.from(v[k]).length <= max &&
            Array.from(v[k]).every((c) => {
              const n = c.charCodeAt(0);
              return (n >= 32 && n !== 127) || n === 9 || n === 10;
            }) &&
            (k === 'note' || !/[\t\n\r]/.test(v[k])))),
    )
  );
}
export type SaveEmergencyProfile = {
  requestId: string;
  expectedRevision: number;
  fields: EmergencyProfileFields;
  confirmed: true;
};
export function isSaveEmergencyProfile(v: unknown): v is SaveEmergencyProfile {
  return (
    object(v) &&
    Object.keys(v).length === 4 &&
    uuid(v.requestId) &&
    Number.isSafeInteger(v.expectedRevision) &&
    (v.expectedRevision as number) >= 0 &&
    (v.expectedRevision as number) < 2147483647 &&
    v.confirmed === true &&
    isEmergencyProfileFields(v.fields)
  );
}
export type EmergencyProfile = {
  patientId: string;
  canWrite: boolean;
  profile: null | {
    revision: number;
    recordedAt: string;
    provenance: 'owner-reported';
    fields: EmergencyProfileFields;
  };
};
export function isEmergencyProfile(v: unknown): v is EmergencyProfile {
  if (
    !object(v) ||
    Object.keys(v).length !== 3 ||
    !uuid(v.patientId) ||
    typeof v.canWrite !== 'boolean'
  )
    return false;
  if (v.profile === null) return true;
  const p = v.profile;
  return (
    object(p) &&
    Object.keys(p).length === 4 &&
    Number.isInteger(p.revision) &&
    (p.revision as number) > 0 &&
    (p.revision as number) <= 2147483647 &&
    typeof p.recordedAt === 'string' &&
    Number.isFinite(Date.parse(p.recordedAt)) &&
    new Date(p.recordedAt).toISOString() === p.recordedAt &&
    p.provenance === 'owner-reported' &&
    isEmergencyProfileFields(p.fields)
  );
}
