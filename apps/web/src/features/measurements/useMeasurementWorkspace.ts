import { useEffect, useRef, useState } from 'react';
import { isMeasurementWorkspace } from '@fmv/contracts';
import type { MeasurementWorkspace } from '@fmv/contracts';
import { readClinicalJson } from '../documents/useClinicalReview';
export function useMeasurementWorkspace(
  patientId: string,
  enabled: boolean,
  onDenied: () => void,
) {
  const [state, setState] = useState<
    | { phase: 'loading' | 'failed' | 'denied' }
    | { phase: 'ready'; value: MeasurementWorkspace }
  >({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [wasEnabled, setWasEnabled] = useState(enabled);
  // React discards this render before committing old protected content.
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    if (enabled) setState({ phase: 'loading' });
  }
  const denied = useRef(onDenied);
  denied.current = onDenied;
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    setState({ phase: 'loading' });
    const timer = window.setTimeout(() => {
      abort.abort();
      setState({ phase: 'failed' });
    }, 15000);
    void (async () => {
      const response = await fetch(
        `/api/patients/${encodeURIComponent(patientId)}/measurement-workspace`,
        { credentials: 'same-origin', cache: 'no-store', signal: abort.signal },
      );
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(response.status)) {
        setState({ phase: 'denied' });
        denied.current();
        return;
      }
      if (!response.ok) throw Error();
      const value = await readClinicalJson(response, abort.signal);
      abort.signal.throwIfAborted();
      if (!isMeasurementWorkspace(value) || value.patientId !== patientId)
        throw Error();
      setState({ phase: 'ready', value });
    })()
      .catch(() => {
        if (!abort.signal.aborted) setState({ phase: 'failed' });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [patientId, enabled, attempt]);
  return {
    state,
    reload: () => {
      setState({ phase: 'loading' });
      setAttempt((n) => n + 1);
    },
    value: enabled && state.phase === 'ready' ? state.value : null,
  };
}
