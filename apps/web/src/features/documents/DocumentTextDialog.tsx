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
import { OcrTextContent } from './OcrTextContent';
import { PdfOcrPageField } from './PdfOcrPageField';
import { ocrByteLimit } from './ocrTypes';
import type { OcrState, OcrProgress } from './ocrTypes';
import type { PdfTextState } from './pdfText';

export type DocumentTextSource = {
  patientId: string;
  documentId: string;
  title: string;
  bytes: number;
} & ({ kind: 'pdf' } | { kind: 'ocr'; mime: string });
const limit = ocrByteLimit;

export function DocumentTextDialog({
  source,
  enabled,
  onClose,
  onDenied,
  restoreFocus,
}: {
  source: DocumentTextSource;
  enabled: boolean;
  onClose: () => void;
  onDenied: () => void;
  restoreFocus: () => void;
}) {
  const imageOcr = source.kind === 'ocr';
  const pdfOcr = source.kind === 'ocr' && source.mime === 'application/pdf';
  const [pageNumber, setPageNumber] = useState('1');
  const pageValid =
    /^\d+$/.test(pageNumber) &&
    Number(pageNumber) >= 1 &&
    Number(pageNumber) <= 50;
  type State =
    { mode: 'pdf'; value: PdfTextState } | { mode: 'ocr'; value: OcrState };
  const [state, setState] = useState<State | null>(
    imageOcr ? { mode: 'ocr', value: { kind: 'idle' } } : null,
  );
  const [attempt, setAttempt] = useState(imageOcr ? 0 : 1);
  const controller = useRef<AbortController | null>(null);
  const title = useRef<HTMLHeadingElement | null>(null);
  const retry = () => {
    if (pdfOcr && !pageValid) return;
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
    if (!allowed.current || attempt === 0) return;
    const abort = new AbortController();
    controller.current = abort;
    const fail = (reason: 'size' | 'timeout' | 'invalid') =>
      setState(
        imageOcr
          ? { mode: 'ocr', value: { kind: 'failed', reason } }
          : { mode: 'pdf', value: { kind: 'failed', reason } },
      );
    setState(
      imageOcr
        ? {
            mode: 'ocr',
            value: { kind: 'loading', stage: 'loading', progress: 0 },
          }
        : { mode: 'pdf', value: { kind: 'loading' } },
    );
    const deadline = window.setTimeout(
      () => {
        if (
          allowed.current &&
          controller.current === abort &&
          !abort.signal.aborted
        )
          fail('timeout');
        abort.abort();
      },
      imageOcr ? 60_000 : 20_000,
    );
    const run = async () => {
      if (source.bytes > limit) {
        fail('size');
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
        fail('size');
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
            fail('size');
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
      if (source.kind === 'ocr') {
        const progress: OcrProgress = (stage, progress) => {
          if (
            !abort.signal.aborted &&
            allowed.current &&
            controller.current === abort
          )
            setState({
              mode: 'ocr',
              value: { kind: 'loading', stage, progress },
            });
        };
        const result =
          source.mime === 'application/pdf'
            ? await (
                await import('./pdfOcr')
              ).recognizePdfPage(
                bytes,
                Number(pageNumber),
                abort.signal,
                progress,
              )
            : await (
                await import('./imageOcr')
              ).recognizeImage(bytes, source.mime, abort.signal, progress);
        if (
          !abort.signal.aborted &&
          allowed.current &&
          controller.current === abort
        )
          setState({ mode: 'ocr', value: result });
      } else {
        const { extractPdfText } = await import('./pdfText');
        abort.signal.throwIfAborted();
        const result = await extractPdfText(bytes, abort.signal);
        if (
          !abort.signal.aborted &&
          allowed.current &&
          controller.current === abort
        )
          setState({ mode: 'pdf', value: result });
      }
    };
    void run()
      .catch(() => {
        if (
          allowed.current &&
          controller.current === abort &&
          !abort.signal.aborted
        )
          fail('invalid');
      })
      .finally(() => window.clearTimeout(deadline));
    return () => {
      window.clearTimeout(deadline);
      abort.abort();
    };
    // Revalidation pauses and clears results; only explicit Retry starts again.
    // source is a stable document identity owned by the authorized list.
  }, [source, attempt, onDenied, imageOcr, pageNumber]);
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
            {imageOcr ? 'Recognized text (OCR)' : 'Extracted text'}
          </DialogTitle>
          <DialogDescription className="break-words">
            {source.title}
          </DialogDescription>
        </DialogHeader>
        {pdfOcr && (
          <PdfOcrPageField
            value={pageNumber}
            onChange={(value) => {
              controller.current?.abort();
              setPageNumber(value);
              setAttempt(0);
              setState({ mode: 'ocr', value: { kind: 'idle' } });
            }}
            disabled={!enabled || state?.value.kind === 'loading'}
            error={
              pageValid ? undefined : 'Enter a whole page number from 1 to 50.'
            }
          />
        )}
        {!enabled || !state ? (
          <div className="space-y-3">
            <p role="status">
              {enabled
                ? 'Text was cleared during access revalidation. Retry to extract it again.'
                : 'Text cleared while patient access is checked.'}
            </p>
            <Button
              disabled={!enabled || (pdfOcr && !pageValid)}
              onClick={retry}
            >
              {imageOcr ? 'Start OCR' : 'Retry extraction'}
            </Button>
          </div>
        ) : state.mode === 'ocr' ? (
          <OcrTextContent
            state={state.value}
            enabled={enabled && (!pdfOcr || pageValid)}
            page={pdfOcr ? Number(pageNumber) : 1}
            onStart={retry}
            onCancel={onClose}
          />
        ) : (
          <PdfTextContent
            state={state.value}
            onRetry={retry}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
