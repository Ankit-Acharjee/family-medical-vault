/* Owned classic worker around the pinned Tesseract.js 7 worker protocol.
 * No application credentials, source URLs, persistence or raw diagnostics. */
const base = new globalThis.URL('./', globalThis.location.href);
const allowed = new Set(['engine.min.js', 'lang/eng.traineddata.gz']);
for (const suffix of [
  '',
  '-lstm',
  '-simd',
  '-simd-lstm',
  '-relaxedsimd',
  '-relaxedsimd-lstm',
]) {
  allowed.add(`core/tesseract-core${suffix}.wasm.js`);
}
const safeUrl = (input) => {
  const url = new globalThis.URL(
    typeof input === 'string' ? input : input.url,
    base,
  );
  if (
    url.origin !== base.origin ||
    !url.pathname.startsWith(base.pathname) ||
    !allowed.has(url.pathname.slice(base.pathname.length)) ||
    url.search ||
    url.hash
  )
    throw new Error('Unsupported engine asset');
  return url.href;
};
globalThis.XMLHttpRequest = class {
  constructor() {
    throw new Error('Unsupported engine transport');
  }
};
const fetchAsset = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input) =>
  fetchAsset(safeUrl(input), { credentials: 'omit' });
const scripts = globalThis.importScripts.bind(globalThis);
globalThis.importScripts = (...urls) => scripts(...urls.map(safeUrl));
for (const name of ['log', 'info', 'warn', 'error', 'debug'])
  globalThis.console[name] = () => {};
const send = globalThis.postMessage.bind(globalThis);
for (const name of ['error', 'unhandledrejection']) {
  globalThis.addEventListener(name, (event) => {
    event.preventDefault();
    send({ status: 'fatal' });
  });
}
globalThis.postMessage = (packet) => {
  const { jobId, action, status } = packet;
  if (status === 'progress') {
    const progress =
      typeof packet.data?.progress === 'number'
        ? Math.max(0, Math.min(1, packet.data.progress))
        : 0;
    send({ jobId, action, status, data: { progress } });
  } else if (status === 'resolve') {
    const text =
      action === 'recognize' && typeof packet.data?.text === 'string'
        ? packet.data.text
        : '';
    send({
      jobId,
      action,
      status,
      data:
        action === 'recognize'
          ? { text: text.slice(0, 100000), partial: text.length > 100000 }
          : {},
    });
  } else if (status === 'reject') send({ jobId, action, status, data: null });
};
// Exact publisher asset, never the default remote CDN.
globalThis.importScripts(new globalThis.URL('engine.min.js', base).href);
