import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { createHash } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
const { Response, AbortController, ReadableStream } = globalThis;
const source = await readFile(
  new URL('../src/features/documents/originalPreview.ts', import.meta.url),
  'utf8',
);
const compiled = ts
  .transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  .outputText.replaceAll(
    "'@fmv/contracts'",
    JSON.stringify(import.meta.resolve('@fmv/contracts')),
  );
const { readOriginalPreview } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);
const bytes = Buffer.from('%PDF-1.7\nSynthetic original comparison\n%%EOF');
const expected = {
  bytes: bytes.length,
  mime: 'application/pdf',
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
const response = (
  body = bytes,
  headers = { 'content-type': 'application/pdf' },
) => new Response(body, { headers });
const signal = () => new AbortController().signal;
test('original comparison accepts matching bounded bytes and MIME without changing them', async () => {
  const blob = await readOriginalPreview(response(), expected, signal());
  assert.equal(blob.type, 'application/pdf');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
  const encoded = await readOriginalPreview(
    response(bytes, {
      'content-type': 'application/pdf; charset=binary',
      'content-length': String(bytes.length),
    }),
    expected,
    signal(),
  );
  assert.equal(encoded.size, bytes.length);
});
test('original comparison rejects changed length/hash, disallowed type and malformed metadata', async () => {
  for (const [r, e, reason] of [
    [response(Buffer.from('short')), expected, 'mismatch'],
    [
      response(Buffer.concat([bytes, Buffer.from('extra')])),
      expected,
      'mismatch',
    ],
    [response(), { ...expected, sha256: 'b'.repeat(64) }, 'mismatch'],
    [response(bytes, { 'content-type': 'text/html' }), expected, 'invalid'],
    [response(), { ...expected, mime: 'image/svg+xml' }, 'invalid'],
    [response(), { ...expected, bytes: 0 }, 'invalid'],
    [response(), { ...expected, bytes: 1.5 }, 'invalid'],
    [response(), { ...expected, sha256: 'a'.repeat(64) + '\n' }, 'invalid'],
    [
      response(bytes, {
        'content-type': 'application/pdf',
        'content-length': String(26 * 1024 * 1024),
      }),
      expected,
      'size',
    ],
  ])
    await assert.rejects(
      readOriginalPreview(r, e, signal()),
      (error) => error.reason === reason,
    );
});
test('original comparison bounds actual streams, cancels overflow and respects cancellation', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(bytes);
      c.enqueue(bytes);
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    readOriginalPreview(response(stream), expected, signal()),
    (error) => error.reason === 'mismatch',
  );
  assert.equal(cancelled, true);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    readOriginalPreview(response(), expected, abort.signal),
    (error) => error.name === 'AbortError',
  );
  const broken = new ReadableStream({
    start(c) {
      c.error(Error('Synthetic stream failure'));
    },
  });
  await assert.rejects(
    readOriginalPreview(response(broken), expected, signal()),
  );
});
