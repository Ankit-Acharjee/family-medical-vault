import { isGroundedSummary, measurementKey } from '@fmv/contracts';
import type { MeasurementOption, ManualReadingEntry } from '@fmv/contracts';
export type ChronologyObservation =
  | { kind: 'laboratory'; key: string; value: MeasurementOption }
  | { kind: 'manual'; key: string; value: ManualReadingEntry };
export type ReportedChronology = {
  days: { date: string; observations: ChronologyObservation[] }[];
  undated: MeasurementOption[];
};
/** Presentation of a validated authorized snapshot, never an encounter or comparability model. */
export function reportedChronology(input: unknown): ReportedChronology | null {
  if (!isGroundedSummary(input)) return null;
  const days = new Map<string, ChronologyObservation[]>();
  const add = (date: string, value: ChronologyObservation) => {
    const observations = days.get(date) ?? [];
    observations.push(value);
    days.set(date, observations);
  };
  for (const value of input.laboratory.dated) {
    if (value.measurement.collectionDate.kind !== 'day') return null;
    add(value.measurement.collectionDate.isoDate, {
      kind: 'laboratory',
      key: 'laboratory:' + measurementKey(value.member),
      value,
    });
  }
  for (const value of input.manual)
    add(value.reading.observedAt.slice(0, 10), {
      kind: 'manual',
      key: 'manual:' + value.readingId,
      value,
    });
  return {
    days: [...days]
      .sort(([a], [b]) => (a > b ? -1 : a < b ? 1 : 0))
      .map(([date, observations]) => ({
        date,
        observations: observations.sort((a, b) =>
          a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
        ),
      })),
    undated: [...input.laboratory.undated],
  };
}
