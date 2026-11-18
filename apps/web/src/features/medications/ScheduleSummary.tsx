import type { MedicationScheduleEntry } from '@fmv/contracts';
import { scheduleWeekdays } from './schedule-draft';
export function ScheduleSummary({ entry }: { entry: MedicationScheduleEntry }) {
  const d = entry.definition;
  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-border p-3 text-sm [overflow-wrap:anywhere]">
      <p className="font-semibold">
        {entry.recordedState === 'retired'
          ? 'Retired schedule'
          : 'Recorded schedule'}{' '}
        · Version {entry.revision}
      </p>
      {d.timing.kind === 'literal' ? (
        <p className="whitespace-pre-wrap">{d.timing.text}</p>
      ) : (
        <div className="space-y-1">
          <p>
            {d.timing.weekdays
              .map((day) => scheduleWeekdays[day - 1])
              .join(', ')}
          </p>
          <p>
            {d.timing.times.join(', ')} · {d.timing.timeZone}
          </p>
        </div>
      )}
      <dl className="space-y-2">
        <div>
          <dt className="text-muted-foreground">Schedule starts / ends</dt>
          <dd>
            {d.startDate ?? 'Not recorded'} / {d.endDate ?? 'Not recorded'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Instructions</dt>
          <dd className="whitespace-pre-wrap">
            {d.instructions ?? 'Not recorded'}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        Medication revision {entry.medicationRevision} · Recorded{' '}
        {new Date(entry.recordedAt).toLocaleString()}
      </p>
    </section>
  );
}
