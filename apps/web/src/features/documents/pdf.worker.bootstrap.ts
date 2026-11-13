import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url&no-inline';

// Install before importing PDF.js: some pinned-parser image failures escape its
// document promises. Never forward the rejection, filename, stack or PDF data.
let failed = false;
const fail = () => {
  if (failed) return;
  failed = true;
  globalThis.postMessage({ type: 'fmv-pdf-ocr-parser-failed' });
};

// PDF.js also warns and skips some malformed images without rejecting. Its
// pinned warn() uses console.warn; treat all worker diagnostics as unsupported
// rather than accepting a partial scan. Ignore every diagnostic argument.
console.log = console.info = console.warn = console.error = fail;
console.debug = (...args: unknown[]) => {
  // Vite injects its worker client in development. These exact public transport
  // messages carry no document data; suppress them without disabling the guard.
  // Production removes this branch and rejects every worker diagnostic.
  if (
    import.meta.env.DEV &&
    args.length === 1 &&
    (args[0] === '[vite] connecting...' || args[0] === '[vite] connected.')
  )
    return;
  fail();
};

globalThis.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  fail();
});
globalThis.addEventListener('error', (event) => {
  event.preventDefault();
  fail();
});

// Load the unmodified, pinned publisher module from this application's assets.
// Dynamic import ensures the guards exist before its worker initialization.
const publisher = new URL(workerUrl, globalThis.location.href);
if (publisher.origin !== globalThis.location.origin) {
  fail();
} else {
  void import(/* @vite-ignore */ publisher.href)
    .then(() => {
      globalThis.postMessage({ type: 'fmv-pdf-ocr-parser-ready' });
    })
    .catch(fail);
}
