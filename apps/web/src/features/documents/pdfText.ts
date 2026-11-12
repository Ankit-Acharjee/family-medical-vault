import { getDocument, PDFWorker } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

export const extractionByteLimit = 10 * 1024 * 1024;
export type PdfTextState =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      pages: { page: number; text: string }[];
      partial: boolean;
      reason?: 'pages' | 'characters';
    }
  | { kind: 'empty' }
  | {
      kind: 'failed';
      reason: 'size' | 'encrypted' | 'timeout' | 'invalid' | 'unsupported';
    };

// Only publisher-supplied, locally bundled font/CMap assets may be fetched.
// Document annotations, links and scripts are never interpreted or rendered.
const assets = import.meta.glob(
  '../../../node_modules/pdfjs-dist/{cmaps/*.bcmap,standard_fonts/*.{pfb,ttf}}',
  {
    query: '?url&no-inline',
    import: 'default',
    eager: true,
  },
) as Record<string, string>;
class LocalBinaryDataFactory {
  constructor(private readonly options: { signal: AbortSignal }) {}
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const directory =
      kind === 'cMapUrl'
        ? 'cmaps'
        : kind === 'standardFontDataUrl'
          ? 'standard_fonts'
          : null;
    const key = `../../../node_modules/pdfjs-dist/${directory}/${filename}`;
    const asset = directory && assets[key];
    if (!asset || this.options.signal.aborted)
      throw new Error('Unsupported PDF asset');
    const url = new URL(asset, window.location.href);
    if (url.origin !== window.location.origin)
      throw new Error('Unsupported PDF asset');
    const response = await fetch(url, {
      signal: this.options.signal,
      credentials: 'omit',
    });
    if (!response.ok) throw new Error('Unavailable PDF asset');
    return new Uint8Array(await response.arrayBuffer());
  }
}

/** No original URLs, HTML rendering, scripting, external fetches or persistence. */
export async function extractPdfText(
  data: Uint8Array,
  signal: AbortSignal,
): Promise<PdfTextState> {
  if (data.byteLength > extractionByteLimit)
    return { kind: 'failed', reason: 'size' };
  signal.throwIfAborted();
  // Own the real worker so cancellation cannot fall back to main-thread parsing.
  const port = new Worker(workerUrl, { type: 'module' });
  let worker: PDFWorker | undefined;
  let task: ReturnType<typeof getDocument>;
  try {
    worker = new PDFWorker({
      // PDF.js 6.5.438's generated declaration incorrectly narrows port to null;
      // the published runtime explicitly accepts a browser Worker (worker_options).
      // @ts-expect-error upstream port declaration omits Worker
      port,
      verbosity: 0,
    });
    class BoundBinaryDataFactory extends LocalBinaryDataFactory {
      constructor() {
        super({ signal });
      }
    }
    task = getDocument({
      data,
      worker,
      verbosity: 0,
      BinaryDataFactory: BoundBinaryDataFactory,
      useWorkerFetch: false,
      useWasm: false,
      disableFontFace: true,
      useSystemFonts: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      disableWorkerRendering: true,
      enableXfa: false,
      stopAtErrors: true,
      disableAutoFetch: true,
      disableStream: true,
      disableRange: true,
    });
  } catch (error) {
    worker?.destroy();
    port.terminate();
    throw error;
  }
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => {
    rejectAbort(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
    port.terminate();
    void task.destroy().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  const run = async (): Promise<PdfTextState> => {
    const pdf = await task.promise;
    const pages: { page: number; text: string }[] = [];
    let remaining = 500_000;
    let limited = false;
    for (let number = 1; number <= Math.min(pdf.numPages, 50); number++) {
      signal.throwIfAborted();
      const page = await pdf.getPage(number);
      const reader = page.streamTextContent().getReader();
      let text = '';
      try {
        while (true) {
          const chunk = await reader.read();
          signal.throwIfAborted();
          if (chunk.done) break;
          for (const item of chunk.value.items) {
            if (!('str' in item)) continue;
            const value = item.str + (item.hasEOL ? '\n' : ' ');
            if (value.length > remaining) {
              text += value.slice(0, remaining);
              limited = true;
              break;
            }
            text += value;
            remaining -= value.length;
          }
          if (limited) {
            // An already-closed vendor stream may omit the cancellation reply.
            // Final cleanup terminates the owned worker without waiting for it.
            void reader
              .cancel(new Error('Extraction character limit reached'))
              .catch(() => {});
            break;
          }
        }
      } finally {
        reader.releaseLock();
        page.cleanup();
      }
      pages.push({ page: number, text: text.trim() });
      if (limited) break;
    }
    if (!limited && pdf.numPages <= 50 && !pages.some((page) => page.text))
      return { kind: 'empty' };
    return {
      kind: 'ready',
      pages,
      partial: limited || pdf.numPages > 50,
      ...(limited
        ? { reason: 'characters' as const }
        : pdf.numPages > 50
          ? { reason: 'pages' as const }
          : {}),
    };
  };
  try {
    return await Promise.race([run(), aborted]);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    return {
      kind: 'failed',
      reason:
        error instanceof Error && error.name === 'PasswordException'
          ? 'encrypted'
          : 'invalid',
    };
  } finally {
    signal.removeEventListener('abort', cancel);
    port.terminate();
    worker.destroy();
    void task.destroy().catch(() => {});
  }
}
