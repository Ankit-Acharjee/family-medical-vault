import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { captureOriginals } from '../backup/capture-originals.mjs';
const bytes = Buffer.from('SYNTHETIC original bytes');
const row = (n = 1) => ({
  documentId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  objectKey: String(n).padStart(32, '0'),
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});
const options = (extra = {}) => ({
  maxObjectBytes: 100,
  maxTotalBytes: 1000,
  read: async () => bytes,
  write: async () => {},
  ...extra,
});
const rejects = (promise) =>
  assert.rejects(
    promise,
    /^Error: Original capture failed; incomplete sets must not be published$/,
  );
test('captures exact bytes sequentially with private metadata and value-free counts', async () => {
  const seen = [],
    rows = [row(1), row(2)];
  let active = 0;
  const result = await captureOriginals(
    rows,
    options({
      read: async (key) => {
        assert.equal(active++, 0);
        seen.push(key);
        return bytes;
      },
      write: async (record, value) => {
        assert.ok(Object.isFrozen(record));
        assert.deepEqual(value, bytes);
        assert.notEqual(value, bytes);
        active--;
      },
    }),
  );
  assert.deepEqual(result, {
    capturedObjects: 2,
    capturedBytes: bytes.length * 2,
  });
  assert.deepEqual(
    seen,
    rows.map((r) => r.objectKey),
  );
  assert.deepEqual(await captureOriginals([], options({ maxTotalBytes: 0 })), {
    capturedObjects: 0,
    capturedBytes: 0,
  });
});
test('rejects duplicate, malformed, sparse and over-budget inventory before reading', async () => {
  let reads = 0;
  for (const rows of [
    [row(), row()],
    [null],
    new Array(1),
    [{ ...row(), objectKey: '../private' }],
    [{ ...row(), sha256: 'invalid' }],
    [{ ...row(), title: 'must-not-appear' }],
    [{ ...row(), bytes: 101 }],
    [row(), { ...row(2), objectKey: row().objectKey }],
  ])
    await rejects(
      captureOriginals(
        rows,
        options({
          read: async () => {
            reads++;
            return bytes;
          },
        }),
      ),
    );
  await rejects(
    captureOriginals([row()], options({ maxTotalBytes: bytes.length - 1 })),
  );
  await rejects(captureOriginals([row()], options({ maxTotalBytes: NaN })));
  assert.equal(reads, 0);
});
test('missing, corrupt and truncated objects never reach the writer', async () => {
  let writes = 0;
  for (const read of [
    async () => {
      throw Error('private-key-or-provider-message');
    },
    async () => Buffer.alloc(bytes.length),
    async () => bytes.subarray(1),
    async () => 'wrong type',
  ])
    await rejects(
      captureOriginals(
        [row()],
        options({
          read,
          write: async () => {
            writes++;
          },
        }),
      ),
    );
  assert.equal(writes, 0);
});
test('later object failure leaves only partial work and never returns a completed result', async () => {
  let writes = 0;
  await rejects(
    captureOriginals(
      [row(1), row(2)],
      options({
        read: async (key) => {
          if (key === row(2).objectKey) throw Error('missing');
          return bytes;
        },
        write: async () => {
          writes++;
        },
      }),
    ),
  );
  assert.equal(writes, 1);
  await rejects(
    captureOriginals(
      [row()],
      options({
        write: async () => {
          throw Error('private destination failure');
        },
      }),
    ),
  );
});
test('abort before or during capture prevents success and next object reads', async () => {
  const controller = new globalThis.AbortController();
  controller.abort();
  let reads = 0;
  await rejects(
    captureOriginals(
      [row()],
      options({
        signal: controller.signal,
        read: async () => {
          reads++;
          return bytes;
        },
      }),
    ),
  );
  assert.equal(reads, 0);
  const during = new globalThis.AbortController();
  await rejects(
    captureOriginals(
      [row(1), row(2)],
      options({
        signal: during.signal,
        read: async () => {
          reads++;
          return bytes;
        },
        write: async () => during.abort(),
      }),
    ),
  );
  assert.equal(reads, 1);
});
