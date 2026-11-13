import { useEffect, useRef, useState } from 'react';
import {
  isExtractionReadResult,
  maximumExtractionRequestBytes,
} from '@fmv/contracts';
import type { ExtractionReadResult } from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { PdfTextContent } from './PdfTextContent';
import { extractionPath } from './savedExtraction';
export type SavedTextSource = {
  kind: 'saved';
  patientId: string;
  documentId: string;
  title: string;
  bytes: number;
};

export function SavedExtractionDialog({
  source,
  enabled,
  onClose,
  onDenied,
  restoreFocus,
}: {
  source: SavedTextSource;
  enabled: boolean;
  onClose: () => void;
  onDenied: () => void;
  restoreFocus: () => void;
}) {
  const [attempt, setAttempt] = useState(1);
  const [state, setState] = useState<
    ExtractionReadResult | 'loading' | 'failed' | null
  >('loading');
  const controller = useRef<AbortController | null>(null);
  const title = useRef<HTMLHeadingElement | null>(null);
  const allowed = useRef(enabled);
  allowed.current = enabled;
  useEffect(() => {
    if (!enabled) {
      controller.current?.abort();
      setState(null);
    }
  }, [enabled]);
  useEffect(() => {
    if (!allowed.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setState('loading');
    const deadline = window.setTimeout(() => {
      if (!abort.signal.aborted && allowed.current) {
        setState('failed');
        abort.abort();
      }
    }, 20_000);
    const run = async () => {
      const response = await fetch(
        extractionPath(source.patientId, source.documentId),
        { signal: abort.signal, credentials: 'same-origin', cache: 'no-store' },
      );
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(response.status)) {
        if (allowed.current) onDenied();
        return;
      }
      if (
        !response.ok ||
        Number(response.headers.get('content-length')) >
          maximumExtractionRequestBytes
      )
        throw new Error();
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          abort.signal.throwIfAborted();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > maximumExtractionRequestBytes) {
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
      const value: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
      if (!isExtractionReadResult(value)) throw new Error();
      if (
        !abort.signal.aborted &&
        allowed.current &&
        controller.current === abort
      )
        setState(value);
    };
    void run()
      .catch(() => {
        if (
          !abort.signal.aborted &&
          allowed.current &&
          controller.current === abort
        )
          setState('failed');
      })
      .finally(() => window.clearTimeout(deadline));
    return () => {
      window.clearTimeout(deadline);
      abort.abort();
    };
  }, [source, attempt, onDenied]);
  const retry = () => {
    title.current?.focus();
    setAttempt((n) => n + 1);
  };
  const snapshot =
    enabled && state && typeof state === 'object' ? state.snapshot : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-w-3xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          title.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          restoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle ref={title} tabIndex={-1}>
            Saved text
          </DialogTitle>
          <DialogDescription className="break-words">
            {source.title}
          </DialogDescription>
        </DialogHeader>
        {!enabled || state === null ? (
          <div className="space-y-3">
            <p role="status" className="text-sm text-muted-foreground">
              Saved text cleared while access is checked. Retry to read it
              again.
            </p>
            <Button disabled={!enabled} onClick={retry}>
              Retry saved text
            </Button>
          </div>
        ) : state === 'loading' ? (
          <p role="status">Loading saved text…</p>
        ) : state === 'failed' ? (
          <div className="space-y-3">
            <p role="status">
              Saved text could not be loaded. The original is still available
              independently.
            </p>
            <Button onClick={retry}>Retry saved text</Button>
          </div>
        ) : !snapshot ? (
          <p role="status" className="text-sm text-muted-foreground">
            No text has been saved for this document. Extract text or run OCR,
            then save the result if you have edit and view access.
          </p>
        ) : (
          <div className="min-w-0 space-y-3">
            <p className="text-sm text-muted-foreground">
              Unverified browser-submitted text · Saved{' '}
              {new Date(snapshot.savedAt).toLocaleString()}
            </p>
            {snapshot.method === 'pdf-page-ocr' && (
              <p className="text-sm text-muted-foreground">
                Only the selected page was recognized; other pages were not
                processed.
              </p>
            )}
            {snapshot.method !== 'pdf-text' && (
              <p className="text-sm text-muted-foreground">
                Printed English OCR may be inaccurate, especially for
                handwriting or other languages.
                {snapshot.downsized ? ' The source was downsized.' : ''}
              </p>
            )}
            <PdfTextContent
              state={{
                kind: 'ready',
                pages: snapshot.pages,
                partial:
                  snapshot.partialReason === 'pages' ||
                  snapshot.partialReason === 'characters',
                ...(snapshot.partialReason === 'pages' ||
                snapshot.partialReason === 'characters'
                  ? { reason: snapshot.partialReason }
                  : {}),
              }}
              onRetry={retry}
              onCancel={onClose}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
