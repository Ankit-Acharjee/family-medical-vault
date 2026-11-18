import type {
  MeasurementOption,
  MeasurementSource,
  ManualReadingEntry,
} from '@fmv/contracts';
import { MeasurementDetails } from '../measurements/MeasurementDetails';
import { ReadingSummary } from '../manual-readings/ReadingSummary';
export function SummaryLabRecord({
  row,
  source,
  enabled,
  onDenied,
  onReload,
}: {
  row: MeasurementOption;
  source: MeasurementSource | undefined;
  enabled: boolean;
  onDenied: () => void;
  onReload: () => void;
}) {
  if (!enabled) return null;
  return (
    <details className="min-w-0 rounded-xl border border-border p-4">
      <summary className="min-h-11 cursor-pointer rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-ring [overflow-wrap:anywhere]">
        <span className="font-semibold">{row.measurement.fields.analyte}</span>
        {' · '}
        {row.measurement.fields.result}{' '}
        {row.measurement.fields.unit ?? '(unit unknown)'}
        <span className="mt-1 block text-muted-foreground">
          Owner-confirmed ·{' '}
          {row.measurement.fields.date ?? 'Collection date unknown'} ·{' '}
          {row.title}
        </span>
      </summary>
      <MeasurementDetails
        measurement={row.measurement}
        source={source}
        enabled={enabled}
        onDenied={onDenied}
        onReload={onReload}
      />
    </details>
  );
}
export function SummaryManualRecord({ entry }: { entry: ManualReadingEntry }) {
  return (
    <div className="min-w-0 rounded-xl border border-border p-4">
      <ReadingSummary entry={entry} />
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="min-h-11 cursor-pointer content-center rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
          Reading reference
        </summary>
        <p>
          {entry.readingId} · revision {entry.revision}
        </p>
      </details>
    </div>
  );
}
