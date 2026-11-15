import { useEffect, useRef, useState } from 'react';
import {
  isDiagnosisReviewResult,
  isSaveExtractionResult,
} from '@fmv/contracts';
import type { DiagnosisReviewResult, SavedExtraction } from '@fmv/contracts';
import {
  diagnosisDraftKey,
  type DiagnosisDraftRef,
} from './diagnosisReviewDraft';
import type {
  ClinicalSaveState,
  ClinicalOperation,
} from './clinicalReviewDraft';
import { readClinicalJson } from './useClinicalReview';
export function useDiagnosisReview(
  patientId: string,
  documentId: string,
  snapshot: SavedExtraction,
  onDenied: () => void,
  draft: DiagnosisDraftRef,
) {
  const path = `/api/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(documentId)}/diagnosis-review`;
  const [state, setState] = useState<
    DiagnosisReviewResult | 'loading' | 'failed' | 'conflict'
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
      const value = await readClinicalJson(response, abort.signal);
      abort.signal.throwIfAborted();
      if (!isDiagnosisReviewResult(value)) throw Error();
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
        cached?.key === diagnosisDraftKey(patientId, documentId, value)
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
  const save = async (
    body: string,
    operation: ClinicalOperation = 'confirmation',
  ) => {
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
      const value = await readClinicalJson(boot, abort.signal);
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
      const response = await fetch(
        operation === 'withdrawal' ? `${path}/withdraw` : path,
        {
          method: operation === 'withdrawal' ? 'POST' : 'PUT',
          signal: abort.signal,
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': value.csrf,
          },
          body,
        },
      );
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
      const result = await readClinicalJson(response, abort.signal);
      if (
        !isSaveExtractionResult(result) ||
        result.revision !== state.context.revision + 1
      )
        throw Error();
      abort.signal.throwIfAborted();
      setSaveState('saved');
      return true;
    } catch {
      if (!abort.signal.aborted || timedOut) setSaveState('uncertain');
    } finally {
      window.clearTimeout(deadline);
      pending.current = false;
    }
  };
  return { state, saveState, reload, save };
}
