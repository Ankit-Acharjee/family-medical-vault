import { useId } from 'react';
import { Input } from '../../components/ui/input';
import { medicationFieldLabels } from './draft';
import type { MedicationDraft } from './draft';
export const medicationSelectClass =
  'min-h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60';
export function MedicationForm({
  draft,
  disabled,
  onChange,
}: {
  draft: MedicationDraft;
  disabled: boolean;
  onChange: (draft: MedicationDraft) => void;
}) {
  const hint = useId();
  return (
    <div className="min-w-0 space-y-4">
      <p id={hint} className="text-pretty text-sm text-muted-foreground">
        Leave unknown optional fields empty. Doses and dates stay as recorded.
      </p>
      <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
        Recorded status
        <select
          className={medicationSelectClass}
          value={draft.status}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...draft,
              status: e.target.value as MedicationDraft['status'],
            })
          }
        >
          <option value="" disabled>
            Choose recorded status
          </option>
          <option value="current">Current</option>
          <option value="historical">Historical</option>
        </select>
      </label>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {(
          Object.keys(
            medicationFieldLabels,
          ) as (keyof MedicationDraft['fields'])[]
        ).map((key) => (
          <label
            key={key}
            className={`flex min-w-0 flex-col gap-2 text-sm font-medium${key === 'medication' || key === 'instructions' ? ' sm:col-span-2' : ''}`}
          >
            {medicationFieldLabels[key]}
            {key !== 'medication' && (
              <span className="sr-only"> (optional)</span>
            )}
            <Input
              value={draft.fields[key]}
              disabled={disabled}
              maxLength={120}
              autoComplete="off"
              aria-describedby={hint}
              placeholder={key === 'medication' ? 'Required' : 'Unknown'}
              onChange={(e) =>
                onChange({
                  ...draft,
                  fields: { ...draft.fields, [key]: e.target.value },
                })
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}
