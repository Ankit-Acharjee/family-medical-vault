import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../components/ui/button';
export function PdfOriginalPage({
  blob,
  title,
}: {
  blob: Blob;
  title: string;
}) {
  const [zoomed, setZoomed] = useState(false);
  const [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    'loading' | 'failed' | { url: string; pages: number; page: number }
  >('loading');
  const pages = useRef(1);
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
      const bytes = new Uint8Array(await blob.arrayBuffer());
      abort.signal.throwIfAborted();
      const { renderPdfPagePreview } = await import('./pdfOcr');
      abort.signal.throwIfAborted();
      const result = await renderPdfPagePreview(bytes, page, abort.signal);
      abort.signal.throwIfAborted();
      if (result.kind !== 'preview') throw Error('Unsupported PDF page');
      url = URL.createObjectURL(result.blob);
      pages.current = result.pages;
      setState({ url, pages: result.pages, page });
    })()
      .catch(() => {
        if (!abort.signal.aborted || expired) setState('failed');
      })
      .finally(() => window.clearTimeout(deadline));
    return () => {
      abort.abort();
      window.clearTimeout(deadline);
      if (url) URL.revokeObjectURL(url);
    };
  }, [blob, page, attempt]);
  const ready = typeof state === 'object' && state.page === page;
  return (
    <section aria-label="Original PDF pages" className="min-w-0 space-y-3">
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Original PDF page navigation"
      >
        <Button
          variant="secondary"
          size="icon"
          aria-label="Previous PDF page"
          disabled={!ready || page <= 1}
          onClick={() => setPage((n) => n - 1)}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
        <select
          aria-label="Original PDF page"
          className="min-h-11 min-w-0 rounded-lg border border-input bg-background px-2 text-sm"
          disabled={!ready}
          value={page}
          onChange={(e) => setPage(Number(e.target.value))}
        >
          {Array.from({ length: Math.min(pages.current, 50) }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              Page {i + 1} of {pages.current}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          size="icon"
          aria-label="Next PDF page"
          disabled={!ready || page >= Math.min(pages.current, 50)}
          onClick={() => setPage((n) => n + 1)}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="secondary"
          disabled={!ready}
          aria-pressed={zoomed}
          onClick={() => setZoomed((v) => !v)}
        >
          {zoomed ? 'Fit page' : 'Zoom page'}
        </Button>
      </div>
      {state === 'loading' ||
      (typeof state === 'object' && state.page !== page) ? (
        <p role="status" className="text-sm">
          Rendering original PDF page…
        </p>
      ) : state === 'failed' ? (
        <>
          <p role="status" className="text-sm text-muted-foreground">
            This PDF page could not be rendered here. The source file and review
            remain available.
          </p>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            Retry PDF page
          </Button>
        </>
      ) : (
        <>
          <div
            role="region"
            aria-label="Original PDF page view"
            tabIndex={0}
            className="max-h-[32rem] overflow-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-ring"
          >
            <img
              className={
                zoomed ? 'max-w-none' : 'max-h-[32rem] w-full object-contain'
              }
              src={state.url}
              alt={`Original PDF page ${page}: ${title}`}
            />
          </div>
          {state.pages > 50 && (
            <p className="text-sm text-muted-foreground">
              Comparison is limited to the first 50 pages of this document.
            </p>
          )}
        </>
      )}
    </section>
  );
}
