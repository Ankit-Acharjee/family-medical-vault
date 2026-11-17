import { useEffect, useRef, useState } from 'react';
import { isSaveExtractionResult } from '@fmv/contracts';
import { readClinicalJson } from '../documents/useClinicalReview';
export class ManualApiError extends Error {
  constructor(public status: number) {
    super('Manual reading request unavailable');
  }
}
export async function manualJson(
  url: string,
  signal: AbortSignal,
  init: RequestInit = {},
) {
  const response = await fetch(url, {
    ...init,
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  signal.throwIfAborted();
  if (!response.ok) throw new ManualApiError(response.status);
  const value = await readClinicalJson(response, signal);
  signal.throwIfAborted();
  return value;
}
export function useManualResource<T>(
  url: string | null,
  valid: (v: unknown) => v is T,
  onDenied: () => void,
) {
  const [state, setState] = useState<
      { phase: 'loading' | 'failed' | 'denied' } | { phase: 'ready'; value: T }
    >({ phase: 'loading' }),
    [attempt, setAttempt] = useState(0),
    [previous, setPrevious] = useState(url);
  if (previous !== url) {
    setPrevious(url);
    setState({ phase: 'loading' });
  }
  const callbacks = useRef({ valid, onDenied });
  callbacks.current = { valid, onDenied };
  const identity = useRef({ url, attempt, token: {} });
  if (identity.current.url !== url || identity.current.attempt !== attempt)
    identity.current = { url, attempt, token: {} };
  const token = identity.current.token;
  useEffect(() => {
    if (!url) return;
    const abort = new AbortController();
    setState({ phase: 'loading' });
    const timer = window.setTimeout(() => {
      abort.abort();
      if (identity.current.token === token) setState({ phase: 'failed' });
    }, 15000);
    void manualJson(url, abort.signal)
      .then((value) => {
        abort.signal.throwIfAborted();
        if (identity.current.token !== token) return;
        if (!callbacks.current.valid(value)) throw Error();
        setState({ phase: 'ready', value });
      })
      .catch((error) => {
        if (abort.signal.aborted || identity.current.token !== token) return;
        if (
          error instanceof ManualApiError &&
          [401, 403, 404].includes(error.status)
        ) {
          setState({ phase: 'denied' });
          callbacks.current.onDenied();
        } else setState({ phase: 'failed' });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [url, attempt, token]);
  return {
    value: url && state.phase === 'ready' ? state.value : null,
    phase: state.phase,
    reload: () => {
      setState({ phase: 'loading' });
      setAttempt((n) => n + 1);
    },
  };
}
type Operation = {
  url: string;
  method: 'PUT' | 'POST';
  body: string;
  revision: number;
};
export function useManualWrite(
  enabled: boolean,
  onSaved: () => void,
  onDenied: () => void,
) {
  const [phase, setPhase] = useState<
    'idle' | 'pending' | 'uncertain' | 'conflict' | 'invalid'
  >('idle');
  const operation = useRef<Operation | null>(null),
    request = useRef<AbortController | null>(null),
    busy = useRef(false),
    allowed = useRef(enabled),
    callbacks = useRef({ onSaved, onDenied });
  allowed.current = enabled;
  callbacks.current = { onSaved, onDenied };
  useEffect(() => {
    if (!enabled) {
      request.current?.abort();
      if (busy.current) setPhase('uncertain');
      busy.current = false;
    }
  }, [enabled]);
  useEffect(() => () => request.current?.abort(), []);
  const reset = () => {
    if (busy.current) return;
    operation.current = null;
    setPhase('idle');
  };
  const submit = async (next: Operation) => {
    if (!allowed.current || busy.current) return;
    operation.current ??= next;
    const op = operation.current;
    if (op.url !== next.url) return;
    const abort = new AbortController();
    request.current = abort;
    busy.current = true;
    setPhase('pending');
    const timer = window.setTimeout(() => {
      abort.abort();
      if (request.current === abort) {
        busy.current = false;
        setPhase('uncertain');
      }
    }, 15000);
    try {
      const boot = await manualJson('/api/auth/bootstrap', abort.signal);
      if (
        !boot ||
        typeof boot !== 'object' ||
        !('enabled' in boot) ||
        boot.enabled !== true ||
        !('csrf' in boot) ||
        typeof boot.csrf !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(boot.csrf)
      )
        throw Error();
      const value = await manualJson(op.url, abort.signal, {
        method: op.method,
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': boot.csrf,
        },
        body: op.body,
      });
      if (!allowed.current) return;
      if (!isSaveExtractionResult(value) || value.revision !== op.revision + 1)
        throw Error();
      operation.current = null;
      busy.current = false;
      setPhase('idle');
      callbacks.current.onSaved();
    } catch (error) {
      if (abort.signal.aborted) return;
      if (
        error instanceof ManualApiError &&
        [401, 403, 404].includes(error.status)
      ) {
        operation.current = null;
        callbacks.current.onDenied();
      } else if (error instanceof ManualApiError && error.status === 409) {
        operation.current = null;
        setPhase('conflict');
      } else if (error instanceof ManualApiError && error.status === 400) {
        operation.current = null;
        setPhase('invalid');
      } else setPhase('uncertain');
    } finally {
      window.clearTimeout(timer);
      if (request.current === abort) {
        busy.current = false;
        request.current = null;
      }
    }
  };
  return { phase, submit, reset };
}
