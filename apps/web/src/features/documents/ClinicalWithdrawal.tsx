import type { ClinicalReviewedItem } from '@fmv/contracts';
import type {
  ClinicalSaveState,
  ClinicalOperation,
} from './clinicalReviewDraft';
import { Button } from '../../components/ui/button';
export function ClinicalWithdrawal({
  items,
  selected,
  confirmed,
  saveState,
  operation,
  onSelection,
  onConfirmation,
  onSubmit,
}: {
  items: ClinicalReviewedItem[];
  selected: string[];
  confirmed: boolean;
  saveState: ClinicalSaveState;
  operation: ClinicalOperation;
  onSelection: (ids: string[]) => void;
  onConfirmation: (value: boolean) => void;
  onSubmit: () => void;
}) {
  const locked = saveState !== 'idle',
    retry = saveState === 'uncertain' && operation === 'withdrawal';
  if (!items.length) return null;
  return (
    <section
      aria-label="Withdraw confirmed lab fields"
      className="space-y-3 rounded-lg border border-border p-3"
    >
      <h4 className="text-sm font-semibold">
        Withdraw a mistaken confirmation
      </h4>
      <p className="text-sm text-muted-foreground">
        Selected entries leave the current confirmed set. Their original files,
        evidence and confirmation history remain. Unsaved review changes will
        reset.
      </p>
      <fieldset disabled={locked} className="space-y-2">
        <legend className="sr-only">Confirmed entries to withdraw</legend>
        {items.map((item, index) => (
          <label
            key={item.source.id}
            className="flex min-h-11 items-start gap-2 text-sm"
          >
            <input
              type="checkbox"
              aria-label={`Withdraw confirmation ${index + 1}: ${item.fields.analyte} · ${item.fields.result}`}
              className="mt-1 size-5 shrink-0 accent-primary"
              checked={selected.includes(item.source.id)}
              onChange={(e) =>
                onSelection(
                  e.target.checked
                    ? [...selected, item.source.id]
                    : selected.filter((id) => id !== item.source.id),
                )
              }
            />
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              {item.fields.analyte} · {item.fields.result}{' '}
              {item.fields.unit ?? ''}
            </span>
          </label>
        ))}
        <label className="flex min-h-11 items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            className="mt-1 size-5 shrink-0 accent-primary"
            onChange={(e) => onConfirmation(e.target.checked)}
          />
          <span>
            I want to withdraw these confirmations and keep their history.
          </span>
        </label>
      </fieldset>
      <Button
        variant="outline"
        className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={!retry && (locked || !selected.length || !confirmed)}
        onClick={onSubmit}
      >
        {retry
          ? 'Retry withdrawal'
          : saveState === 'pending' && operation === 'withdrawal'
            ? 'Withdrawing…'
            : 'Withdraw selected confirmations'}
      </Button>
    </section>
  );
}
