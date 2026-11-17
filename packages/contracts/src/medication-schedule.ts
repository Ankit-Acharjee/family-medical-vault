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
