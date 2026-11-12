import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Public engine/model assets only. No records or runtime credentials enter this plugin. */
export function ocrAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve('tesseract.js/package.json'));
  const core = dirname(require.resolve('tesseract.js-core/package.json'));
  const english = dirname(
    require.resolve('@tesseract.js-data/eng/package.json'),
  );
  const assets = new Map<string, string>([
    [
      'worker.js',
      resolve(
        import.meta.dirname,
        'src/features/documents/ocrEngine.bootstrap.js',
      ),
    ],
    ['engine.min.js', resolve(root, 'dist/worker.min.js')],
    [
      'lang/eng.traineddata.gz',
      resolve(english, '4.0.0_best_int/eng.traineddata.gz'),
    ],
    ['LICENSE_TESSERACT', resolve(root, 'LICENSE.md')],
    ['LICENSE_CORE', resolve(core, 'LICENSE')],
    [
      'engine.min.js.LICENSE.txt',
      resolve(root, 'dist/worker.min.js.LICENSE.txt'),
    ],
    ['LICENSE_ENGLISH_PACKAGE.json', resolve(english, 'package.json')],
  ]);
  for (const suffix of [
    '',
    '-lstm',
    '-simd',
    '-simd-lstm',
    '-relaxedsimd',
    '-relaxedsimd-lstm',
  ]) {
    const name = `tesseract-core${suffix}.wasm.js`;
    assets.set(`core/${name}`, resolve(core, name));
  }
  const prefix = '/ocr-assets/v7/';
  return {
    name: 'fmv-self-hosted-ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (!path.startsWith(prefix)) return next();
        const source = assets.get(path.slice(prefix.length));
        if (!source) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const data = readFileSync(source);
        res.setHeader(
          'Content-Type',
          path.endsWith('.js')
            ? 'text/javascript'
            : path.endsWith('.gz')
              ? 'application/gzip'
              : 'text/plain',
        );
        res.setHeader('Content-Length', data.length);
        res.end(data);
      });
    },
    generateBundle() {
      for (const [name, source] of assets) {
        const data = readFileSync(source);
        if (data.byteLength > 25 * 1024 * 1024)
          throw new Error('OCR asset exceeds static hosting limit');
        this.emitFile({
          type: 'asset',
          fileName: `${prefix.slice(1)}${name}`,
          source: data,
        });
      }
    },
  };
}
