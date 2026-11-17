import { classifyMeasurementDate } from './measurements.js';
export const manualReadingUnits = {
  'blood-pressure': ['mmHg'],
  weight: ['kg', 'lb'],
  pulse: ['beats/min'],
  glucose: ['mg/dL', 'mmol/L'],
} as const;
export type ManualReading =
  | {
      kind: 'blood-pressure';
      unit: 'mmHg';
      observedAt: string;
      values: { systolic: string; diastolic: string };
    }
  | {
      kind: 'weight';
      unit: 'kg' | 'lb';
      observedAt: string;
      values: { value: string };
    }
  | {
      kind: 'pulse';
      unit: 'beats/min';
      observedAt: string;
      values: { value: string };
    }
  | {
      kind: 'glucose';
      unit: 'mg/dL' | 'mmol/L';
      observedAt: string;
      values: { value: string };
    };
export type SaveManualReading = {
  requestId: string;
  expectedRevision: number;
  confirmed: true;
  reading: ManualReading;
};
export type WithdrawManualReading = {
  requestId: string;
  expectedRevision: number;
  confirmed: true;
};
export type ManualReadingEntry = {
  readingId: string;
  patientId: string;
  revision: number;
  action: 'record' | 'correction' | 'withdrawal';
  reading: ManualReading;
  recordedAt: string;
  provenance: 'manual';
};
export type ManualReadingCursor = { recordedAt: string; readingId: string };
export type ManualReadingsPage = {
  patientId: string;
  canWrite: boolean;
  entries: ManualReadingEntry[];
  nextCursor: ManualReadingCursor | null;
};
export type ManualReadingHistory = {
  current: ManualReadingEntry;
  canWrite: boolean;
  history: ManualReadingEntry[];
  nextBeforeRevision: number | null;
};
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, ks: string[]) =>
  Object.keys(v).length === ks.length && ks.every((k) => Object.hasOwn(v, k));
const id = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length === 36 &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    v,
  );
const int = (v: unknown, min: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 2147483647;
const decimal = (v: unknown) =>
  typeof v === 'string' &&
  v.length <= 32 &&
  /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.exec(v)?.[0] === v;
const utc = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
export function isManualObservedAt(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m =
    /^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d):(\d\d)(Z|[+-](\d\d):(\d\d))$/.exec(v);
  return (
    !!m &&
    m[0] === v &&
    classifyMeasurementDate(m[1]!).kind === 'day' &&
    Number(m[2]) <= 23 &&
    Number(m[3]) <= 59 &&
    Number(m[4]) <= 59 &&
    Number(m[6] ?? 0) <= 14 &&
    Number(m[7] ?? 0) <= 59 &&
    !(Number(m[6]) === 14 && Number(m[7]) !== 0) &&
    m[5] !== '-00:00' &&
    Number.isFinite(Date.parse(v))
  );
}
export function isManualReading(v: unknown): v is ManualReading {
  if (
    !obj(v) ||
    !exact(v, ['kind', 'unit', 'observedAt', 'values']) ||
    !isManualObservedAt(v.observedAt) ||
    typeof v.kind !== 'string' ||
    !Object.hasOwn(manualReadingUnits, v.kind) ||
    !obj(v.values)
  )
    return false;
  const units: readonly string[] =
    manualReadingUnits[v.kind as keyof typeof manualReadingUnits];
  if (typeof v.unit !== 'string' || !units.includes(v.unit)) return false;
  return v.kind === 'blood-pressure'
    ? exact(v.values, ['systolic', 'diastolic']) &&
        decimal(v.values.systolic) &&
        decimal(v.values.diastolic)
    : exact(v.values, ['value']) && decimal(v.values.value);
}
export function isSaveManualReading(v: unknown): v is SaveManualReading {
  return (
    obj(v) &&
    exact(v, ['requestId', 'expectedRevision', 'confirmed', 'reading']) &&
    id(v.requestId) &&
    int(v.expectedRevision, 0) &&
    v.confirmed === true &&
    isManualReading(v.reading)
  );
}
export function isWithdrawManualReading(
  v: unknown,
): v is WithdrawManualReading {
  return (
    obj(v) &&
    exact(v, ['requestId', 'expectedRevision', 'confirmed']) &&
    id(v.requestId) &&
    int(v.expectedRevision, 1) &&
    v.confirmed === true
  );
}
export function isManualReadingEntry(v: unknown): v is ManualReadingEntry {
  return (
    obj(v) &&
    exact(v, [
      'readingId',
      'patientId',
      'revision',
      'action',
      'reading',
      'recordedAt',
      'provenance',
    ]) &&
    id(v.readingId) &&
    id(v.patientId) &&
    int(v.revision, 1) &&
    ['record', 'correction', 'withdrawal'].includes(v.action as string) &&
    (v.revision === 1 ? v.action === 'record' : v.action !== 'record') &&
    isManualReading(v.reading) &&
    utc(v.recordedAt) &&
    v.provenance === 'manual'
  );
}
export function isManualReadingCursor(v: unknown): v is ManualReadingCursor {
  return (
    obj(v) &&
    exact(v, ['recordedAt', 'readingId']) &&
    utc(v.recordedAt) &&
    id(v.readingId)
  );
}
export function isManualReadingsPage(v: unknown): v is ManualReadingsPage {
  if (
    !obj(v) ||
    !exact(v, ['patientId', 'canWrite', 'entries', 'nextCursor']) ||
    !id(v.patientId) ||
    typeof v.canWrite !== 'boolean' ||
    !Array.isArray(v.entries) ||
    v.entries.length > 20 ||
    !v.entries.every(
      (e) => isManualReadingEntry(e) && e.patientId === v.patientId,
    ) ||
    (v.nextCursor !== null && !isManualReadingCursor(v.nextCursor))
  )
    return false;
  const entries = v.entries as ManualReadingEntry[];
  return (
    new Set(entries.map((e) => e.readingId.toLowerCase())).size ===
      entries.length &&
    entries.every(
      (e, i) =>
        i === 0 ||
        entries[i - 1]!.recordedAt > e.recordedAt ||
        (entries[i - 1]!.recordedAt === e.recordedAt &&
          entries[i - 1]!.readingId > e.readingId),
    ) &&
    (v.nextCursor === null ||
      (entries.length === 20 &&
        v.nextCursor.recordedAt === entries.at(-1)!.recordedAt &&
        v.nextCursor.readingId === entries.at(-1)!.readingId))
  );
}
export function isManualReadingHistory(v: unknown): v is ManualReadingHistory {
  if (
    !obj(v) ||
    !exact(v, ['current', 'canWrite', 'history', 'nextBeforeRevision']) ||
    !isManualReadingEntry(v.current) ||
    typeof v.canWrite !== 'boolean' ||
    !Array.isArray(v.history) ||
    !v.history.length ||
    v.history.length > 20 ||
    (v.nextBeforeRevision !== null && !int(v.nextBeforeRevision, 1))
  )
    return false;
  const current = v.current;
  return (
    v.history.every(
      (e: unknown, i: number) =>
        isManualReadingEntry(e) &&
        e.patientId === current.patientId &&
        e.readingId === current.readingId &&
        e.reading.kind === current.reading.kind &&
        e.revision <= current.revision &&
        (i === 0 ||
          (v.history as ManualReadingEntry[])[i - 1]!.revision ===
            e.revision + 1),
    ) &&
    (v.nextBeforeRevision === null
      ? (v.history as ManualReadingEntry[]).at(-1)!.revision === 1
      : v.nextBeforeRevision ===
        (v.history as ManualReadingEntry[]).at(-1)!.revision - 1)
  );
}
