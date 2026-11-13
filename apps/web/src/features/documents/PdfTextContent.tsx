import { Button } from '../../components/ui/button';
import type { PdfTextState } from './pdfText';

export interface PdfTextContentProps {
  state: PdfTextState;
  onRetry: () => void;
  onCancel: () => void;
}

const FAILURE_COPY: Record<
  'size' | 'encrypted' | 'timeout' | 'invalid' | 'unsupported',
  string
> = {
  size: 'This file exceeds the extraction size limit. Try a smaller document.',
  encrypted: 'Password-protected files are not supported in this text view.',
  timeout: 'Extraction timed out. Retry, or try a shorter document.',
  invalid: 'This file could not be read as a PDF. Check the file and retry.',
  unsupported:
    'This PDF format is not supported here. Retry with a standard PDF.',
};

export function PdfTextContent({
  state,
  onRetry,
  onCancel,
}: PdfTextContentProps) {
  return (
    <section aria-label="Extracted text" className="min-w-0">
      {state.kind === 'loading' && (
        <div
          role="status"
          aria-live="polite"
          className="border-border bg-muted text-muted-foreground rounded-xl border px-4 py-3"
        >
          <p>Extracting text…</p>
          <Button
            type="button"
            onClick={onCancel}
            variant="secondary"
            className="mt-3"
          >
            Cancel extraction
          </Button>
        </div>
      )}

      {state.kind === 'ready' && (
        <div className="min-w-0">
          <p role="status" className="text-muted-foreground mb-2 text-sm">
            Unverified output — source text only, may contain errors. Not
            medical advice.
          </p>
          <div className="max-h-[50vh] overflow-y-auto rounded-xl border-border bg-muted px-4 py-3">
            {state.pages.map(({ page, text }) => (
              <div key={page} className="min-w-0">
                <h3 className="text-foreground text-sm font-semibold">
                  Page {page}
                </h3>
                <p className="text-foreground/90 mt-1 mb-4 min-w-0 whitespace-pre-wrap break-words">
                  {text || 'No embedded text on this page.'}
                </p>
              </div>
            ))}
          </div>
          {state.partial && (
            <p className="text-muted-foreground mt-2 text-sm">
              Partial result — limited by{' '}
              {state.reason === 'characters' ? 'character cap' : 'page cap'}.
              Not the complete document.
            </p>
          )}
        </div>
      )}

      {state.kind === 'empty' && (
        <div className="border-border bg-muted text-muted-foreground rounded-xl border px-4 py-3">
          <p>
            No embedded text found. For scanned or image-only pages, close this
            view and choose Recognize text (OCR) on the document.
          </p>
          <Button type="button" onClick={onRetry} className="mt-3">
            Retry extraction
          </Button>
        </div>
      )}

      {state.kind === 'failed' && (
        <div className="border-border bg-muted rounded-xl border px-4 py-3">
          <p className="text-foreground">
            Extraction failed: {FAILURE_COPY[state.reason]}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            The original document is unchanged and remains available
            independently.
          </p>
          <Button type="button" onClick={onRetry} className="mt-3">
            Retry extraction
          </Button>
        </div>
      )}
    </section>
  );
}
