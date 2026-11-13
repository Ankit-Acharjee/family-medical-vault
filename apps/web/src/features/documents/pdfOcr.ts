import {
  AnnotationMode,
  getDocument,
  GlobalWorkerOptions,
  PDFWorker,
  VerbosityLevel,
} from 'pdfjs-dist';
import type { RenderTask } from 'pdfjs-dist';
import rendererUrl from 'pdfjs-dist/build/pdf.renderer.mjs?url&no-inline';
import { recognizeImage } from './imageOcr';
import { ocrByteLimit } from './ocrTypes';
import type { OcrProgress, OcrState } from './ocrTypes';

// Publisher assets only. Keep embedded-text extraction's configuration separate.
const assets = import.meta.glob(
  '../../../node_modules/pdfjs-dist/{cmaps/*.bcmap,standard_fonts/*.{pfb,ttf}}',
  { query: '?url&no-inline', import: 'default', eager: true },
) as Record<string, string>;
let running = false;

/** The caller's 60-second signal includes original acquisition and this entire job. */
export async function recognizePdfPage(
  data: Uint8Array<ArrayBuffer>,
  pageNumber: number,
  signal: AbortSignal,
  progress: OcrProgress,
): Promise<OcrState> {
  signal.throwIfAborted();
  if (data.byteLength > ocrByteLimit) return { kind: 'failed', reason: 'size' };
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 50)
    return { kind: 'failed', reason: 'page' };
  if (running) return { kind: 'failed', reason: 'unavailable' };
  if (
    typeof Worker !== 'function' ||
    typeof OffscreenCanvas !== 'function' ||
    !document.fonts
  )
    return { kind: 'failed', reason: 'unsupported' };

  running = true;
  const callerSignal = signal;
  const lifetime = new AbortController();
  const forwardAbort = () => lifetime.abort(callerSignal.reason);
  callerSignal.addEventListener('abort', forwardAbort, { once: true });
  signal = lifetime.signal;
  let parserPort: Worker | undefined;
  let rendererPort: Worker | undefined;
  let worker: PDFWorker | undefined;
  let loading: ReturnType<typeof getDocument> | undefined;
  let render: RenderTask | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let fallback = false;
  let parserFailed = false;
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const releasePdf = () => {
    render?.cancel();
    render = undefined;
    // Caller-owned ports must be terminated explicitly, including initialization.
    // Do not await the vendor destroy handshake after terminating a busy worker.
    void loading?.destroy().catch(() => {});
    loading = undefined;
    worker?.destroy();
    worker = undefined;
    parserPort?.terminate();
    rendererPort?.terminate();
    parserPort = rendererPort = undefined;
    if (canvas) {
      canvas.width = canvas.height = 1;
      canvas = undefined;
    }
  };
  const cancel = () => {
    rejectAbort(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
    releasePdf();
  };
  signal.addEventListener('abort', cancel, { once: true });

  const run = async (): Promise<OcrState> => {
    progress('preparing', 0);
    signal.throwIfAborted();
    parserPort = new Worker(
      new URL('./pdf.worker.bootstrap.ts', import.meta.url),
      { type: 'module' },
    );
    const failParser = () => {
      if (signal.aborted) return;
      parserFailed = true;
      lifetime.abort(new Error('Unsupported PDF'));
    };
    parserPort.addEventListener('error', (event) => {
      event.preventDefault();
      failParser();
    });
    parserPort.addEventListener('messageerror', failParser);
    let parserReady = () => {};
    const ready = new Promise<void>((resolve) => {
      parserReady = resolve;
    });
    // Pinned 6.5.438's asynchronous XObject image-decoder catch ignores
    // stopAtErrors and sends a null image instead. Reject that protocol packet
    // before PDF.js can turn a corrupt/unsupported scan into partial OCR.
    // The owned lifetime also prevents a late decoder/render result reaching OCR.
    parserPort.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (signal.aborted || !event.data || typeof event.data !== 'object')
        return;
      const packet = event.data as {
        type?: unknown;
        action?: unknown;
        data?: unknown;
        stream?: unknown;
        success?: unknown;
      };
      if (packet.type === 'fmv-pdf-ocr-parser-failed') {
        failParser();
        return;
      }
      if (packet.type === 'fmv-pdf-ocr-parser-ready') {
        parserReady();
        return;
      }
      // Pinned StreamKind.ERROR=5, PULL_COMPLETE=7, START_COMPLETE=8.
      // PDF.js can mark a failed operator stream complete after displayReady
      // has resolved, yielding a successful blank/partial render. Reject first.
      if (
        packet.stream === 5 ||
        ((packet.stream === 7 || packet.stream === 8) &&
          packet.success === false)
      ) {
        failParser();
        return;
      }
      if (!Array.isArray(packet.data)) return;
      const imageMissing =
        (packet.action === 'obj' &&
          packet.data[2] === 'Image' &&
          packet.data[3] === null) ||
        (packet.action === 'commonobj' &&
          packet.data[1] === 'Image' &&
          packet.data[2] === null);
      if (imageMissing) {
        failParser();
      }
    });
    // Supplied ports are considered ready immediately by PDFWorker. Wait until
    // the imported parser has installed its listener before sending PDF bytes.
    await Promise.race([ready, aborted]);
    signal.throwIfAborted();
    rendererPort = new Worker(rendererUrl, { type: 'module' });
    worker = new PDFWorker({
      // PDF.js 6.5.438 runtime accepts Worker; its generated port type is null.
      // @ts-expect-error upstream port declaration omits Worker
      port: parserPort,
      // The bootstrap converts parser warnings into private failure packets.
      verbosity: VerbosityLevel.WARNINGS,
    });
    class LocalBinaryDataFactory {
      async fetch({ kind, filename }: { kind: string; filename: string }) {
        signal.throwIfAborted();
        const directory =
          kind === 'cMapUrl'
            ? 'cmaps'
            : kind === 'standardFontDataUrl'
              ? 'standard_fonts'
              : null;
        const asset =
          directory &&
          assets[`../../../node_modules/pdfjs-dist/${directory}/${filename}`];
        if (!asset) throw new Error('Unsupported PDF asset');
        const url = new URL(asset, window.location.href);
        if (url.origin !== window.location.origin)
          throw new Error('Unsupported PDF asset');
        const response = await fetch(url, { signal, credentials: 'omit' });
        if (!response.ok) throw new Error('Unavailable PDF asset');
        return new Uint8Array(await response.arrayBuffer());
      }
    }
    // In pinned 6.5.438 getDocument synchronously reserves a renderer port.
    // Restore global configuration immediately so other PDF users cannot acquire it.
    const previousPorts = GlobalWorkerOptions.rendererPorts;
    try {
      GlobalWorkerOptions.rendererPorts = [rendererPort];
      loading = getDocument({
        data,
        worker,
        verbosity: 0,
        BinaryDataFactory: LocalBinaryDataFactory,
        useWorkerFetch: false,
        useWasm: false,
        // Unsupported JPX/JBIG2 decoder fallbacks may attempt dynamic imports.
        // Pin those attempts to a same-origin unavailable path, never a document URL.
        wasmUrl: new URL(
          `${import.meta.env.BASE_URL}pdf-ocr-unsupported/`,
          window.location.href,
        ).href,
        disableFontFace: true,
        useSystemFonts: false,
        isOffscreenCanvasSupported: true,
        isImageDecoderSupported: false,
        disableWorkerRendering: false,
        enableXfa: false,
        stopAtErrors: true,
        // The owned parser guard catches vendor failures that escape stopAtErrors.
        // These are per-image/output bounds, not a claim of a total heap limit.
        maxImageSize: 16_000_000,
        canvasMaxAreaInBytes: 8_000_000,
        disableAutoFetch: true,
        disableStream: true,
        disableRange: true,
      });
    } finally {
      GlobalWorkerOptions.rendererPorts = previousPorts;
    }
    const pdf = await loading.promise;
    signal.throwIfAborted();
    if (pdf.numPages > 50) return { kind: 'failed', reason: 'pages' };
    if (pageNumber > pdf.numPages) return { kind: 'failed', reason: 'page' };
    if (pdf.isPureXfa) return { kind: 'failed', reason: 'unsupported' };
    const page = await pdf.getPage(pageNumber);
    signal.throwIfAborted();
    const base = page.getViewport({ scale: 1 });
    if (
      !Number.isFinite(base.width) ||
      !Number.isFinite(base.height) ||
      base.width <= 0 ||
      base.height <= 0
    )
      return { kind: 'failed', reason: 'dimensions' };
    const scale = Math.min(
      2,
      2000 / base.width,
      2000 / base.height,
      Math.sqrt(2_000_000 / (base.width * base.height)),
    );
    if (!Number.isFinite(scale) || scale <= 0)
      return { kind: 'failed', reason: 'dimensions' };
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width > 2000 ||
      height > 2000 ||
      width * height > 2_000_000
    )
      return { kind: 'failed', reason: 'dimensions' };
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    render = page.render({
      canvas,
      viewport,
      annotationMode: AnnotationMode.DISABLE,
      background: '#ffffff',
    });
    const task = render;
    // 6.5.438 can silently fall back to the main thread during graphics init.
    // Its first onContinue occurs after that decision but before page operators.
    // Check each continuation and after completion; never execute fallback drawing.
    task.onContinue = (resume: () => void) => {
      if (signal.aborted || !task.isWorkerRendering) {
        fallback ||= !task.isWorkerRendering;
        task.cancel();
      } else resume();
    };
    await task.promise;
    signal.throwIfAborted();
    if (!task.isWorkerRendering)
      return { kind: 'failed', reason: 'unsupported' };
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas!.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('Unavailable raster')),
        'image/png',
      );
    });
    signal.throwIfAborted();
    const bytes = new Uint8Array(await png.arrayBuffer());
    signal.throwIfAborted();
    // No PDF parser/renderer remains while the single OCR engine initializes.
    releasePdf();
    const result = await recognizeImage(bytes, 'image/png', signal, progress);
    signal.throwIfAborted();
    return result.kind === 'ready' || result.kind === 'empty'
      ? { ...result, downsized: result.downsized || scale < 2 }
      : result;
  };
  try {
    return await Promise.race([run(), aborted]);
  } catch (error) {
    if (parserFailed && !callerSignal.aborted)
      return { kind: 'failed', reason: 'unsupported' };
    if (signal.aborted) throw signal.reason;
    return {
      kind: 'failed',
      reason:
        error instanceof Error && error.name === 'PasswordException'
          ? 'encrypted'
          : fallback
            ? 'unsupported'
            : 'unavailable',
    };
  } finally {
    callerSignal.removeEventListener('abort', forwardAbort);
    signal.removeEventListener('abort', cancel);
    releasePdf();
    running = false;
  }
}
