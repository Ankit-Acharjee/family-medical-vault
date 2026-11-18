import { useId } from 'react';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { medicationSelectClass } from './MedicationForm';
import { scheduleWeekdays } from './schedule-draft';
import type { ScheduleDraft } from './schedule-draft';
export function ScheduleForm({
  draft,
  disabled,
  onChange,
}: {
  draft: ScheduleDraft;
  disabled: boolean;
  onChange: (draft: ScheduleDraft) => void;
}) {
  const hint = useId();
  return (
    <div className="min-w-0 space-y-4">
      <label className="flex flex-col gap-2 text-sm font-medium">
        Timing style
        <select
          className={medicationSelectClass}
          disabled={disabled}
          value={draft.kind}
          onChange={(e) =>
            onChange({
              ...draft,
              kind: e.target.value as ScheduleDraft['kind'],
            })
          }
        >
          <option value="literal">Timing as reported</option>
          <option value="clock-times">Choose weekdays and clock times</option>
        </select>
      </label>
      {draft.kind === 'literal' ? (
        <div className="space-y-2">
          <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
            Timing as reported
            <Input
              value={draft.literal}
              disabled={disabled}
              maxLength={120}
              autoComplete="off"
              aria-describedby={`${hint}-literal`}
              onChange={(e) => onChange({ ...draft, literal: e.target.value })}
            />
          </label>
          <p id={`${hint}-literal`} className="text-sm text-muted-foreground">
            Keep uncertain or as-needed wording as reported. A clock time is not
            inferred.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
              Timezone for these clock times
              <Input
                value={draft.timeZone}
                disabled={disabled}
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={`${hint}-zone`}
                onChange={(e) =>
                  onChange({ ...draft, timeZone: e.target.value })
                }
              />
            </label>
            <p id={`${hint}-zone`} className="text-sm text-muted-foreground">
              Review the named timezone. Times stay as local clock labels in
              that zone.
            </p>
          </div>
          <fieldset className="space-y-2" disabled={disabled}>
            <legend className="text-sm font-medium">Selected weekdays</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {scheduleWeekdays.map((name, index) => (
                <label
                  key={name}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    aria-label={name}
                    checked={draft.weekdays.includes(index + 1)}
                    onChange={(e) =>
                      onChange({
                        ...draft,
                        weekdays: e.target.checked
                          ? [...draft.weekdays, index + 1].sort((a, b) => a - b)
                          : draft.weekdays.filter((day) => day !== index + 1),
                      })
                    }
                  />
                  {name.slice(0, 3)}
                </label>
              ))}
            </div>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() =>
                onChange({ ...draft, weekdays: [1, 2, 3, 4, 5, 6, 7] })
              }
            >
              Select every day
            </Button>
          </fieldset>
          <fieldset className="space-y-3" disabled={disabled}>
            <legend className="text-sm font-medium">
              Clock times (up to 8)
            </legend>
            {draft.times.map((time, index) => (
              <div key={index} className="flex min-w-0 items-end gap-3">
                <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium">
                  Clock time {index + 1}
                  <Input
                    type="time"
                    value={time}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange({
                        ...draft,
                        times: draft.times.map((old, i) =>
                          i === index ? e.target.value : old,
                        ),
                      })
                    }
                  />
                </label>
                <Button
                  variant="outline"
                  disabled={disabled || draft.times.length === 1}
                  onClick={() =>
                    onChange({
                      ...draft,
                      times: draft.times.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove<span className="sr-only"> clock time {index + 1}</span>
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              disabled={disabled || draft.times.length >= 8}
              onClick={() =>
                onChange({ ...draft, times: [...draft.times, ''] })
              }
            >
              Add clock time
            </Button>
          </fieldset>
        </div>
      )}
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {(['startDate', 'endDate'] as const).map((key) => (
          <label
            key={key}
            className="flex min-w-0 flex-col gap-2 text-sm font-medium"
          >
            Schedule {key === 'startDate' ? 'starts' : 'ends'} (optional)
            <Input
              type="date"
              value={draft[key]}
              disabled={disabled}
              onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
        Instructions (optional)
        <Input
          value={draft.instructions}
          disabled={disabled}
          maxLength={120}
          autoComplete="off"
          placeholder="Not recorded"
          onChange={(e) => onChange({ ...draft, instructions: e.target.value })}
        />
      </label>
    </div>
  );
}
