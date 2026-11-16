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
import { SaveExtractionPanel } from './SaveExtractionPanel';
import {
  createSaveExtractionAttempt,
  readExtractionContext,
  extractionPath,
} from './savedExtraction';
import type { SaveExtractionAttempt } from './savedExtraction';
import { extractionEngineVersions } from '@fmv/contracts';
import type { OcrState, OcrProgress } from './ocrTypes';
import type { PdfTextState } from './pdfText';
import type { PdfOcrRangeResult } from './pdfOcrTypes';

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
  onSaved,
  restoreFocus,
}: {
  source: DocumentTextSource;
  enabled: boolean;
  onClose: () => void;
  onDenied: () => void;
  onSaved?: () => void;
  restoreFocus: () => void;
}) {
  const imageOcr = source.kind === 'ocr';
  const pdfOcr = source.kind === 'ocr' && source.mime === 'application/pdf';
  const [pageNumber, setPageNumber] = useState('1');
  const [range, setRange] = useState(false);
  const [endPage, setEndPage] = useState('2');
  const [rangeProgress, setRangeProgress] = useState<{
    page: number;
    count: number;
    completed: number;
  } | null>(null);
  const pageValid =
    /^\d+$/.test(pageNumber) &&
    Number(pageNumber) >= 1 &&
    Number(pageNumber) <= 50 &&
    (!range ||
      (/^\d+$/.test(endPage) &&
        Number(endPage) <= 50 &&
        Number(endPage) >= Number(pageNumber) &&
        Number(endPage) - Number(pageNumber) < 5));
  type State =
    | { mode: 'pdf'; value: PdfTextState }
    | { mode: 'ocr'; value: OcrState }
    | {
        mode: 'range';
        value: PdfOcrRangeResult | Extract<OcrState, { kind: 'loading' }>;
      };
  const [state, setState] = useState<State | null>(
    imageOcr ? { mode: 'ocr', value: { kind: 'idle' } } : null,
  );
  const [attempt, setAttempt] = useState(imageOcr ? 0 : 1);
  const [persistence, setPersistence] = useState<{
    attempt: SaveExtractionAttempt | null;
    canSave: boolean | null;
  } | null>(null);
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
      setPersistence(null);
    }
  }, [enabled]);
  useEffect(() => {
    if (!allowed.current || attempt === 0) return;
    const abort = new AbortController();
    setPersistence(null);
    setRangeProgress(
      range && pdfOcr
        ? {
            page: Number(pageNumber),
            count: Number(endPage) - Number(pageNumber) + 1,
            completed: 0,
          }
        : null,
    );
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
            mode: range && pdfOcr ? 'range' : 'ocr',
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
      const context = await readExtractionContext(
        extractionPath(source.patientId, source.documentId),
        abort.signal,
      );
      abort.signal.throwIfAborted();
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
        if (source.mime === 'application/pdf' && range) {
          const result = await (
            await import('./pdfOcr')
          ).recognizePdfPages(
            bytes,
            Number(pageNumber),
            Number(endPage),
            abort.signal,
            (page, count, stage) => {
              if (
                !abort.signal.aborted &&
                allowed.current &&
                controller.current === abort
              ) {
                setRangeProgress({
                  page,
                  count,
                  completed: page - Number(pageNumber),
                });
                setState({
                  mode: 'range',
                  value: { kind: 'loading', stage, progress: 0 },
                });
              }
            },
          );
          if (
            !abort.signal.aborted &&
            allowed.current &&
            controller.current === abort
          ) {
            if (result.kind === 'ready')
              setPersistence({
                canSave: context?.canSave ?? null,
                attempt: createSaveExtractionAttempt(context, {
                  method: 'pdf-pages-ocr',
                  engineVersion: extractionEngineVersions['pdf-pages-ocr'],
                  pages: result.pages,
                  partial: true,
                  partialReason: result.partialReason,
                  downsized: result.downsized,
                }),
              });
            setState({ mode: 'range', value: result });
          }
          return;
        }
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
        ) {
          if (result.kind === 'ready') {
            const method =
              source.mime === 'application/pdf' ? 'pdf-page-ocr' : 'image-ocr';
            setPersistence({
              canSave: context?.canSave ?? null,
              attempt: createSaveExtractionAttempt(context, {
                method,
                engineVersion: extractionEngineVersions[method],
                pages: [
                  {
                    page:
                      source.mime === 'application/pdf'
                        ? Number(pageNumber)
                        : 1,
                    text: result.text,
                  },
                ],
                partial: result.partial || method === 'pdf-page-ocr',
                partialReason: result.partial
                  ? 'characters'
                  : method === 'pdf-page-ocr'
                    ? 'selected-page'
                    : null,
                downsized: result.downsized,
              }),
            });
          }
          setState({ mode: 'ocr', value: result });
        }
      } else {
        const { extractPdfText } = await import('./pdfText');
        abort.signal.throwIfAborted();
        const result = await extractPdfText(bytes, abort.signal);
        if (
          !abort.signal.aborted &&
          allowed.current &&
          controller.current === abort
        ) {
          if (result.kind === 'ready')
            setPersistence({
              canSave: context?.canSave ?? null,
              attempt: createSaveExtractionAttempt(context, {
                method: 'pdf-text',
                engineVersion: extractionEngineVersions['pdf-text'],
                pages: result.pages,
                partial: result.partial,
                partialReason: result.reason ?? null,
                downsized: false,
              }),
            });
          setState({ mode: 'pdf', value: result });
        }
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
  }, [source, attempt, onDenied, imageOcr, pdfOcr, pageNumber, range, endPage]);
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
            range={range}
            end={endPage}
            onRangeChange={(value) => {
              controller.current?.abort();
              setRange(value);
              setAttempt(0);
              setPersistence(null);
              setState({ mode: 'ocr', value: { kind: 'idle' } });
            }}
            onEndChange={(value) => {
              controller.current?.abort();
              setEndPage(value);
              setAttempt(0);
              setPersistence(null);
              setState({ mode: 'ocr', value: { kind: 'idle' } });
            }}
            onChange={(value) => {
              controller.current?.abort();
              setPageNumber(value);
              setAttempt(0);
              setPersistence(null);
              setState({ mode: 'ocr', value: { kind: 'idle' } });
            }}
            disabled={!enabled || state?.value.kind === 'loading'}
            error={
              pageValid
                ? undefined
                : range
                  ? 'Enter a valid range from 1 to 50, containing no more than 5 pages.'
                  : 'Enter a whole page number from 1 to 50.'
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
        ) : state.mode === 'range' ? (
          <OcrTextContent
            state={state.value}
            enabled={enabled && pageValid}
            rangeProgress={rangeProgress}
            onStart={retry}
            onCancel={onClose}
          />
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
        {enabled && state?.value.kind === 'ready' && (
          <>
            {state.mode === 'range' && (
              <p className="text-sm text-muted-foreground">
                Saving replaces the latest saved text with text from the
                selected page range, not the whole file.
              </p>
            )}
            <SaveExtractionPanel
              path={extractionPath(source.patientId, source.documentId)}
              attempt={persistence?.attempt ?? null}
              canSave={persistence?.canSave ?? null}
              onDenied={onDenied}
              onSaved={onSaved}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
