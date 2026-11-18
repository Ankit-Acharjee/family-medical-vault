import type { ManualReadingEntry } from '@fmv/contracts';
import { manualLabels, manualValue } from './draft';
export function ReadingSummary({ entry }: { entry: ManualReadingEntry }) {
  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <p className="text-xs text-muted-foreground">
        Manual / user-reported ·{' '}
        {entry.action === 'withdrawal' ? 'Withdrawn' : 'Recorded'} · revision{' '}
        {entry.revision}
      </p>
      <p className="mt-1 font-medium">{manualLabels[entry.reading.kind]}</p>
      <p className="mt-1 font-semibold tabular-nums">
        {manualValue(entry.reading)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Observed: {entry.reading.observedAt}
      </p>
    </div>
  );
}
