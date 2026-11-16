import { useEffect, useRef, useState } from 'react';
import {
  canonicalComparisonMembers,
  isMeasurementComparisonResult,
  isSaveExtractionResult,
  measurementKey,
} from '@fmv/contracts';
import type {
  MeasurementComparisonResult,
  MeasurementOption,
  MeasurementWorkspace,
  MeasurementSource,
} from '@fmv/contracts';
import { readClinicalJson } from '../documents/useClinicalReview';
type Action =
  | {
      kind: 'confirm';
      setId: string;
      expectedRevision: number;
      options: MeasurementOption[];
    }
  | { kind: 'read'; setId: string; sources: MeasurementSource[] };
type Phase = 'idle' | 'pending' | 'uncertain' | 'conflict' | 'failed';
export function useComparisonAction(
  p: string,
  enabled: boolean,
  workspace: MeasurementWorkspace | null,
  onSaved: (message: string) => void,
  onDenied: () => void,
) {
  const [action, setAction] = useState<Action | null>(null),
    [read, setRead] = useState<
      MeasurementComparisonResult | 'loading' | 'failed'
    >('loading'),
    [phase, setPhase] = useState<Phase>('idle'),
    [attempt, setAttempt] = useState(0);
  const [readSource, setReadSource] = useState<MeasurementWorkspace | null>(
    null,
  );
  const callbacks = useRef({ onSaved, onDenied });
  callbacks.current = { onSaved, onDenied };
  const write = useRef<AbortController | null>(null),
    busy = useRef(false),
    operation = useRef<{
      setId: string;
      body: string;
      method: 'PUT' | 'POST';
      suffix: string;
    } | null>(null);
  const allowed = useRef(enabled);
  allowed.current = enabled;
  const kind = action?.kind,
    id = action?.setId;
  useEffect(() => {
    if (!enabled) {
      write.current?.abort();
      if (busy.current) setPhase('uncertain');
      busy.current = false;
      return;
    }
    if (kind !== 'read' || !id) return;
    const abort = new AbortController();
    setReadSource(workspace);
    setRead('loading');
    const timer = window.setTimeout(() => {
      abort.abort();
      setRead('failed');
    }, 15000);
    void (async () => {
      const response = await fetch(
        `/api/patients/${encodeURIComponent(p)}/measurement-comparisons/${encodeURIComponent(id)}`,
        { signal: abort.signal, credentials: 'same-origin', cache: 'no-store' },
      );
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(response.status)) {
        callbacks.current.onDenied();
        return;
      }
      if (!response.ok) throw Error();
      const value = await readClinicalJson(response, abort.signal);
      abort.signal.throwIfAborted();
      if (
        !isMeasurementComparisonResult(value) ||
        value.setId !== id ||
        value.measurements.some((m) => m.provenance.patientId !== p)
      )
        throw Error();
      setRead(value);
      if (
        operation.current?.suffix === '/withdraw' &&
        value.status === 'withdrawn'
      ) {
        operation.current = null;
        busy.current = false;
        setPhase('idle');
        setAction(null);
        callbacks.current.onSaved('Comparability confirmation is withdrawn.');
      }
    })()
      .catch(() => {
        if (!abort.signal.aborted) setRead('failed');
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [p, id, kind, enabled, attempt, workspace]);
  useEffect(
    () => () => {
      write.current?.abort();
    },
    [],
  );
  const validContext = !!(
    enabled &&
    workspace &&
    action &&
    (action.kind === 'read' ||
      (workspace.canConfirm &&
        action.options.every((o) =>
          workspace.measurements.some(
            (current) =>
              measurementKey(current.member) === measurementKey(o.member),
          ),
        )))
  );
  const begin = (next: Action) => {
    if (busy.current) return;
    operation.current = null;
    setPhase('idle');
    setRead('loading');
    setAction(next);
  };
  const close = () => {
    if (busy.current) return;
    write.current?.abort();
    operation.current = null;
    setAction(null);
    setPhase('idle');
    if (phase === 'uncertain')
      callbacks.current.onSaved(
        'The previous save was not confirmed. Check refreshed comparisons before starting another set.',
      );
  };
  const submit = async (retry = false) => {
    if (!action || !validContext || !workspace?.canConfirm || busy.current)
      return;
    if (!retry) {
      if (action.kind === 'confirm')
        operation.current = {
          setId: action.setId,
          method: 'PUT',
          suffix: '',
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            expectedRevision: action.expectedRevision,
            confirmed: true,
            members: canonicalComparisonMembers(
              action.options.map((o) => o.member),
            ),
          }),
        };
      else {
        if (
          typeof read !== 'object' ||
          !read.canConfirm ||
          read.status === 'missing' ||
          read.status === 'withdrawn'
        )
          return;
        operation.current = {
          setId: action.setId,
          method: 'POST',
          suffix: '/withdraw',
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            expectedRevision: read.revision,
            confirmed: true,
          }),
        };
      }
    }
    const op = operation.current;
    if (!op || op.setId !== action.setId) return;
    busy.current = true;
    setPhase('pending');
    const abort = new AbortController();
    write.current = abort;
    const timer = window.setTimeout(() => {
      abort.abort();
      busy.current = false;
      setPhase('uncertain');
    }, 15000);
    try {
      const bootstrap = await fetch('/api/auth/bootstrap', {
        signal: abort.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(bootstrap.status)) {
        operation.current = null;
        callbacks.current.onDenied();
        return;
      }
      if (!bootstrap.ok) throw Error();
      const boot = await readClinicalJson(bootstrap, abort.signal);
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
      const csrf = boot.csrf;
      abort.signal.throwIfAborted();
      const response = await fetch(
        `/api/patients/${encodeURIComponent(p)}/measurement-comparisons/${encodeURIComponent(op.setId)}${op.suffix}`,
        {
          method: op.method,
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: op.body,
          signal: abort.signal,
          credentials: 'same-origin',
          cache: 'no-store',
        },
      );
      abort.signal.throwIfAborted();
      if (!allowed.current) return;
      if ([401, 403, 404].includes(response.status)) {
        operation.current = null;
        callbacks.current.onDenied();
        return;
      }
      if (response.status === 409) {
        operation.current = null;
        setPhase('conflict');
        return;
      }
      if (!response.ok) throw Error();
      const value = await readClinicalJson(response, abort.signal);
      abort.signal.throwIfAborted();
      if (
        !isSaveExtractionResult(value) ||
        value.revision !== JSON.parse(op.body).expectedRevision + 1
      )
        throw Error();
      operation.current = null;
      busy.current = false;
      setAction(null);
      setPhase('idle');
      callbacks.current.onSaved(
        op.method === 'PUT'
          ? 'Comparability confirmed.'
          : 'Comparability confirmation withdrawn.',
      );
    } catch {
      if (!abort.signal.aborted) setPhase('uncertain');
    } finally {
      window.clearTimeout(timer);
      if (write.current === abort) {
        busy.current = false;
        write.current = null;
      }
    }
  };
  return {
    action,
    read: enabled && readSource === workspace ? read : ('loading' as const),
    phase,
    validContext,
    beginConfirm: (
      options: MeasurementOption[],
      target?: { setId: string; revision: number } | null,
    ) =>
      begin({
        kind: 'confirm',
        setId: target?.setId ?? crypto.randomUUID(),
        expectedRevision: target?.revision ?? 0,
        options,
      }),
    beginRead: (setId: string) =>
      begin({ kind: 'read', setId, sources: workspace?.sources ?? [] }),
    close,
    submit,
    reloadRead: () => {
      operation.current = null;
      setPhase('idle');
      setRead('loading');
      setAttempt((n) => n + 1);
    },
  };
}
