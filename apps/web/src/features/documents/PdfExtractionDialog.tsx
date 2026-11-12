import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { PdfTextContent } from './PdfTextContent';
import type { PdfTextState } from './pdfText';

export type PdfSource = {
  patientId: string;
  documentId: string;
  title: string;
  bytes: number;
};
const limit = 10 * 1024 * 1024;

export function PdfExtractionDialog({
  source,
  enabled,
  onClose,
  onDenied,
  restoreFocus,
}: {
  source: PdfSource;
  enabled: boolean;
  onClose: () => void;
  onDenied: () => void;
  restoreFocus: () => void;
}) {
  const [state, setState] = useState<PdfTextState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const title = useRef<HTMLHeadingElement | null>(null);
  const retry = () => {
    title.current?.focus();
    setAttempt((value) => value + 1);
  };
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
    setState({ kind: 'loading' });
    const deadline = window.setTimeout(() => {
      if (
        allowed.current &&
        controller.current === abort &&
        !abort.signal.aborted
      )
        setState({ kind: 'failed', reason: 'timeout' });
      abort.abort();
    }, 20_000);
    const run = async () => {
      if (source.bytes > limit) {
        setState({ kind: 'failed', reason: 'size' });
        return;
      }
      const response = await fetch(
        `/api/patients/${encodeURIComponent(source.patientId)}/documents/${encodeURIComponent(source.documentId)}/preview`,
        {
          signal: abort.signal,
          credentials: 'same-origin',
          cache: 'no-store',
        },
      );
      abort.signal.throwIfAborted();
      if ([401, 403, 404].includes(response.status)) {
        if (!abort.signal.aborted && allowed.current) onDenied();
        return;
      }
      if (!response.ok) throw new Error('Unavailable original');
      if (Number(response.headers.get('content-length')) > limit) {
        void response.body?.cancel();
        setState({ kind: 'failed', reason: 'size' });
        return;
      }
      // Bound the actual response even when length metadata is missing or incorrect.
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Unavailable original');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          abort.signal.throwIfAborted();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > limit) {
            await reader.cancel();
            setState({ kind: 'failed', reason: 'size' });
            return;
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      chunks.length = 0;
      const { extractPdfText } = await import('./pdfText');
      abort.signal.throwIfAborted();
      const result = await extractPdfText(bytes, abort.signal);
      if (!abort.signal.aborted && allowed.current) setState(result);
    };
    void run()
      .catch(() => {
        if (
          allowed.current &&
          controller.current === abort &&
          !abort.signal.aborted
        )
          setState({
            kind: 'failed',
            reason: 'invalid',
          });
      })
      .finally(() => window.clearTimeout(deadline));
    return () => {
      window.clearTimeout(deadline);
      abort.abort();
    };
    // Revalidation pauses and clears results; only explicit Retry starts again.
    // source is a stable document identity owned by the authorized list.
  }, [source, attempt, onDenied]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-w-3xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          title.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle ref={title} tabIndex={-1}>
            Extracted text
          </DialogTitle>
          <DialogDescription className="break-words">
            {source.title}
          </DialogDescription>
        </DialogHeader>
        {!enabled || !state ? (
          <div className="space-y-3">
            <p role="status">
              {enabled
                ? 'Text was cleared during access revalidation. Retry to extract it again.'
                : 'Text cleared while patient access is checked.'}
            </p>
            <Button disabled={!enabled} onClick={retry}>
              Retry extraction
            </Button>
          </div>
        ) : (
          <PdfTextContent state={state} onRetry={retry} onCancel={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}
