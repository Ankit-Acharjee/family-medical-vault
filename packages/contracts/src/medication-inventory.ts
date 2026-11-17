import { isMedicationLiteral } from './medication-reconciliation.js';
/** Literal owner reporting, not calculated stock, normalized dates or refill advice. */
export type MedicationInventoryFields = {
  quantity: string | null;
  expiry: string | null;
  refill: string | null;
};
export type SaveMedicationInventory = {
  requestId: string;
  expectedRevision: number;
  medicationRevision: number;
  confirmed: true;
  meaning: 'owner-reported-inventory';
  fields: MedicationInventoryFields;
};
export type MedicationInventoryEntry = {
  patientId: string;
  medicationId: string;
  medicationRevision: number;
  revision: number;
  recordedAt: string;
  meaning: 'owner-reported-inventory';
  fields: MedicationInventoryFields;
};
export type MedicationInventoryHistory = {
  patientId: string;
  medicationId: string;
  medicationRevision: number;
  canWrite: boolean;
  sourceState: 'current-source' | 'source-review-required';
  current: MedicationInventoryEntry | null;
  history: MedicationInventoryEntry[];
  nextBeforeRevision: number | null;
};
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const int = (v: unknown, min: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 2147483647;
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length === 36 &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    v,
  );
export function isMedicationInventoryFields(
  v: unknown,
): v is MedicationInventoryFields {
  // Reuse the established literal-field bound/Unicode/control-character policy.
  return (
    obj(v) &&
    exact(v, ['quantity', 'expiry', 'refill']) &&
    ['quantity', 'expiry', 'refill'].every(
      (k) => v[k] === null || isMedicationLiteral(v[k]),
    )
  );
}
export function isSaveMedicationInventory(
  v: unknown,
): v is SaveMedicationInventory {
  return (
    obj(v) &&
    exact(v, [
      'requestId',
      'expectedRevision',
      'medicationRevision',
      'confirmed',
      'meaning',
      'fields',
    ]) &&
    uuid(v.requestId) &&
    int(v.expectedRevision, 0) &&
    v.expectedRevision < 2147483647 &&
    int(v.medicationRevision, 1) &&
    v.confirmed === true &&
    v.meaning === 'owner-reported-inventory' &&
    isMedicationInventoryFields(v.fields)
  );
}
export function isMedicationInventoryEntry(
  v: unknown,
): v is MedicationInventoryEntry {
  return (
    obj(v) &&
    exact(v, [
      'patientId',
      'medicationId',
      'medicationRevision',
      'revision',
      'recordedAt',
      'meaning',
      'fields',
    ]) &&
    uuid(v.patientId) &&
    uuid(v.medicationId) &&
    int(v.medicationRevision, 1) &&
    int(v.revision, 1) &&
    typeof v.recordedAt === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.recordedAt) &&
    Number.isFinite(Date.parse(v.recordedAt)) &&
    new Date(v.recordedAt).toISOString() === v.recordedAt &&
    v.meaning === 'owner-reported-inventory' &&
    isMedicationInventoryFields(v.fields)
  );
}
export function isMedicationInventoryHistory(
  v: unknown,
): v is MedicationInventoryHistory {
  if (
    !obj(v) ||
    !exact(v, [
      'patientId',
      'medicationId',
      'medicationRevision',
      'canWrite',
      'sourceState',
      'current',
      'history',
      'nextBeforeRevision',
    ]) ||
    !uuid(v.patientId) ||
    !uuid(v.medicationId) ||
    !int(v.medicationRevision, 1) ||
    typeof v.canWrite !== 'boolean' ||
    (v.sourceState !== 'current-source' &&
      v.sourceState !== 'source-review-required') ||
    (v.current !== null && !isMedicationInventoryEntry(v.current)) ||
    !Array.isArray(v.history) ||
    v.history.length > 20 ||
    !v.history.every(isMedicationInventoryEntry) ||
    (v.nextBeforeRevision !== null && !int(v.nextBeforeRevision, 1))
  )
    return false;
  const current = v.current as MedicationInventoryEntry | null,
    rows = v.history as MedicationInventoryEntry[],
    medicationRevision = v.medicationRevision;
  if (!current) return !rows.length && v.nextBeforeRevision === null;
  if (
    current.patientId !== v.patientId ||
    current.medicationId !== v.medicationId ||
    current.medicationRevision > v.medicationRevision
  )
    return false;
  if (
    rows.some(
      (r, i) =>
        r.patientId !== v.patientId ||
        r.medicationId !== v.medicationId ||
        r.revision > current.revision ||
        r.medicationRevision > medicationRevision ||
        (i > 0 && r.revision !== rows[i - 1]!.revision - 1),
    )
  )
    return false;
  if (!rows.length) return false;
  const same = rows.find((r) => r.revision === current.revision);
  if (
    same &&
    (same.recordedAt !== current.recordedAt ||
      same.medicationRevision !== current.medicationRevision ||
      (['quantity', 'expiry', 'refill'] as const).some(
        (k) => same.fields[k] !== current.fields[k],
      ))
  )
    return false;
  return (
    v.nextBeforeRevision === null ||
    (rows.length === 20 && v.nextBeforeRevision === rows.at(-1)!.revision - 1)
  );
}
