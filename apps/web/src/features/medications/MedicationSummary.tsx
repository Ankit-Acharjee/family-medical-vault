import type { MedicationReconciliationView } from '@fmv/contracts';
export function MedicationSummary({
  record,
  details = false,
}: {
  record: MedicationReconciliationView;
  details?: boolean;
}) {
  const { entry, sourceState } = record;
  const fields = [
    ['Strength', entry.fields.strength],
    ['Dose', entry.fields.dose],
    ['Frequency', entry.fields.frequency],
    ['Route', entry.fields.route],
    ['Duration', entry.fields.duration],
    ['Start as recorded', entry.fields.start],
    ['End as recorded', entry.fields.end],
    ['Instructions', entry.fields.instructions],
  ];
  return (
    <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
      <div>
        <p className="text-xs font-medium text-muted-foreground">
          Owner-recorded ·{' '}
          {entry.recordedStatus === 'current' ? 'Current' : 'Historical'} ·
          Revision {entry.revision}
        </p>
        <h3 className="mt-1 text-base font-semibold">
          {entry.fields.medication}
        </h3>
      </div>
      {sourceState === 'source-review-required' && (
        <p className="rounded-lg border border-border bg-muted p-3 text-sm">
          Source review required. This record is excluded from trusted use; its
          recorded status has not changed.
        </p>
      )}
      <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
        {fields
          .filter(
            ([label]) =>
              details || ['Strength', 'Dose', 'Frequency'].includes(label!),
          )
          .map(([label, value]) => (
            <div className="min-w-0" key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">
                {value ?? 'Unknown'}
              </dd>
            </div>
          ))}
      </dl>
      {details && (
        <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <p>
            Recorded:{' '}
            <time dateTime={entry.recordedAt}>{entry.recordedAt}</time>
          </p>
          <p>Source document: {entry.source.documentId}</p>
          <p>
            Source block: {entry.source.candidateId} · Text revision{' '}
            {entry.source.sourceRevision} · Review revision{' '}
            {entry.source.reviewRevision}
          </p>
          <p>Source fingerprint: {entry.source.sourceSha256}</p>
          <p>
            {sourceState === 'current-source'
              ? 'Source binding is current.'
              : 'Source binding needs explicit review and reconciliation.'}
          </p>
        </div>
      )}
    </div>
  );
}
