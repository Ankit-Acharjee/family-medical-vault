import type {
  ProcessingConsentContext,
  ProcessingConsentResult,
  ProcessingConsentSnapshot,
} from '@fmv/contracts';

export function consentStatus(result: ProcessingConsentResult) {
  const { snapshot, context } = result;
  if (!snapshot) return 'No consent recorded';
  if (snapshot.action === 'withdrawal') return 'Withdrawn';
  if (
    snapshot.sourceSha256 !== context.sourceSha256 ||
    snapshot.sourceRevision !== context.sourceRevision ||
    snapshot.lifecycleVersion !== context.lifecycleVersion
  )
    return 'Invalidated';
  if (result.effective) return 'Current';
  if (Date.parse(snapshot.expiresAt) <= Date.now()) return 'Expired';
  return 'Invalidated';
}

export function ConsentSource({
  context,
}: {
  context: Omit<ProcessingConsentContext, 'revision'>;
}) {
  return (
    <dl className="grid min-w-0 gap-2 text-sm">
      <div>
        <dt className="text-muted-foreground">Original SHA-256</dt>
        <dd className="break-all font-mono text-xs leading-5">
          {context.sourceSha256}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Saved text revision</dt>
        <dd>
          {context.sourceRevision === 0
            ? 'None — original document only'
            : context.sourceRevision}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Lifecycle version</dt>
        <dd>{context.lifecycleVersion}</dd>
      </div>
    </dl>
  );
}

export function ConsentSnapshot({
  snapshot,
}: {
  snapshot: ProcessingConsentSnapshot;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm">
      <p className="font-medium tabular-nums">
        Revision {snapshot.revision} ·{' '}
        {snapshot.action === 'grant' ? 'Grant recorded' : 'Withdrawal recorded'}
      </p>
      <dl className="grid gap-2 sm:grid-cols-2">
        {[
          ['Provider', snapshot.providerId],
          ['Policy version', snapshot.policyVersion],
          ['Purpose', 'Document extraction'],
          [
            'Data categories',
            snapshot.dataCategories
              .map((category) =>
                category === 'original-document'
                  ? 'Original document'
                  : 'Saved text',
              )
              .join(', '),
          ],
          ['Recorded at', snapshot.recordedAt],
          ['Grant expiry', snapshot.expiresAt],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words [overflow-wrap:anywhere]">
              {value &&
              (label === 'Recorded at' || label === 'Grant expiry') ? (
                <time dateTime={value} title={value}>
                  {new Date(value).toLocaleString()}
                </time>
              ) : (
                value
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Dates are shown in your local time.
      </p>
      <details>
        <summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-ring">
          Recorded document source
        </summary>
        <ConsentSource context={snapshot} />
      </details>
    </div>
  );
}
