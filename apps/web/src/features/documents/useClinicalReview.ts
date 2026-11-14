import { useEffect, useRef, useState } from 'react';
import { isClinicalReviewResult, isSaveExtractionResult } from '@fmv/contracts';
import type { ClinicalReviewResult, SavedExtraction } from '@fmv/contracts';
import {
  clinicalDraftKey,
  type ClinicalDraftRef,
  type ClinicalSaveState,
} from './clinicalReviewDraft';
async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  const maximum = 1024 * 1024;
  if (Number(response.headers.get('content-length')) > maximum) {
    void response.body?.cancel();
    throw Error();
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.length;
      if (size > maximum) {
        void reader.cancel();
        throw Error();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
export function useClinicalReview(
  patientId: string,
  documentId: string,
  snapshot: SavedExtraction,
  onDenied: () => void,
  draft: ClinicalDraftRef,
) {
  const path = `/api/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(documentId)}/clinical-review`;
  const [state, setState] = useState<
    ClinicalReviewResult | 'loading' | 'failed' | 'conflict'
  >('loading');
  const [saveState, setSaveState] = useState<ClinicalSaveState>('idle');
  const [attempt, setAttempt] = useState(0);
  const denied = useRef(onDenied);
  denied.current = onDenied;
  const writer = useRef<AbortController | null>(null),
    pending = useRef(false);
  const revision = snapshot.revision,
    sha = snapshot.sourceSha256;
  useEffect(() => {
    const abort = new AbortController();
    setState('loading');
    setSaveState('idle');
    const deadline = window.setTimeout(() => {
      if (!abort.signal.aborted) {
        setState('failed');
        abort.abort();
      }
    }, 20000);
    void (async () => {
      const response = await fetch(path, {
        signal: abort.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(response.status)) {
        denied.current();
        return;
      }
      if (!response.ok) throw Error();
      const value = await json(response, abort.signal);
      abort.signal.throwIfAborted();
      if (!isClinicalReviewResult(value)) throw Error();
      if (
        value.context.sourceRevision !== revision ||
        value.context.sourceSha256 !== sha
      ) {
        setState('conflict');
        return;
      }
      const cached = draft.current;
      if (
        value.context.canVerify &&
        cached?.key === clinicalDraftKey(patientId, documentId, value)
      ) {
        setSaveState(
          cached.saveState === 'pending' ? 'uncertain' : cached.saveState,
        );
      } else {
        draft.current = null;
      }
      setState(value);
    })()
      .catch(() => {
        if (!abort.signal.aborted) setState('failed');
      })
      .finally(() => window.clearTimeout(deadline));
    return () => {
      window.clearTimeout(deadline);
      abort.abort();
      writer.current?.abort();
    };
  }, [path, patientId, documentId, revision, sha, attempt, draft]);
  const reload = () => {
    draft.current = null;
    writer.current?.abort();
    setState('loading');
    setAttempt((n) => n + 1);
  };
  const save = async (body: string) => {
    if (
      typeof state !== 'object' ||
      !state.context.canVerify ||
      pending.current ||
      !['idle', 'uncertain'].includes(saveState)
    )
      return;
    pending.current = true;
    const abort = new AbortController();
    writer.current = abort;
    setSaveState('pending');
    let timedOut = false;
    const deadline = window.setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, 20000);
    try {
      const boot = await fetch('/api/auth/bootstrap', {
        signal: abort.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(boot.status)) {
        denied.current();
        return;
      }
      if (!boot.ok) throw Error();
      const value = await json(boot, abort.signal);
      if (
        !value ||
        typeof value !== 'object' ||
        !('enabled' in value) ||
        value.enabled !== true ||
        !('csrf' in value) ||
        typeof value.csrf !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(value.csrf)
      )
        throw Error();
      abort.signal.throwIfAborted();
      const response = await fetch(path, {
        method: 'PUT',
        signal: abort.signal,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': value.csrf,
        },
        body,
      });
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(response.status)) {
        denied.current();
        return;
      }
      if (response.status === 409) {
        setSaveState('conflict');
        return;
      }
      if (response.status >= 500) throw Error();
      if (!response.ok) {
        setSaveState('failed');
        return;
      }
      const result = await json(response, abort.signal);
      if (
        !isSaveExtractionResult(result) ||
        result.revision !== state.context.revision + 1
      )
        throw Error();
      abort.signal.throwIfAborted();
      setSaveState('saved');
    } catch {
      if (!abort.signal.aborted || timedOut) setSaveState('uncertain');
    } finally {
      window.clearTimeout(deadline);
      pending.current = false;
    }
  };
  return { state, saveState, reload, save };
}
