import { useEffect, useRef, useState } from 'react';
import { isSaveExtractionResult } from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import type { SaveExtractionAttempt } from './savedExtraction';

export function SaveExtractionPanel({
  path,
  attempt,
  canSave,
  onDenied,
  onSaved,
}: {
  path: string;
  attempt: SaveExtractionAttempt | null;
  canSave: boolean | null;
  onDenied: () => void;
  onSaved?: (() => void) | undefined;
}) {
  const [state, setState] = useState<
    'idle' | 'pending' | 'saved' | 'uncertain' | 'conflict' | 'failed'
  >('idle');
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false);
  useEffect(() => () => controller.current?.abort(), []);
  if (canSave === false) {
    return (
      <p className="text-sm text-muted-foreground">
        This extraction is available in this view only. Saving requires edit and
        view access.
      </p>
    );
  }
  const save = async () => {
    if (
      !attempt ||
      pending.current ||
      state === 'saved' ||
      state === 'conflict'
    )
      return;
    const abort = new AbortController();
    controller.current = abort;
    pending.current = true;
    setState('pending');
    let timedOut = false;
    const deadline = window.setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, 20_000);
    try {
      const bootResponse = await fetch('/api/auth/bootstrap', {
        signal: abort.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(bootResponse.status)) {
        onDenied();
        return;
      }
      if (!bootResponse.ok) throw new Error();
      const boot: unknown = await bootResponse.json();
      if (
        !boot ||
        typeof boot !== 'object' ||
        !('enabled' in boot) ||
        boot.enabled !== true ||
        !('csrf' in boot) ||
        typeof boot.csrf !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(boot.csrf)
      )
        throw new Error();
      abort.signal.throwIfAborted();
      const response = await fetch(path, {
        method: 'PUT',
        signal: abort.signal,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': boot.csrf,
        },
        body: attempt.body,
      });
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(response.status)) {
        onDenied();
        return;
      }
      if (response.status === 409) {
        setState('conflict');
        return;
      }
      if (response.status >= 500) throw new Error();
      if (!response.ok) {
        setState('failed');
        return;
      }
      const value: unknown = await response.json();
      if (!isSaveExtractionResult(value)) throw new Error();
      if (!abort.signal.aborted) {
        setState('saved');
        onSaved?.();
      }
    } catch {
      if (!abort.signal.aborted || timedOut) setState('uncertain');
    } finally {
      window.clearTimeout(deadline);
      pending.current = false;
    }
  };
  const copy = !attempt
    ? 'Saving is unavailable for this result. Extract again to retry; the text remains available here.'
    : state === 'saved'
      ? 'Unverified text saved. Reopen it with Saved text on the document.'
      : state === 'uncertain'
        ? 'Save could not be confirmed. Retry save to confirm the same result.'
        : state === 'conflict'
          ? 'The document or saved text changed. Extract again before saving a new result.'
          : state === 'failed'
            ? 'This result could not be saved. Extract again before trying to save.'
            : 'Save this unverified text to reopen it later. A successful save replaces the previous saved text.';
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <p role="status" className="text-sm text-muted-foreground">
        {copy}
      </p>
      <Button
        disabled={
          !attempt || ['pending', 'saved', 'conflict', 'failed'].includes(state)
        }
        onClick={() => void save()}
      >
        {state === 'pending'
          ? 'Saving…'
          : state === 'saved'
            ? 'Saved'
            : state === 'uncertain'
              ? 'Retry save'
              : 'Save text'}
      </Button>
    </div>
  );
}
