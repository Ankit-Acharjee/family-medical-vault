import { isMedicationLiteral } from './medication-reconciliation.js';
/** ISO weekdays (Monday=1). Times are literal wall-clock labels, never instants. */
export type MedicationScheduleTiming =
  | { kind: 'literal'; text: string }
  | {
      kind: 'clock-times';
      timeZone: string;
      weekdays: number[];
      times: string[];
    };
export type MedicationScheduleDefinition = {
  timing: MedicationScheduleTiming;
  startDate: string | null;
  endDate: string | null;
  instructions: string | null;
};
export type SaveMedicationSchedule = {
  requestId: string;
  expectedRevision: number;
  medicationRevision: number;
  confirmed: true;
  meaning: 'owner-recorded-informational-schedule';
  recordedState: 'recorded' | 'retired';
  definition: MedicationScheduleDefinition;
};
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const integer = (v: unknown, min: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 2147483647;
function zone(v: unknown): v is string {
  if (
    typeof v !== 'string' ||
    v.length > 64 ||
    !/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(v)
  )
    return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}
/** Exact calendar label; no timezone/date-of-observation inference. */
export function isMedicationScheduleDate(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) &&
    Number.isFinite(Date.parse(v + 'T00:00:00.000Z')) &&
    new Date(v + 'T00:00:00.000Z').toISOString().slice(0, 10) === v
  );
}
export function isMedicationScheduleTiming(
  v: unknown,
): v is MedicationScheduleTiming {
  if (!obj(v)) return false;
  if (v.kind === 'literal')
    return exact(v, ['kind', 'text']) && isMedicationLiteral(v.text);
  return (
    v.kind === 'clock-times' &&
    exact(v, ['kind', 'timeZone', 'weekdays', 'times']) &&
    zone(v.timeZone) &&
    Array.isArray(v.weekdays) &&
    v.weekdays.length >= 1 &&
    v.weekdays.length <= 7 &&
    v.weekdays.every(
      (day, i, all) =>
        integer(day, 1) && day <= 7 && (i === 0 || day > all[i - 1]),
    ) &&
    Array.isArray(v.times) &&
    v.times.length >= 1 &&
    v.times.length <= 8 &&
    v.times.every(
      (time, i, all) =>
        typeof time === 'string' &&
        time.length === 5 &&
        /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time) &&
        (i === 0 || time > all[i - 1]),
    )
  );
}
export function isMedicationScheduleDefinition(
  v: unknown,
): v is MedicationScheduleDefinition {
  if (
    !obj(v) ||
    !exact(v, ['timing', 'startDate', 'endDate', 'instructions']) ||
    !isMedicationScheduleTiming(v.timing) ||
    (v.startDate !== null && !isMedicationScheduleDate(v.startDate)) ||
    (v.endDate !== null && !isMedicationScheduleDate(v.endDate)) ||
    (v.instructions !== null && !isMedicationLiteral(v.instructions))
  )
    return false;
  return v.startDate === null || v.endDate === null || v.startDate <= v.endDate;
}
export function isSaveMedicationSchedule(
  v: unknown,
): v is SaveMedicationSchedule {
  return (
    obj(v) &&
    exact(v, [
      'requestId',
      'expectedRevision',
      'medicationRevision',
      'confirmed',
      'meaning',
      'recordedState',
      'definition',
    ]) &&
    typeof v.requestId === 'string' &&
    v.requestId.length === 36 &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      v.requestId,
    ) &&
    integer(v.expectedRevision, 0) &&
    v.expectedRevision < 2147483647 &&
    integer(v.medicationRevision, 1) &&
    v.confirmed === true &&
    v.meaning === 'owner-recorded-informational-schedule' &&
    (v.recordedState === 'recorded' || v.recordedState === 'retired') &&
    isMedicationScheduleDefinition(v.definition)
  );
}

export type MedicationScheduleEntry = {
  patientId: string;
  medicationId: string;
  medicationRevision: number;
  revision: number;
  action: 'recording' | 'correction' | 'retirement';
  recordedAt: string;
  meaning: 'owner-recorded-informational-schedule';
  recordedState: 'recorded' | 'retired';
  definition: MedicationScheduleDefinition;
};
export type MedicationScheduleHistory = {
  patientId: string;
  medicationId: string;
  medicationRevision: number;
  medicationName: string;
  medicationStatus: 'current' | 'historical';
  canWrite: boolean;
  sourceState: 'current-source' | 'source-review-required';
  current: MedicationScheduleEntry | null;
  history: MedicationScheduleEntry[];
  nextBeforeRevision: number | null;
};
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length === 36 &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    v,
  );
/** Canonical key order for semantic retries; values and timing labels remain untouched. */
export function medicationScheduleDefinitionValue(
  d: MedicationScheduleDefinition,
): MedicationScheduleDefinition {
  return {
    timing:
      d.timing.kind === 'literal'
        ? { kind: 'literal', text: d.timing.text }
        : {
            kind: 'clock-times',
            timeZone: d.timing.timeZone,
            weekdays: [...d.timing.weekdays],
            times: [...d.timing.times],
          },
    startDate: d.startDate,
    endDate: d.endDate,
    instructions: d.instructions,
  };
}
export function isMedicationScheduleEntry(
  v: unknown,
): v is MedicationScheduleEntry {
  return (
    obj(v) &&
    exact(v, [
      'patientId',
      'medicationId',
      'medicationRevision',
      'revision',
      'action',
      'recordedAt',
      'meaning',
      'recordedState',
      'definition',
    ]) &&
    uuid(v.patientId) &&
    uuid(v.medicationId) &&
    integer(v.medicationRevision, 1) &&
    integer(v.revision, 1) &&
    (v.action === 'recording' ||
      v.action === 'correction' ||
      v.action === 'retirement') &&
    (v.revision === 1
      ? v.action === 'recording' && v.recordedState === 'recorded'
      : v.action !== 'recording') &&
    (v.action !== 'retirement' || v.recordedState === 'retired') &&
    typeof v.recordedAt === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.recordedAt) &&
    Number.isFinite(Date.parse(v.recordedAt)) &&
    new Date(v.recordedAt).toISOString() === v.recordedAt &&
    v.meaning === 'owner-recorded-informational-schedule' &&
    (v.recordedState === 'recorded' || v.recordedState === 'retired') &&
    isMedicationScheduleDefinition(v.definition)
  );
}
export function isMedicationScheduleHistory(
  v: unknown,
): v is MedicationScheduleHistory {
  if (
    !obj(v) ||
    !exact(v, [
      'patientId',
      'medicationId',
      'medicationRevision',
      'medicationName',
      'medicationStatus',
      'canWrite',
      'sourceState',
      'current',
      'history',
      'nextBeforeRevision',
    ]) ||
    !uuid(v.patientId) ||
    !uuid(v.medicationId) ||
    !integer(v.medicationRevision, 1) ||
    !isMedicationLiteral(v.medicationName) ||
    (v.medicationStatus !== 'current' && v.medicationStatus !== 'historical') ||
    typeof v.canWrite !== 'boolean' ||
    (v.sourceState !== 'current-source' &&
      v.sourceState !== 'source-review-required') ||
    (v.current !== null && !isMedicationScheduleEntry(v.current)) ||
    !Array.isArray(v.history) ||
    v.history.length > 20 ||
    !v.history.every(isMedicationScheduleEntry) ||
    (v.nextBeforeRevision !== null && !integer(v.nextBeforeRevision, 1))
  )
    return false;
  const current = v.current as MedicationScheduleEntry | null,
    rows = v.history as MedicationScheduleEntry[],
    medRevision = v.medicationRevision;
  if (!current) return !rows.length && v.nextBeforeRevision === null;
  if (
    current.patientId !== v.patientId ||
    current.medicationId !== v.medicationId ||
    current.medicationRevision > medRevision ||
    !rows.length
  )
    return false;
  if (
    rows.some(
      (r, i) =>
        r.patientId !== v.patientId ||
        r.medicationId !== v.medicationId ||
        r.medicationRevision > medRevision ||
        r.revision > current.revision ||
        (i > 0 && r.revision !== rows[i - 1]!.revision - 1),
    )
  )
    return false;
  const same = rows.find((r) => r.revision === current.revision);
  if (
    same &&
    (same.recordedAt !== current.recordedAt ||
      same.action !== current.action ||
      same.medicationRevision !== current.medicationRevision ||
      same.recordedState !== current.recordedState ||
      JSON.stringify(medicationScheduleDefinitionValue(same.definition)) !==
        JSON.stringify(medicationScheduleDefinitionValue(current.definition)))
  )
    return false;
  return (
    v.nextBeforeRevision === null ||
    (rows.length === 20 && v.nextBeforeRevision === rows.at(-1)!.revision - 1)
  );
}
/** A source fence, not authorization, a prescription or a reminder-dispatch decision. */
export function medicationScheduleMatchesCurrent(
  entry: MedicationScheduleEntry,
  medicationRevision: number,
  sourceState: MedicationScheduleHistory['sourceState'],
) {
  return (
    isMedicationScheduleEntry(entry) &&
    integer(medicationRevision, 1) &&
    entry.recordedState === 'recorded' &&
    entry.medicationRevision === medicationRevision &&
    sourceState === 'current-source'
  );
}
