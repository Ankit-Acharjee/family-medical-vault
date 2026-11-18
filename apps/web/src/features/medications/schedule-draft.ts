import { isMedicationScheduleDefinition } from '@fmv/contracts';
import type { MedicationScheduleDefinition } from '@fmv/contracts';
export type ScheduleDraft = {
  kind: 'literal' | 'clock-times';
  literal: string;
  timeZone: string;
  weekdays: number[];
  times: string[];
  startDate: string;
  endDate: string;
  instructions: string;
};
export const scheduleWeekdays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
export function emptyScheduleDraft(): ScheduleDraft {
  return {
    kind: 'literal',
    literal: '',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    weekdays: [],
    times: [''],
    startDate: '',
    endDate: '',
    instructions: '',
  };
}
export function recordedScheduleDraft(
  d: MedicationScheduleDefinition,
): ScheduleDraft {
  const draft = emptyScheduleDraft();
  return {
    ...draft,
    kind: d.timing.kind,
    ...(d.timing.kind === 'literal'
      ? { literal: d.timing.text }
      : {
          timeZone: d.timing.timeZone,
          weekdays: [...d.timing.weekdays],
          times: [...d.timing.times],
        }),
    startDate: d.startDate ?? '',
    endDate: d.endDate ?? '',
    instructions: d.instructions ?? '',
  };
}
export function scheduleDraftDefinition(
  d: ScheduleDraft,
): MedicationScheduleDefinition | null {
  const value = {
    timing:
      d.kind === 'literal'
        ? { kind: 'literal', text: d.literal }
        : {
            kind: 'clock-times',
            timeZone: d.timeZone,
            weekdays: [...d.weekdays].sort((a, b) => a - b),
            times: [...d.times].sort(),
          },
    startDate: d.startDate === '' ? null : d.startDate,
    endDate: d.endDate === '' ? null : d.endDate,
    instructions: d.instructions === '' ? null : d.instructions,
  };
  return isMedicationScheduleDefinition(value) ? value : null;
}
