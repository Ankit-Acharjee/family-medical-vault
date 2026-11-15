import { useEffect, useId, useRef, useState } from 'react';
import type { DocumentMimeType } from '@fmv/contracts';
import { PdfOriginalPage } from './PdfOriginalPage';
import { Button } from '../../components/ui/button';
import { OriginalPreviewError, readOriginalPreview } from './originalPreview';
type OriginalSource = {
  patientId: string;
  documentId: string;
  title: string;
  bytes: number;
  mime: DocumentMimeType;
  sha256: string;
};
function OriginalContent({
  source,
  onDenied,
  onReloadSource,
}: {
  source: OriginalSource;
  onDenied: () => void;
  onReloadSource: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    'loading' | 'failed' | 'mismatch' | { blob: Blob; url?: string }
  >('loading');
  const denied = useRef(onDenied);
  denied.current = onDenied;
  const { patientId, documentId, bytes, mime, sha256 } = source;
  useEffect(() => {
    const abort = new AbortController();
    let url: string | null = null,
      expired = false;
    setState('loading');
    const deadline = window.setTimeout(() => {
      expired = true;
      abort.abort();
    }, 20000);
    void (async () => {
      const response = await fetch(
        `/api/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(documentId)}/preview`,
        { signal: abort.signal, credentials: 'same-origin', cache: 'no-store' },
      );
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(response.status)) {
        denied.current();
        return;
      }
      const blob = await readOriginalPreview(
        response,
        { bytes, mime, sha256 },
        abort.signal,
      );
      abort.signal.throwIfAborted();
      if (mime === 'application/pdf') setState({ blob });
      else {
        url = URL.createObjectURL(blob);
        setState({ blob, url });
      }
    })()
      .catch((error) => {
        if (!abort.signal.aborted || expired)
          setState(
            error instanceof OriginalPreviewError && error.reason === 'mismatch'
              ? 'mismatch'
              : 'failed',
          );
      })
      .finally(() => window.clearTimeout(deadline));
    return () => {
      abort.abort();
      window.clearTimeout(deadline);
      if (url) URL.revokeObjectURL(url);
    };
  }, [patientId, documentId, bytes, mime, sha256, attempt]);
  return (
    <div className="min-w-0 space-y-3">
      {state === 'loading' ? (
        <p role="status" className="text-sm">
          Loading original for comparison…
        </p>
      ) : typeof state === 'object' ? (
        <>
          <p className="text-sm text-muted-foreground">
            Original source matches this saved text's file. Compare the values
            manually.
          </p>
          {source.mime === 'application/pdf' ? (
            <PdfOriginalPage blob={state.blob} title={source.title} />
          ) : (
            <img
              className="max-h-96 w-full rounded-lg object-contain"
              src={state.url}
              alt={`Original for comparison: ${source.title}`}
            />
          )}
        </>
      ) : (
        <>
          <p role="status" className="text-sm text-muted-foreground">
            {state === 'mismatch'
              ? 'The original does not match this saved source. Reload saved text before comparing.'
              : 'Original comparison could not be loaded. The current review and saved text remain available.'}
          </p>
          {state === 'mismatch' && (
            <Button variant="secondary" onClick={onReloadSource}>
              Reload saved source
            </Button>
          )}
          {state !== 'mismatch' && (
            <Button
              variant="secondary"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Retry original comparison
            </Button>
          )}
        </>
      )}
    </div>
  );
}
export function OriginalComparison({
  source,
  onDenied,
  onReloadSource,
}: {
  source: OriginalSource;
  onDenied: () => void;
  onReloadSource: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section
      aria-label="Original source comparison"
      className="min-w-0 space-y-3 rounded-xl border border-border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Compare with the original</h3>
        <Button
          variant="secondary"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Hide original' : 'Compare original'}
        </Button>
      </div>
      {!open && (
        <p className="text-sm text-muted-foreground">
          View the original without clearing your review corrections or
          selection.
        </p>
      )}
      {open && (
        <div id={id} className="min-w-0 space-y-3">
          <OriginalContent
            source={source}
            onDenied={onDenied}
            onReloadSource={onReloadSource}
          />
        </div>
      )}
    </section>
  );
}
