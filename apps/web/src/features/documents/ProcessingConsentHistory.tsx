import { useEffect, useRef, useState } from 'react';
import {
  isProcessingConsentHistoryResult,
  type ProcessingConsentContext,
  type ProcessingConsentSnapshot,
} from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import { ConsentSnapshot } from './ProcessingConsentDetails';
import { readClinicalJson } from './useClinicalReview';

export function ProcessingConsentHistory({
  path,
  context,
  enabled,
  onDenied,
  onReload,
}: {
  path: string;
  context: ProcessingConsentContext;
  enabled: boolean;
  onDenied: () => void;
  onReload: () => void;
}) {
  const [entries, setEntries] = useState<ProcessingConsentSnapshot[]>([]);
  const [before, setBefore] = useState<number | null>(
    context.revision > 1 ? context.revision : null,
  );
  const [state, setState] = useState<
    'idle' | 'loading' | 'failed' | 'conflict'
  >('idle');
  const controller = useRef<AbortController | null>(null);
  const allowed = useRef(enabled);
  allowed.current = enabled;
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (!enabled) {
      controller.current?.abort();
      setState((previous) => (previous === 'loading' ? 'idle' : previous));
    }
    return () => controller.current?.abort();
  }, [enabled]);
  const load = async () => {
    if (!allowed.current || !before || state === 'loading') return;
    const abort = new AbortController();
    controller.current = abort;
    setState('loading');
    const deadline = window.setTimeout(() => {
      if (!abort.signal.aborted) {
        setState('failed');
        abort.abort();
      }
    }, 20_000);
    try {
      const response = await fetch(`${path}/history?beforeRevision=${before}`, {
        signal: abort.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(response.status)) {
        onDenied();
        return;
      }
      if (!response.ok) throw Error();
      const value = await readClinicalJson(response, abort.signal);
      abort.signal.throwIfAborted();
      if (
        !isProcessingConsentHistoryResult(value) ||
        (value.snapshot && value.snapshot.revision >= before)
      )
        throw Error();
      if (
        value.context.revision !== context.revision ||
        value.context.sourceSha256 !== context.sourceSha256 ||
        value.context.sourceRevision !== context.sourceRevision ||
        value.context.lifecycleVersion !== context.lifecycleVersion
      ) {
        setState('conflict');
        return;
      }
      if (allowed.current && controller.current === abort) {
        if (value.snapshot) {
          const snapshot = value.snapshot;
          setEntries((previous) => [...previous, snapshot]);
        }
        setBefore(value.nextBefore);
        setState('idle');
        // The last pagination button disappears; keep focus inside this task.
        if (value.nextBefore === null) heading.current?.focus();
      }
    } catch {
      if (!abort.signal.aborted && controller.current === abort)
        setState('failed');
    } finally {
      window.clearTimeout(deadline);
    }
  };
  return (
    <section
      hidden={!enabled}
      aria-label="Consent history"
      className="flex min-w-0 flex-col gap-3 border-t border-border pt-4"
    >
      <h3 ref={heading} tabIndex={-1} className="text-base font-semibold">
        Consent history
      </h3>
      <p className="text-sm text-muted-foreground">
        Earlier records keep the provider, expiry and exact source binding as
        recorded. A historical grant does not authorize processing now.
      </p>
      {entries.length > 0 && (
        <ol className="flex min-w-0 flex-col gap-4">
          {entries.map((entry) => (
            <li
              key={entry.revision}
              className="min-w-0 border-l-2 border-border pl-3"
            >
              <ConsentSnapshot snapshot={entry} />
            </li>
          ))}
        </ol>
      )}
      {state === 'conflict' ? (
        <div className="flex flex-col items-start gap-2">
          <p role="status" className="text-sm">
            Consent or its source changed. Reload consent before reading more
            history.
          </p>
          <Button variant="outline" onClick={onReload}>
            Reload consent
          </Button>
        </div>
      ) : before ? (
        <div className="flex flex-col items-start gap-2">
          {state === 'failed' && (
            <p role="status" className="text-sm">
              Earlier consent could not be loaded. Retry this history page.
            </p>
          )}
          <Button
            variant="outline"
            disabled={state === 'loading'}
            onClick={() => void load()}
          >
            {state === 'loading'
              ? 'Loading earlier consent…'
              : state === 'failed'
                ? 'Retry consent history'
                : 'Load earlier consent'}
          </Button>
        </div>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {entries.length
            ? 'No more consent history.'
            : 'No earlier consent history.'}
        </p>
      )}
    </section>
  );
}
