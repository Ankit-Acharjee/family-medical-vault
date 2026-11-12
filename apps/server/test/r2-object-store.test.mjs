import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { maximumDocumentBytes } from '@fmv/contracts';
import { R2ObjectStore } from '../dist/documents/r2-object-store.js';
import { createObjectKey } from '../dist/documents/object-key.js';

const config = {
  accountId: '0123456789abcdef0123456789abcdef',
  bucket: 'fmv-synthetic-private',
  accessKeyId: 'synthetic-access-key',
  secretAccessKey: 'synthetic-secret-key',
};
const key = 'b'.repeat(32);
const bytes = Buffer.from('%PDF-1.7\nsynthetic-only\n%%EOF\n');
const sensitive = 'SYNTHETIC_PROVIDER_SECRET_DO_NOT_DISCLOSE';
const flush = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

function redacted(error) {
  assert.ok(error instanceof Error);
  for (const value of [sensitive, key, ...Object.values(config)])
    assert.equal(error.message.includes(value), false);
  assert.equal(error.cause, undefined);
  return true;
}

function fixture(send = async () => ({})) {
  const calls = [];
  const sender = {
    async send(command, options) {
      calls.push({ command, options });
      return send(command, options);
    },
  };
  return { store: new R2ObjectStore(config, sender), calls, sender };
}

test('configured readiness needs no provider request and destroy closes the adapter', async () => {
  const { store, calls, sender } = fixture();
  let senderDestroyed = false;
  sender.destroy = () => {
    senderDestroyed = true;
  };
  assert.equal(store.ready, true);
  assert.equal(calls.length, 0);
  store.onModuleDestroy();
  store.destroy();
  assert.equal(store.ready, false);
  assert.equal(senderDestroyed, false);
  await assert.rejects(store.put(key, bytes, 'application/pdf'), redacted);
  await assert.rejects(store.get(key), redacted);
  await assert.rejects(store.remove(key), redacted);
  assert.equal(calls.length, 0);
});

test('owned SDK client uses the derived endpoint, explicit credentials and no mutation retry', async () => {
  const original = S3Client.prototype.send;
  const calls = [];
  S3Client.prototype.send = async function (command, options) {
    calls.push({ client: this, command, options });
    return {};
  };
  let store;
  try {
    store = new R2ObjectStore(config);
    assert.equal(calls.length, 0);
    await store.put(key, bytes, 'application/pdf');
    assert.equal(calls.length, 1);
    const sdkConfig = calls[0].client.config;
    assert.equal(await sdkConfig.region(), 'auto');
    assert.equal(await sdkConfig.maxAttempts(), 1);
    assert.equal(await sdkConfig.requestChecksumCalculation(), 'WHEN_REQUIRED');
    assert.equal(await sdkConfig.responseChecksumValidation(), 'WHEN_REQUIRED');
    const credentials = await sdkConfig.credentials();
    assert.equal(credentials.accessKeyId, config.accessKeyId);
    assert.equal(credentials.secretAccessKey, config.secretAccessKey);
    assert.equal(credentials.sessionToken, undefined);
    const endpoint = await sdkConfig.endpoint();
    assert.equal(endpoint.protocol, 'https:');
    assert.equal(
      endpoint.hostname,
      `${config.accountId}.r2.cloudflarestorage.com`,
    );
    assert.ok(calls[0].options.abortSignal instanceof globalThis.AbortSignal);
  } finally {
    store?.destroy();
    S3Client.prototype.send = original;
  }
});

test('owned SDK signs and serializes PUT, streamed GET, and DELETE through a synthetic transport', async () => {
  const original = S3Client.prototype.send;
  const requests = [];
  let stored;
  let transportDestroyed = false;
  const requestHandler = {
    metadata: { handlerProtocol: 'http/1.1' },
    async handle(request, options) {
      requests.push(request.method);
      assert.equal(request.protocol, 'https:');
      const host = `${config.accountId}.r2.cloudflarestorage.com`;
      const privateAddresses = new Set([
        `${host}/${config.bucket}/${key}`,
        `${config.bucket}.${host}/${key}`,
      ]);
      assert.equal(
        privateAddresses.has(`${request.hostname}${request.path}`),
        true,
      );
      assert.ok(options.abortSignal instanceof globalThis.AbortSignal);
      const headers = request.headers;
      assert.equal(
        typeof headers.authorization === 'string' &&
          headers.authorization.startsWith('AWS4-HMAC-SHA256 '),
        true,
      );
      assert.equal(typeof headers['x-amz-date'] === 'string', true);
      assert.equal(headers['x-amz-security-token'], undefined);
      assert.equal(headers['x-amz-acl'], undefined);
      assert.equal(headers['x-amz-sdk-checksum-algorithm'], undefined);
      assert.equal(headers['x-amz-checksum-mode'], undefined);
      assert.equal(
        Object.keys(headers).some((name) => name.startsWith('x-amz-checksum-')),
        false,
      );
      assert.equal(headers['content-encoding'], undefined);
      if (request.method === 'PUT') {
        assert.equal(headers['content-type'], 'application/pdf');
        assert.equal(headers['content-length'], String(bytes.length));
        assert.equal(headers['cache-control'], 'private, no-store');
        if (Buffer.isBuffer(request.body) || request.body instanceof Uint8Array)
          stored = Buffer.from(request.body);
        else {
          const chunks = [];
          for await (const chunk of request.body)
            chunks.push(Buffer.from(chunk));
          stored = Buffer.concat(chunks);
        }
        assert.deepEqual(stored, bytes);
      }
      if (request.method === 'GET') {
        assert.ok(stored);
        return {
          response: {
            statusCode: 200,
            headers: { 'content-length': String(stored.length) },
            body: Readable.from([stored.subarray(0, 3), stored.subarray(3)]),
          },
        };
      }
      if (request.method === 'DELETE') stored = undefined;
      return {
        response: {
          statusCode: request.method === 'DELETE' ? 204 : 200,
          headers: {},
          body: Readable.from([]),
        },
      };
    },
    destroy() {
      transportDestroyed = true;
    },
  };
  S3Client.prototype.send = function (command, options) {
    this.config.requestHandler = requestHandler;
    return original.call(this, command, options);
  };
  let store;
  try {
    store = new R2ObjectStore(config);
    assert.deepEqual(requests, []);
    await store.put(key, bytes, 'application/pdf');
    assert.deepEqual(await store.get(key), bytes);
    await store.remove(key);
    assert.equal(stored, undefined);
    assert.deepEqual(requests, ['PUT', 'GET', 'DELETE']);
    store.onModuleDestroy();
    assert.equal(transportDestroyed, true);
  } finally {
    store?.destroy();
    S3Client.prototype.send = original;
  }
});

test('put preserves exact original bytes and sends only a private exact-key object command', async () => {
  const { store, calls } = fixture();
  try {
    for (const mime of [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ])
      await store.put(key, bytes, mime);
    assert.equal(calls.length, 4);
    for (const { command, options } of calls) {
      assert.ok(command instanceof PutObjectCommand);
      assert.equal(command.input.Bucket, config.bucket);
      assert.equal(command.input.Key, key);
      assert.deepEqual(command.input.Body, bytes);
      assert.equal(command.input.ContentLength, bytes.length);
      assert.equal(command.input.ACL, undefined);
      assert.equal(command.input.WebsiteRedirectLocation, undefined);
      assert.ok(options.abortSignal instanceof globalThis.AbortSignal);
    }
    assert.deepEqual(
      calls.map(({ command }) => command.input.ContentType),
      ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    );
  } finally {
    store.destroy();
  }
});

test('namespaced originals retain their exact key for put, read and cleanup', async () => {
  const path = createObjectKey(
    'c'.repeat(32),
    '12345678-1234-1234-1234-123456789abc',
  );
  const { store, calls } = fixture(async (command) =>
    command instanceof GetObjectCommand
      ? { Body: Readable.from([bytes]), ContentLength: bytes.length }
      : {},
  );
  try {
    await store.put(path, bytes, 'application/pdf');
    assert.deepEqual(await store.get(path), bytes);
    await store.remove(path);
    assert.equal(calls.length, 3);
    for (const { command } of calls) assert.equal(command.input.Key, path);
  } finally {
    store.destroy();
  }
});

test('a caller cannot change the bytes of an already dispatched upload', async () => {
  let finish;
  const { store, calls } = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const original = Buffer.from(bytes);
  const expected = Buffer.from(original);
  try {
    const pending = store.put(key, original, 'application/pdf');
    original.fill(0);
    await flush();
    assert.deepEqual(calls[0].command.input.Body, expected);
    finish({});
    await pending;
  } finally {
    store.destroy();
  }
});

test('invalid keys, MIME, and byte sizes are rejected before any provider request', async () => {
  const { store, calls } = fixture();
  try {
    for (const badKey of [
      '',
      'a'.repeat(31),
      'a'.repeat(33),
      'A'.repeat(32),
      'g'.repeat(32),
      `../${key}`,
      `${key}/suffix`,
      null,
      undefined,
    ]) {
      await assert.rejects(
        store.put(badKey, bytes, 'application/pdf'),
        redacted,
      );
      await assert.rejects(store.get(badKey), redacted);
      await assert.rejects(store.remove(badKey), redacted);
    }
    for (const mime of [
      'text/plain',
      'image/svg+xml',
      'application/PDF',
      '',
      null,
    ])
      await assert.rejects(store.put(key, bytes, mime), redacted);
    for (const invalid of [
      Buffer.alloc(0),
      Buffer.alloc(maximumDocumentBytes + 1),
      null,
      'bytes',
    ])
      await assert.rejects(
        store.put(key, invalid, 'application/pdf'),
        redacted,
      );
    assert.equal(calls.length, 0);
    await store.put(key, Buffer.alloc(maximumDocumentBytes), 'application/pdf');
    assert.equal(calls.length, 1);
  } finally {
    store.destroy();
  }
});

test('direct construction also rejects malformed identities and credentials', () => {
  for (const override of [
    { accountId: 'invalid-account' },
    { bucket: 'invalid/bucket' },
    { bucket: 'abc.def' },
    { bucket: 'abc\n' },
    { accessKeyId: '' },
    { secretAccessKey: 'synthetic\nsecret' },
  ])
    assert.throws(
      () => new R2ObjectStore({ ...config, ...override }),
      redacted,
    );
});

test('get preserves binary chunks, checks declared length, and destroys consumed bodies', async () => {
  for (const contentLength of [undefined, bytes.length]) {
    const body = Readable.from([
      bytes.subarray(0, 5),
      new Uint8Array(bytes.subarray(5)),
    ]);
    const { store, calls } = fixture(async () => ({
      Body: body,
      ContentLength: contentLength,
    }));
    try {
      assert.deepEqual(await store.get(key), bytes);
      assert.ok(calls[0].command instanceof GetObjectCommand);
      assert.deepEqual(calls[0].command.input, {
        Bucket: config.bucket,
        Key: key,
      });
      assert.equal(body.destroyed, true);
    } finally {
      store.destroy();
    }
  }
});

test('get rejects missing, nonstream, empty, invalid-length and truncated bodies', async () => {
  const cases = [
    () => ({}),
    () => ({ Body: bytes, ContentLength: bytes.length }),
    () => ({ Body: Readable.from([]) }),
    () => ({ Body: Readable.from(['text-is-not-a-binary-chunk']) }),
    ...[0, -1, 1.5, NaN, Infinity, '28', maximumDocumentBytes + 1].map(
      (length) => () => ({
        Body: Readable.from([bytes]),
        ContentLength: length,
      }),
    ),
    () => ({ Body: Readable.from([bytes]), ContentLength: bytes.length + 1 }),
    () => ({ Body: Readable.from([bytes]), ContentLength: bytes.length - 1 }),
  ];
  for (const make of cases) {
    const response = make();
    const { store } = fixture(async () => response);
    try {
      await assert.rejects(store.get(key), redacted);
      if (response.Body instanceof Readable)
        assert.equal(response.Body.destroyed, true);
    } finally {
      store.destroy();
    }
  }
});

test('get enforces the actual streamed byte limit even without ContentLength', async () => {
  const chunk = Buffer.alloc(1024 * 1024);
  let produced = 0;
  const body = Readable.from(
    (async function* () {
      for (let index = 0; index < 100; index += 1) {
        produced += 1;
        yield chunk;
      }
    })(),
  );
  const { store } = fixture(async () => ({ Body: body }));
  try {
    await assert.rejects(store.get(key), redacted);
    assert.equal(body.destroyed, true);
    assert.ok(
      produced < 100,
      'oversized streams must stop before consuming the whole object',
    );
  } finally {
    store.destroy();
  }
});

test('get accepts the exact maximum supported original size', async () => {
  const chunk = Buffer.alloc(1024 * 1024, 0x42);
  const body = Readable.from(
    (async function* () {
      for (let size = 0; size < maximumDocumentBytes; size += chunk.length)
        yield chunk;
    })(),
  );
  const { store } = fixture(async () => ({
    Body: body,
    ContentLength: maximumDocumentBytes,
  }));
  try {
    const result = await store.get(key);
    assert.equal(result.length, maximumDocumentBytes);
    assert.deepEqual(result.subarray(0, chunk.length), chunk);
    assert.deepEqual(result.subarray(-chunk.length), chunk);
    assert.equal(body.destroyed, true);
  } finally {
    store.destroy();
  }
});

test('stream failures are sanitized and destroy the body', async () => {
  const body = Readable.from(
    (async function* () {
      yield bytes.subarray(0, 3);
      throw new Error(`${sensitive} ${key} ${config.secretAccessKey}`);
    })(),
  );
  const { store } = fixture(async () => ({
    Body: body,
    ContentLength: bytes.length,
  }));
  try {
    await assert.rejects(store.get(key), redacted);
    assert.equal(body.destroyed, true);
  } finally {
    store.destroy();
  }
});

test('a failed provider response destroys its body before returning a sanitized error', async () => {
  const body = new Readable({ read() {} });
  const { store } = fixture(async () => ({
    Body: body,
    $metadata: { httpStatusCode: 403 },
  }));
  try {
    await assert.rejects(store.get(key), redacted);
    assert.equal(body.destroyed, true);
  } finally {
    store.destroy();
  }
});

test('provider errors and invalid unknown SDK results fail closed without leaking provider detail', async () => {
  for (const send of [
    async () => {
      throw new Error(`${sensitive} ${key} ${config.secretAccessKey}`);
    },
    ...[
      undefined,
      null,
      false,
      'provider-result',
      1,
      [],
      { $metadata: null },
      { $metadata: { httpStatusCode: 403 } },
      { $metadata: { httpStatusCode: 500 } },
      { $metadata: { httpStatusCode: '200' } },
    ].map((result) => async () => result),
  ]) {
    const { store, calls } = fixture(send);
    try {
      await assert.rejects(store.put(key, bytes, 'application/pdf'), redacted);
      await assert.rejects(store.get(key), redacted);
      await assert.rejects(store.remove(key), redacted);
      assert.equal(
        calls.length,
        3,
        'adapter must not retry uncertain mutations',
      );
    } finally {
      store.destroy();
    }
  }
});

test('remove uses exact DeleteObject and treats absent objects as idempotent success', async () => {
  for (const result of [{}, { $metadata: { httpStatusCode: 204 } }]) {
    const { store, calls } = fixture(async () => result);
    try {
      await store.remove(key);
      await store.remove(key);
      assert.equal(calls.length, 2);
      for (const { command } of calls) {
        assert.ok(command instanceof DeleteObjectCommand);
        assert.deepEqual(command.input, { Bucket: config.bucket, Key: key });
      }
    } finally {
      store.destroy();
    }
  }
});

test('every operation has an eight-second deadline even when the sender ignores cancellation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { store, calls } = fixture(() => new Promise(() => {}));
  try {
    const pending = [
      store.put(key, bytes, 'application/pdf'),
      store.get(key),
      store.remove(key),
    ].map((operation) => assert.rejects(operation, redacted));
    await flush();
    assert.equal(calls.length, 3);
    t.mock.timers.tick(7999);
    assert.ok(calls.every(({ options }) => !options.abortSignal.aborted));
    t.mock.timers.tick(1);
    await Promise.all(pending);
    assert.ok(calls.every(({ options }) => options.abortSignal.aborted));
  } finally {
    store.destroy();
  }
});

test('GET headers and body share one deadline, aborting and destroying a stalled stream', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolveHeaders;
  const body = new Readable({ read() {} });
  const { store, calls } = fixture(
    () =>
      new Promise((resolve) => {
        resolveHeaders = resolve;
      }),
  );
  try {
    const pending = assert.rejects(store.get(key), redacted);
    await flush();
    t.mock.timers.tick(6000);
    resolveHeaders({ Body: body, ContentLength: bytes.length });
    await flush();
    t.mock.timers.tick(1999);
    assert.equal(body.destroyed, false);
    t.mock.timers.tick(1);
    await pending;
    assert.equal(calls[0].options.abortSignal.aborted, true);
    assert.equal(body.destroyed, true);
  } finally {
    store.destroy();
  }
});

test('successful operations cancel deadlines instead of aborting completed requests later', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { store, calls } = fixture(async (command) =>
    command instanceof GetObjectCommand
      ? { Body: Readable.from([bytes]), ContentLength: bytes.length }
      : {},
  );
  try {
    await store.put(key, bytes, 'application/pdf');
    await store.get(key);
    await store.remove(key);
    t.mock.timers.tick(16000);
    assert.ok(calls.every(({ options }) => !options.abortSignal.aborted));
  } finally {
    store.destroy();
  }
});

test('destroy cancels an active read immediately and destroys a response arriving after cancellation', async () => {
  let resolveHeaders;
  const body = new Readable({ read() {} });
  const { store, calls } = fixture(
    () =>
      new Promise((resolve) => {
        resolveHeaders = resolve;
      }),
  );
  const pending = assert.rejects(store.get(key), redacted);
  await flush();
  store.destroy();
  await pending;
  assert.equal(calls[0].options.abortSignal.aborted, true);
  resolveHeaders({ Body: body, ContentLength: bytes.length });
  await flush();
  assert.equal(body.destroyed, true);
});

test('destroy aborts and destroys a body already being consumed', async () => {
  const body = new Readable({ read() {} });
  const { store, calls } = fixture(async () => ({ Body: body }));
  const pending = assert.rejects(store.get(key), redacted);
  await flush();
  assert.equal(body.destroyed, false);
  store.destroy();
  await pending;
  assert.equal(calls[0].options.abortSignal.aborted, true);
  assert.equal(body.destroyed, true);
});

test(
  'real elapsed deadline interrupts a stalled body after headers',
  { timeout: 12000 },
  async () => {
    const body = new Readable({ read() {} });
    const { store, calls } = fixture(async () => ({
      Body: body,
      ContentLength: bytes.length,
    }));
    const started = performance.now();
    try {
      await assert.rejects(store.get(key), redacted);
      assert.ok(performance.now() - started >= 7500);
      assert.equal(calls[0].options.abortSignal.aborted, true);
      assert.equal(body.destroyed, true);
    } finally {
      store.destroy();
    }
  },
);
