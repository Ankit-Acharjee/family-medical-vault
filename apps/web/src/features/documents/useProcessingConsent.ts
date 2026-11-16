import { useEffect, useRef, useState } from 'react';
import {
  isProcessingConsentResult,
  isSaveExtractionResult,
  type ProcessingConsentResult,
  type ProcessingConsentContext,
  type WithdrawProcessingConsent,
} from '@fmv/contracts';
import { readClinicalJson } from './useClinicalReview';

export type ConsentWriteState =
  'idle' | 'pending' | 'uncertain' | 'conflict' | 'failed' | 'saved';
export const processingConsentPath = (patientId: string, documentId: string) =>
  `/api/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(documentId)}/processing-consent`;

export const consentContextKey = (path: string, c: ProcessingConsentContext) =>
  JSON.stringify([
    path,
    c.sourceSha256,
    c.sourceRevision,
    c.lifecycleVersion,
    c.revision,
  ]);

/** The owner-only GET remains authoritative; the listing hint only offers entry. */
export function useProcessingConsent(
  patientId: string,
  documentId: string,
  enabled: boolean,
) {
  const path = processingConsentPath(patientId, documentId);
  const [result, setResult] = useState<ProcessingConsentResult | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed' | 'denied'>(
    'loading',
  );
  const [writeState, setWriteState] = useState<ConsentWriteState>('idle');
  const [attempt, setAttempt] = useState(0);
  const allowed = useRef(enabled);
  allowed.current = enabled;
  const read = useRef<AbortController | null>(null);
  const writer = useRef<AbortController | null>(null);
  const operation = useRef<{
    body: string;
    revision: number;
    key: string;
  } | null>(null);
  const pending = useRef(false);

  function deny() {
    read.current?.abort();
    writer.current?.abort();
    operation.current = null;
    setResult(null);
    setPhase('denied');
    setWriteState('idle');
  }

  useEffect(() => {
    // A focus refresh suspends patient authorization. Retain the exact captured
    // request, but do not expose data or submit again until the GET revalidates.
    if (pending.current) setWriteState('uncertain');
    writer.current?.abort();
    if (!enabled) return;
    const abort = new AbortController();
    read.current = abort;
    setPhase('loading');
    const deadline = window.setTimeout(() => {
      if (!abort.signal.aborted) {
        setPhase('failed');
        abort.abort();
      }
    }, 20_000);
    void (async () => {
      const response = await fetch(path, {
        signal: abort.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(response.status)) {
        operation.current = null;
        setResult(null);
        setPhase('denied');
        setWriteState('idle');
        return;
      }
      if (!response.ok) throw Error();
      const value = await readClinicalJson(response, abort.signal);
      abort.signal.throwIfAborted();
      if (!isProcessingConsentResult(value)) throw Error();
      if (read.current === abort && allowed.current) {
        const key = consentContextKey(path, value.context);
        if (operation.current && operation.current.key !== key) {
          operation.current = null;
          setWriteState('conflict');
        } else if (!operation.current) {
          setWriteState((previous) =>
            previous === 'saved' && value.snapshot?.action === 'withdrawal'
              ? 'saved'
              : 'idle',
          );
        }
        setResult(value);
        setPhase('ready');
      }
    })()
      .catch(() => {
        if (!abort.signal.aborted && read.current === abort) setPhase('failed');
      })
      .finally(() => window.clearTimeout(deadline));
    return () => {
      window.clearTimeout(deadline);
      abort.abort();
      writer.current?.abort();
    };
  }, [path, enabled, attempt]);

  const reload = () => {
    if (pending.current) return;
    operation.current = null;
    setWriteState('idle');
    setAttempt((n) => n + 1);
  };
  const retryRead = () => setAttempt((n) => n + 1);
  const withdraw = async () => {
    if (
      !allowed.current ||
      phase !== 'ready' ||
      !result ||
      pending.current ||
      !['idle', 'uncertain'].includes(writeState)
    )
      return;
    if (!operation.current) {
      if (result.snapshot?.action !== 'grant') return;
      const request: WithdrawProcessingConsent = {
        requestId: crypto.randomUUID(),
        expectedRevision: result.context.revision,
      };
      operation.current = {
        body: JSON.stringify(request),
        revision: request.expectedRevision,
        key: consentContextKey(path, result.context),
      };
    }
    const captured = operation.current;
    const abort = new AbortController();
    writer.current = abort;
    pending.current = true;
    setWriteState('pending');
    let timedOut = false;
    const deadline = window.setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, 20_000);
    try {
      const boot = await fetch('/api/auth/bootstrap', {
        signal: abort.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(boot.status)) {
        deny();
        return;
      }
      if (!boot.ok) throw Error();
      const csrf = await readClinicalJson(boot, abort.signal);
      if (
        !csrf ||
        typeof csrf !== 'object' ||
        !('enabled' in csrf) ||
        csrf.enabled !== true ||
        !('csrf' in csrf) ||
        typeof csrf.csrf !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(csrf.csrf)
      )
        throw Error();
      abort.signal.throwIfAborted();
      const response = await fetch(`${path}/withdraw`, {
        method: 'POST',
        signal: abort.signal,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf.csrf,
        },
        body: captured.body,
      });
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(response.status)) {
        deny();
        return;
      }
      if (response.status === 409) {
        setWriteState('conflict');
        return;
      }
      if (response.status >= 500) throw Error();
      if (!response.ok) {
        setWriteState('failed');
        return;
      }
      const value = await readClinicalJson(response, abort.signal);
      abort.signal.throwIfAborted();
      if (
        !isSaveExtractionResult(value) ||
        value.revision !== captured.revision + 1
      )
        throw Error();
      if (allowed.current && writer.current === abort) {
        operation.current = null;
        setWriteState('saved');
        setAttempt((n) => n + 1);
      }
    } catch {
      if (
        writer.current === abort &&
        allowed.current &&
        (!abort.signal.aborted || timedOut)
      )
        setWriteState('uncertain');
    } finally {
      window.clearTimeout(deadline);
      if (writer.current === abort) pending.current = false;
    }
  };
  return { result, phase, writeState, withdraw, reload, retryRead, deny };
}
