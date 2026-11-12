import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer as createHttpServer } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { createServer, loadConfigFromFile } from 'vite';

test('Vite forwards API requests unchanged to the configured backend', async () => {
  const received = [];
  const api = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({
      path: req.url,
      method: req.method,
      host: req.headers.host,
      cookie: req.headers.cookie,
      origin: req.headers.origin,
      body: Buffer.concat(chunks),
    });
    if (req.method === 'PUT') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.from([0, 255, 17, 128]));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          from: 'synthetic-api',
          path: req.url,
          method: req.method,
        }),
      );
    }
  });
  let vite;
  try {
    await new Promise((resolve, reject) => {
      api.once('error', reject);
      api.listen(0, '127.0.0.1', resolve);
    });
    const configFile = fileURLToPath(
      new URL('../vite.config.ts', import.meta.url),
    );
    const loaded = await loadConfigFromFile(
      { command: 'serve', mode: 'development' },
      configFile,
    );
    assert.ok(loaded, 'Vite configuration must load');
    const originalProxy = loaded.config.server?.proxy ?? {};
    const proxy = Object.fromEntries(
      Object.entries(originalProxy).map(([prefix, options]) => [
        prefix,
        typeof options === 'string'
          ? { target: `http://127.0.0.1:${api.address().port}` }
          : { ...options, target: `http://127.0.0.1:${api.address().port}` },
      ]),
    );
    vite = await createServer({
      ...loaded.config,
      configFile: false,
      plugins: [],
      logLevel: 'silent',
      server: {
        ...loaded.config.server,
        host: '127.0.0.1',
        port: 0,
        strictPort: false,
        hmr: false,
        proxy,
      },
    });
    await vite.listen();
    const address = vite.httpServer.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    const cases = [
      { path: '/api/auth/bootstrap', method: 'GET', body: undefined },
      { path: '/api/patients', method: 'GET', body: undefined },
      {
        path: '/api/access/inspect',
        method: 'POST',
        body: Buffer.from('{"token":"synthetic"}'),
      },
      {
        path: '/api/patients/p/uploads/u/content',
        method: 'PUT',
        body: Buffer.from([0, 1, 127, 128, 255]),
      },
    ];
    for (const entry of cases) {
      const response = await globalThis.fetch(origin + entry.path, {
        method: entry.method,
        headers: {
          Cookie: 'synthetic=session',
          Origin: 'http://fixture.example:1234',
          Accept: 'text/html, application/json',
        },
        ...(entry.body ? { body: entry.body } : {}),
      });
      assert.equal(response.status, 200, `${entry.method} ${entry.path}`);
      if (entry.method === 'PUT') {
        assert.match(
          response.headers.get('content-type') ?? '',
          /^application\/octet-stream/,
        );
        assert.deepEqual(
          Buffer.from(await response.arrayBuffer()),
          Buffer.from([0, 255, 17, 128]),
        );
      } else {
        assert.match(
          response.headers.get('content-type') ?? '',
          /^application\/json/,
          `${entry.path} must not return SPA HTML`,
        );
        assert.deepEqual(await response.json(), {
          from: 'synthetic-api',
          path: entry.path,
          method: entry.method,
        });
      }
      const forwarded = received.at(-1);
      assert.equal(forwarded?.path, entry.path);
      assert.equal(forwarded?.method, entry.method);
      assert.equal(forwarded?.host, `127.0.0.1:${address.port}`);
      assert.equal(forwarded?.cookie, 'synthetic=session');
      assert.equal(forwarded?.origin, 'http://fixture.example:1234');
      assert.deepEqual(forwarded?.body, entry.body ?? Buffer.alloc(0));
    }
  } finally {
    await vite?.close();
    api.closeAllConnections();
    if (api.listening)
      await new Promise((resolve, reject) =>
        api.close((error) => (error ? reject(error) : resolve())),
      );
  }
});
