import { isManualReading, manualReadingUnits } from '@fmv/contracts';
import type { ManualReading } from '@fmv/contracts';
export type ManualDraft = {
  kind: ManualReading['kind'];
  unit: string;
  localTime: string;
  offset: string;
  value: string;
  systolic: string;
  diastolic: string;
};
export const emptyDraft = (): ManualDraft => ({
  kind: 'blood-pressure',
  unit: 'mmHg',
  localTime: '',
  offset: '',
  value: '',
  systolic: '',
  diastolic: '',
});
export const manualLabels: Record<ManualReading['kind'], string> = {
  'blood-pressure': 'Blood pressure',
  weight: 'Weight',
  pulse: 'Pulse',
  glucose: 'Glucose',
};
export function readingDraft(reading: ManualReading): ManualDraft {
  const split = reading.observedAt.indexOf('T') + 9;
  return {
    ...emptyDraft(),
    kind: reading.kind,
    unit: reading.unit,
    localTime: reading.observedAt.slice(0, split),
    offset: reading.observedAt.slice(split),
    ...(reading.kind === 'blood-pressure'
      ? reading.values
      : { value: reading.values.value }),
  };
}
export function draftReading(draft: ManualDraft): ManualReading | null {
  const reading = {
    kind: draft.kind,
    unit: draft.unit,
    observedAt:
      (draft.localTime.length === 16
        ? draft.localTime + ':00'
        : draft.localTime) + draft.offset,
    values:
      draft.kind === 'blood-pressure'
        ? { systolic: draft.systolic, diastolic: draft.diastolic }
        : { value: draft.value },
  };
  return isManualReading(reading) ? reading : null;
}
export function changeKind(
  draft: ManualDraft,
  kind: ManualReading['kind'],
): ManualDraft {
  return {
    ...draft,
    kind,
    unit: manualReadingUnits[kind][0],
    value: '',
    systolic: '',
    diastolic: '',
  };
}
export function manualValue(r: ManualReading) {
  return r.kind === 'blood-pressure'
    ? `${r.values.systolic} / ${r.values.diastolic} ${r.unit}`
    : `${r.values.value} ${r.unit}`;
}
