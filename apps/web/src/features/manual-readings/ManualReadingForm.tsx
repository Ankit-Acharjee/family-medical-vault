import { useId } from 'react';
import { manualReadingUnits } from '@fmv/contracts';
import { Input } from '../../components/ui/input';
import { changeKind, manualLabels } from './draft';
import type { ManualDraft } from './draft';
export function ManualReadingForm({
  draft,
  onChange,
  editing,
  disabled,
}: {
  draft: ManualDraft;
  onChange: (d: ManualDraft) => void;
  editing: boolean;
  disabled: boolean;
}) {
  const offsetHint = useId();
  const field = (label: string, key: 'value' | 'systolic' | 'diastolic') => (
    <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
      {label}
      <Input
        name={key}
        inputMode="decimal"
        autoComplete="off"
        maxLength={32}
        value={draft[key]}
        disabled={disabled}
        onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
      />
    </label>
  );
  const selectClass =
    'min-h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60';
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
          Reading type
          <select
            name="reading-kind"
            className={selectClass}
            disabled={disabled || editing}
            value={draft.kind}
            onChange={(e) =>
              onChange(changeKind(draft, e.target.value as ManualDraft['kind']))
            }
          >
            {Object.entries(manualLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
          Unit
          <select
            name="reading-unit"
            className={selectClass}
            disabled={disabled}
            value={draft.unit}
            onChange={(e) => onChange({ ...draft, unit: e.target.value })}
          >
            {manualReadingUnits[draft.kind].map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </label>
      </div>
      {draft.kind === 'blood-pressure' ? (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {field('Systolic', 'systolic')}
          {field('Diastolic', 'diastolic')}
        </div>
      ) : (
        field('Value', 'value')
      )}
      <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
        Observation date and time
        <Input
          name="observed-local"
          type="datetime-local"
          step="1"
          disabled={disabled}
          value={draft.localTime}
          onChange={(e) => onChange({ ...draft, localTime: e.target.value })}
        />
      </label>
      <div className="flex min-w-0 flex-col gap-2">
        <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
          UTC offset for this observation
          <Input
            name="observed-offset"
            aria-describedby={offsetHint}
            placeholder="+05:30 or Z for UTC"
            autoComplete="off"
            maxLength={6}
            disabled={disabled}
            value={draft.offset}
            onChange={(e) => onChange({ ...draft, offset: e.target.value })}
          />
        </label>
        <p id={offsetHint} className="text-xs text-muted-foreground">
          Enter the offset that applied at the observation time. Historical
          timezones are not guessed.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Enter exact non-negative decimal values, up to 32 characters. Values and
        units are saved as entered; this form does not assess medical accuracy.
      </p>
    </div>
  );
}
