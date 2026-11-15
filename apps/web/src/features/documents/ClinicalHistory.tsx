import { useEffect, useRef, useState } from 'react';
import { isClinicalHistoryResult } from '@fmv/contracts';
import type {
  ClinicalHistoryResult,
  ClinicalReviewResult,
} from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import { ClinicalLabFields } from './ClinicalLabFields';
import { readClinicalJson } from './useClinicalReview';

export function ClinicalHistory({
  patientId,
  documentId,
  context,
  onDenied,
  onReloadSource,
}: {
  patientId: string;
  documentId: string;
  context: ClinicalReviewResult['context'];
  onDenied: () => void;
  onReloadSource: () => void;
}) {
  const [state, setState] = useState<
    ClinicalHistoryResult | 'loading' | 'failed' | 'stale' | null
  >(null);
  const [before, setBefore] = useState(context.revision);
  const request = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (state && typeof state === 'object') heading.current?.focus();
  }, [state]);
  const load = async () => {
    request.current?.abort();
    const abort = new AbortController();
    request.current = abort;
    setState('loading');
    let expired = false;
    const deadline = window.setTimeout(() => {
      expired = true;
      abort.abort();
    }, 20000);
    try {
      const response = await fetch(
        `/api/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(documentId)}/clinical-review/history?beforeRevision=${before}`,
        { credentials: 'same-origin', cache: 'no-store', signal: abort.signal },
      );
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(response.status)) {
        onDenied();
        return;
      }
      if (!response.ok) throw Error();
      const result = await readClinicalJson(response, abort.signal);
      abort.signal.throwIfAborted();
      if (
        !isClinicalHistoryResult(result) ||
        (result.snapshot && result.snapshot.revision >= before) ||
        (result.nextBefore !== null && result.nextBefore >= before)
      )
        throw Error();
      if (
        result.context.sourceRevision !== context.sourceRevision ||
        result.context.sourceSha256 !== context.sourceSha256 ||
        result.context.lifecycleVersion !== context.lifecycleVersion
      ) {
        setState('stale');
        return;
      }
      setState(result);
      if (result.nextBefore !== null) setBefore(result.nextBefore);
    } catch {
      if (!abort.signal.aborted || expired) setState('failed');
    } finally {
      window.clearTimeout(deadline);
    }
  };
  const value = state && typeof state === 'object' ? state : null;
  return (
    <section
      aria-label="Earlier clinical confirmations"
      className="min-w-0 space-y-3 border-t border-border pt-3"
    >
      <h4 ref={heading} tabIndex={-1} className="text-sm font-semibold">
        Earlier owner confirmations
      </h4>
      <p className="text-sm text-muted-foreground">
        Read-only history. Viewing an earlier set does not replace the latest
        review or your corrections.
      </p>
      {state === 'loading' && (
        <p role="status" className="text-sm">
          Loading earlier confirmation…
        </p>
      )}
      {state === 'failed' && (
        <p role="status" className="text-sm">
          History could not be loaded. Retry; the current review remains
          available.
        </p>
      )}
      {state === 'stale' && (
        <p role="status" className="text-sm">
          The source or document changed. Reload saved text before viewing
          history.
        </p>
      )}
      {state === 'stale' && (
        <Button variant="secondary" onClick={onReloadSource}>
          Reload saved text
        </Button>
      )}
      {value &&
        (value.snapshot ? (
          <>
            <p className="text-sm text-muted-foreground">
              Confirmed set revision {value.snapshot.revision} ·{' '}
              {new Date(value.snapshot.verifiedAt).toLocaleString()} · saved
              text revision {value.snapshot.sourceRevision} ·{' '}
              {value.snapshot.extraction.method === 'pdf-text'
                ? 'embedded PDF text'
                : 'OCR'}
              {value.snapshot.extraction.partial ? ' · partial extraction' : ''}
              .
            </p>
            {value.snapshot.sourceRevision !== context.sourceRevision && (
              <p className="text-sm text-muted-foreground">
                This confirmation used an earlier saved extraction; its evidence
                is preserved below.
              </p>
            )}
            {value.snapshot.items.map((item) => (
              <details key={item.source.id}>
                <summary className="min-h-11 cursor-pointer content-center break-words text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
                  {item.fields.analyte} · {item.fields.result}{' '}
                  {item.fields.unit ?? ''}
                </summary>
                <ClinicalLabFields
                  candidate={item.source}
                  fields={item.fields}
                  editable={false}
                  verified
                  sourceAvailable={false}
                  onChange={() => {}}
                  onShowSource={() => {}}
                />
              </details>
            ))}
          </>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            No earlier confirmations.
          </p>
        ))}
      {state !== 'stale' && (!value || value.nextBefore !== null) && (
        <Button
          variant="secondary"
          disabled={state === 'loading'}
          onClick={() => void load()}
        >
          {state === 'failed'
            ? 'Retry confirmation history'
            : value
              ? 'View earlier set'
              : 'View previous confirmations'}
        </Button>
      )}
      {value?.snapshot && value.nextBefore === null && (
        <p className="text-sm text-muted-foreground">
          This is the earliest confirmed set.
        </p>
      )}
    </section>
  );
}
