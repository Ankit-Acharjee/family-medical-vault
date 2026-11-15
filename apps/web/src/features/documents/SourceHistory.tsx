import { useEffect, useRef, useState } from 'react';
import {
  isSourceHistoryResult,
  sourceCandidateExcerpts,
  type SourceReviewKind,
  type SourceHistoryResult,
} from './sourceReviewDomain';
import type { SourceReviewResult } from './sourceReviewDomain';
import { Button } from '../../components/ui/button';
import { readClinicalJson } from './useClinicalReview';
export function SourceHistory({
  kind,
  patientId,
  documentId,
  context,
  onDenied,
  onReload,
}: {
  kind: SourceReviewKind;
  patientId: string;
  documentId: string;
  context: SourceReviewResult['context'];
  onDenied: () => void;
  onReload: () => void;
}) {
  const [state, setState] = useState<
    SourceHistoryResult | 'idle' | 'loading' | 'failed' | 'conflict'
  >('idle');
  const current = useRef<AbortController | null>(null);
  const [before, setBefore] = useState(context.revision);
  useEffect(
    () => () => {
      current.current?.abort();
      current.current = null;
    },
    [],
  );
  const load = async (cursor: number) => {
    current.current?.abort();
    const abort = new AbortController();
    current.current = abort;
    setBefore(cursor);
    setState('loading');
    const timer = window.setTimeout(() => abort.abort(), 20000);
    try {
      const r = await fetch(
        `/api/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(documentId)}/${kind}-review/history?beforeRevision=${cursor}`,
        { signal: abort.signal, credentials: 'same-origin', cache: 'no-store' },
      );
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(r.status)) {
        onDenied();
        return;
      }
      if (!r.ok) throw Error();
      const v = await readClinicalJson(r, abort.signal);
      abort.signal.throwIfAborted();
      if (!isSourceHistoryResult(kind, v)) throw Error();
      if (
        (
          [
            'sourceRevision',
            'sourceSha256',
            'lifecycleVersion',
            'revision',
            'canVerify',
          ] as const
        ).some((k) => v.context[k] !== context[k])
      ) {
        setState('conflict');
        return;
      }
      setState(v);
    } catch {
      if (current.current === abort) setState('failed');
    } finally {
      window.clearTimeout(timer);
    }
  };
  return (
    <section
      aria-label={
        kind === 'diagnosis'
          ? 'Diagnosis confirmation history'
          : 'Medication confirmation history'
      }
      className="space-y-2 border-t border-border pt-3"
    >
      <h4 className="text-sm font-semibold">Earlier source confirmations</h4>
      <p className="text-pretty text-sm text-muted-foreground">
        {kind === 'diagnosis'
          ? 'Historical statements retain their wording. They do not replace the current set or establish current diagnoses.'
          : 'Historical prescription fields retain their wording. They do not replace the current set or create an active regimen or schedule.'}
      </p>
      {state === 'idle' ? (
        <Button variant="secondary" onClick={() => void load(context.revision)}>
          View earlier source confirmations
        </Button>
      ) : state === 'loading' ? (
        <p role="status">Loading source confirmation history…</p>
      ) : state === 'failed' ? (
        <>
          <p role="status">Source confirmation history could not be loaded.</p>
          <Button variant="secondary" onClick={() => void load(before)}>
            Retry source confirmation history
          </Button>
        </>
      ) : state === 'conflict' ? (
        <>
          <p role="status">The source or confirmation changed.</p>
          <Button variant="secondary" onClick={onReload}>
            Reload saved text
          </Button>
        </>
      ) : (
        <>
          {!state.snapshot ? (
            <p role="status">No earlier source confirmations.</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Revision {state.snapshot.revision} ·{' '}
                {new Date(state.snapshot.confirmedAt).toLocaleString()} ·{' '}
                {state.snapshot.action === 'withdrawal'
                  ? 'Withdrawal'
                  : 'Source confirmation'}
              </p>
              <p className="text-sm text-muted-foreground">
                Saved text revision {state.snapshot.sourceRevision} ·{' '}
                {state.snapshot.extraction.method === 'pdf-text'
                  ? 'Embedded PDF text'
                  : 'OCR'}
                {state.snapshot.extraction.partial ? ' · partial text' : ''}
                {state.snapshot.extraction.downsized ? ' · image resized' : ''}
              </p>
              {state.snapshot.statements.length === 0 && (
                <p className="text-sm">
                  {kind === 'diagnosis'
                    ? 'No active source statements in this revision.'
                    : 'No confirmed prescription source blocks in this revision.'}
                </p>
              )}
              {state.snapshot.statements.map((s) => (
                <blockquote
                  key={s.id}
                  className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm [overflow-wrap:anywhere]"
                >
                  {sourceCandidateExcerpts(s).map((excerpt, index) => (
                    <p key={index}>{excerpt}</p>
                  ))}
                </blockquote>
              ))}
              {state.snapshot.withdrawnStatements.map((s) => (
                <div key={s.id} className="space-y-1 text-sm">
                  <p className="font-medium">
                    {kind === 'diagnosis'
                      ? 'Withdrawn source statement'
                      : 'Withdrawn prescription source fields'}
                  </p>
                  <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 [overflow-wrap:anywhere]">
                    {sourceCandidateExcerpts(s).map((excerpt, index) => (
                      <p key={index}>{excerpt}</p>
                    ))}
                  </blockquote>
                </div>
              ))}
              {state.nextBefore !== null && (
                <Button
                  variant="secondary"
                  onClick={() => void load(state.nextBefore!)}
                >
                  Older source confirmation
                </Button>
              )}
              {state.snapshot.revision < context.revision - 1 && (
                <Button
                  variant="secondary"
                  onClick={() => void load(context.revision)}
                >
                  Latest earlier source confirmation
                </Button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
