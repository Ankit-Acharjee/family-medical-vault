import { useEffect, useRef, useState } from 'react';
import {
  isMetadataSuggestionsReadResult,
  isSaveMetadataSuggestions,
  isSaveMetadataSuggestionsResult,
  metadataSuggestionRuleVersion,
} from '@fmv/contracts';
import type {
  MetadataSuggestionsReadResult,
  MetadataSuggestion,
  SavedExtraction,
} from '@fmv/contracts';
import { MetadataCandidateList } from './MetadataCandidateList';
import { Button } from '../../components/ui/button';

const maximumMetadataBytes = 32 * 1024;
const metadataPath = (patientId: string, documentId: string) =>
  `/api/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(documentId)}/metadata-suggestions`;

async function readMetadataJson(response: Response, signal: AbortSignal) {
  if (Number(response.headers.get('content-length')) > maximumMetadataBytes) {
    void response.body?.cancel();
    throw new Error();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximumMetadataBytes) {
        void reader.cancel();
        throw new Error();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  ) as unknown;
}

type ReadState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'conflict' }
  | {
      kind: 'ready';
      value: MetadataSuggestionsReadResult;
      body: string | null;
    };
type SaveState =
  | { kind: 'idle' | 'pending' | 'uncertain' | 'conflict' | 'failed' }
  | { kind: 'saved'; revision: number };

export function SavedMetadataPanel({
  patientId,
  documentId,
  snapshot,
  onDenied,
  onReloadSource,
  onShowSource,
}: {
  patientId: string;
  documentId: string;
  snapshot: SavedExtraction;
  onDenied: () => void;
  onReloadSource: () => void;
  onShowSource: (suggestion: MetadataSuggestion) => void;
}) {
  const path = metadataPath(patientId, documentId);
  const sourceRevision = snapshot.revision;
  const sourceSha256 = snapshot.sourceSha256;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ReadState>({ kind: 'loading' });
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const saveController = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const denied = useRef(onDenied);
  denied.current = onDenied;

  useEffect(() => {
    const abort = new AbortController();
    setState({ kind: 'loading' });
    setSaveState({ kind: 'idle' });
    const deadline = window.setTimeout(() => {
      if (!abort.signal.aborted) {
        setState({ kind: 'failed' });
        abort.abort();
      }
    }, 20_000);
    const run = async () => {
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
      if (!response.ok) throw new Error();
      const value = await readMetadataJson(response, abort.signal);
      abort.signal.throwIfAborted();
      if (!isMetadataSuggestionsReadResult(value)) throw new Error();
      if (
        value.context.sourceRevision !== sourceRevision ||
        value.context.sourceSha256 !== sourceSha256 ||
        (value.snapshot &&
          (value.snapshot.sourceRevision !== sourceRevision ||
            value.snapshot.sourceSha256 !== sourceSha256))
      ) {
        setState({ kind: 'conflict' });
        return;
      }
      let body: string | null = null;
      if (value.context.canSave) {
        const payload = {
          requestId: crypto.randomUUID(),
          expectedRevision: value.context.revision,
          sourceRevision,
          sourceSha256,
          lifecycleVersion: value.context.lifecycleVersion,
          ruleVersion: metadataSuggestionRuleVersion,
        };
        if (isSaveMetadataSuggestions(payload)) body = JSON.stringify(payload);
      }
      if (!abort.signal.aborted) setState({ kind: 'ready', value, body });
    };
    void run()
      .catch(() => {
        if (!abort.signal.aborted) setState({ kind: 'failed' });
      })
      .finally(() => window.clearTimeout(deadline));
    return () => {
      window.clearTimeout(deadline);
      abort.abort();
      saveController.current?.abort();
    };
  }, [path, sourceRevision, sourceSha256, attempt]);

  const save = async () => {
    if (
      state.kind !== 'ready' ||
      !state.body ||
      pending.current ||
      !['idle', 'uncertain'].includes(saveState.kind)
    )
      return;
    const body = state.body;
    const abort = new AbortController();
    saveController.current = abort;
    pending.current = true;
    setSaveState({ kind: 'pending' });
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
        denied.current();
        return;
      }
      if (!bootResponse.ok) throw new Error();
      const boot = await readMetadataJson(bootResponse, abort.signal);
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
        body,
      });
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(response.status)) {
        denied.current();
        return;
      }
      if (response.status === 409) {
        setSaveState({ kind: 'conflict' });
        return;
      }
      if (response.status >= 500) throw new Error();
      if (!response.ok) {
        setSaveState({ kind: 'failed' });
        return;
      }
      const value = await readMetadataJson(response, abort.signal);
      if (!isSaveMetadataSuggestionsResult(value)) throw new Error();
      if (!abort.signal.aborted) {
        setSaveState({ kind: 'saved', revision: value.revision });
        heading.current?.focus();
      }
    } catch {
      if (!abort.signal.aborted || timedOut)
        setSaveState({ kind: 'uncertain' });
    } finally {
      window.clearTimeout(deadline);
      pending.current = false;
    }
  };

  const heading = useRef<HTMLHeadingElement | null>(null);
  const reload = () => {
    heading.current?.focus();
    setAttempt((value) => value + 1);
  };
  const content = (() => {
    if (state.kind === 'loading')
      return (
        <p role="status" className="text-sm text-muted-foreground">
          Loading saved suggestions…
        </p>
      );
    if (state.kind === 'failed')
      return (
        <div className="flex flex-col items-start gap-2">
          <p role="status" className="text-sm text-muted-foreground">
            Saved suggestions could not be loaded. Local suggestions and source
            text remain available.
          </p>
          <Button variant="secondary" onClick={reload}>
            Retry saved suggestions
          </Button>
        </div>
      );
    if (state.kind === 'conflict' || saveState.kind === 'conflict')
      return (
        <div className="flex flex-col items-start gap-2">
          <p role="status" className="text-sm text-muted-foreground">
            The document, saved text or suggestions changed. Reload saved text
            before saving suggestions.
          </p>
          <Button variant="secondary" onClick={onReloadSource}>
            Reload saved text
          </Button>
        </div>
      );

    const saved = state.value.snapshot;
    return (
      <div className="flex min-w-0 flex-col items-start gap-3">
        {saveState.kind === 'saved' ? (
          <>
            <p role="status" className="text-sm text-muted-foreground">
              Unverified suggestions saved as revision {saveState.revision}. No
              document fields were applied or verified.
            </p>
            <Button disabled>Suggestions saved</Button>
            <Button variant="secondary" onClick={reload}>
              Reload suggestions
            </Button>
          </>
        ) : (
          <>
            <p className="break-words text-sm text-muted-foreground">
              {saved
                ? `${saved.suggestions.length} unverified suggestions saved · Revision ${saved.revision} · ${new Date(saved.savedAt).toLocaleString()} · Rule version ${saved.ruleVersion}`
                : 'No suggestions have been saved for this text.'}
            </p>
            {saved && (
              <MetadataCandidateList
                suggestions={saved.suggestions}
                onShowSource={onShowSource}
              />
            )}
            <p className="text-sm text-muted-foreground">
              Saved suggestions refer to saved text revision {sourceRevision}.
              Saving keeps a separate unverified snapshot; it does not apply
              document fields.
            </p>
            {saveState.kind === 'uncertain' && (
              <p role="status" className="text-sm text-muted-foreground">
                Save could not be confirmed. Retry save to confirm the same
                request.
              </p>
            )}
            {saveState.kind === 'failed' && (
              <>
                <p role="status" className="text-sm text-muted-foreground">
                  Suggestions could not be saved. Reload suggestions before
                  trying again.
                </p>
                <Button variant="secondary" onClick={reload}>
                  Reload suggestions
                </Button>
              </>
            )}
            {!state.value.context.canSave ? (
              <p className="text-sm text-muted-foreground">
                Saving suggestions requires edit and view access.
              </p>
            ) : (
              <Button
                disabled={
                  !state.body || !['idle', 'uncertain'].includes(saveState.kind)
                }
                onClick={() => void save()}
              >
                {saveState.kind === 'pending'
                  ? 'Saving suggestions…'
                  : saveState.kind === 'uncertain'
                    ? 'Retry save suggestions'
                    : 'Save suggestions'}
              </Button>
            )}
          </>
        )}
      </div>
    );
  })();
  return (
    <section
      aria-label="Saved metadata"
      className="min-w-0 space-y-3 border-t border-border pt-3"
    >
      <h3
        ref={heading}
        tabIndex={-1}
        className="text-sm font-medium text-foreground"
      >
        Saved suggestions · Unverified
      </h3>
      {content}
    </section>
  );
}
