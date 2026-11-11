import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { maximumDocumentBytes } from '@fmv/contracts';
import { DocumentIntake, IntakeError } from '../dist/documents/intake.js';
import { MemoryObjectStore } from '../dist/documents/memory-object-store.js';
import { UnavailableObjectStore } from '../dist/documents/object-store.js';

const { structuredClone } = globalThis;

const patient = randomUUID();
const category = randomUUID();
const otherCategory = randomUUID();
const pdf = Buffer.from('%PDF-1.7\nsynthetic fixture\n%%EOF\n');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const allow = async () => {};
const status = (expected) => (error) =>
  error instanceof IntakeError && error.status === expected;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

class Metadata {
  rows = new Map();
  locks = new Map();
  failCreate = false;
  failReady = false;
  failFailed = false;
  failCommit = false;
  categories = new Set([category, otherCategory]);
  async withLock(key, work) {
    const before = this.locks.get(key) ?? Promise.resolve();
    const gate = deferred();
    const tail = before.then(() => gate.promise);
    this.locks.set(key, tail);
    await before;
    const snapshot = structuredClone(this.rows);
    try {
      const outcome = await work(this);
      if (this.failCommit) {
        this.failCommit = false;
        this.rows = snapshot;
        throw new Error('synthetic transaction connection loss');
      }
      return outcome;
    } finally {
      gate.resolve();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
  async resolveCategory(id) {
    return this.categories.has(id ?? category) ? (id ?? category) : null;
  }
  async findByIdempotency(patientId, key) {
    const row = [...this.rows.values()].find(
      (r) => r.patientId === patientId && r.idempotencyKey === key,
    );
    return row ? structuredClone(row) : null;
  }
  async findUpload(patientId, id) {
    const row = this.rows.get(id);
    return row?.patientId === patientId ? structuredClone(row) : null;
  }
  async findDocument(patientId, id) {
    const row = [...this.rows.values()].find(
      (r) => r.patientId === patientId && r.documentId === id,
    );
    return row ? structuredClone(row) : null;
  }
  async create(record) {
    if (this.failCreate)
      throw new Error('sensitive synthetic database failure');
    assert.equal(
      await this.findByIdempotency(record.patientId, record.idempotencyKey),
      null,
    );
    this.rows.set(record.uploadId, structuredClone(record));
  }
  async setState(id, state) {
    if (state === 'failed' && this.failFailed)
      throw new Error('synthetic metadata failure');
    const row = this.rows.get(id);
    assert.ok(row);
    row.state = state;
    if (state === 'ready' && this.failReady) {
      this.failReady = false;
      throw new Error('synthetic uncertain ready write');
    }
  }
}

class Objects extends MemoryObjectStore {
  puts = [];
  gets = [];
  removals = [];
  failPut = false;
  failRemove = false;
  onGet;
  onPut;
  async put(key, bytes, mime) {
    this.puts.push({ key, mime });
    await this.onPut?.();
    await super.put(key, bytes, mime);
    if (this.failPut) throw new Error('sensitive synthetic partial write');
  }
  async get(key) {
    this.gets.push(key);
    const bytes = await super.get(key);
    await this.onGet?.();
    return bytes;
  }
  async remove(key) {
    this.removals.push(key);
    if (this.failRemove) throw new Error('synthetic cleanup failure');
    await super.remove(key);
  }
}

function setup(objects = new Objects()) {
  const metadata = new Metadata();
  const intake = new DocumentIntake(metadata, objects);
  const input = (bytes = pdf, extra = {}) => ({
    title: 'Synthetic original.pdf',
    mimeType: 'application/pdf',
    bytes: bytes.length,
    sha256: hash(bytes),
    idempotencyKey: randomUUID(),
    ...extra,
  });
  const begin = (declaration = input(), auth = allow) =>
    intake.begin(patient, declaration, auth);
  const content = (id, bytes = pdf, auth = allow) =>
    intake.content(patient, id, bytes, auth);
  const finalize = (id, auth = allow) => intake.finalize(patient, id, auth);
  return { metadata, objects, intake, input, begin, content, finalize };
}

test('private original lifecycle requires finalize, retains exact bytes and uses opaque keys', async () => {
  const f = setup();
  const checks = [];
  const auth = async (...args) => checks.push(args);
  const first = await f.begin(
    f.input(pdf, { title: '  Synthetic original.pdf  ' }),
    auth,
  );
  assert.equal(first.state, 'pending');
  assert.equal((await f.content(first.uploadId, pdf, auth)).state, 'pending');
  await assert.rejects(
    f.intake.read(patient, first.documentId, 'view', allow),
    status(404),
  );
  assert.equal((await f.finalize(first.uploadId, auth)).state, 'ready');
  const { record, bytes } = await f.intake.read(
    patient,
    first.documentId,
    'export',
    auth,
  );
  assert.deepEqual(bytes, pdf);
  assert.equal(record.title, 'Synthetic original.pdf');
  assert.match(record.objectKey, /^[a-f0-9]{32}$/);
  assert.ok(!record.objectKey.includes(patient));
  assert.equal(record.categoryId, category);
  assert.ok(
    checks.some(
      ([, action, scope]) =>
        action === 'export' && scope.documentId === first.documentId,
    ),
  );
  assert.ok(
    checks.some(
      ([, action, scope]) =>
        action === 'upload' && scope.categoryId === category,
    ),
  );
  bytes.fill(0);
  assert.deepEqual(
    (await f.intake.read(patient, first.documentId, 'view', allow)).bytes,
    pdf,
  );
  const writes = f.objects.puts.length;
  const removes = f.objects.removals.length;
  assert.equal((await f.content(first.uploadId)).state, 'ready');
  assert.equal((await f.finalize(first.uploadId)).state, 'ready');
  assert.equal(f.objects.puts.length, writes);
  assert.equal(f.objects.removals.length, removes);
});

test('metadata declarations reject invalid size, MIME, digest and fields without creating records', async () => {
  const f = setup();
  for (const [extra, expected] of [
    [{ bytes: 0 }, 400],
    [{ bytes: -1 }, 400],
    [{ bytes: 1.5 }, 400],
    [{ bytes: maximumDocumentBytes + 1 }, 413],
    [{ mimeType: 'text/html' }, 415],
    [{ sha256: 'a'.repeat(63) }, 400],
    [{ sha256: 'g'.repeat(64) }, 400],
    [{ sha256: `${'a'.repeat(64)}\n` }, 400],
    [{ sha256: `${'a'.repeat(64)}\r\n` }, 400],
    [{ title: ' ' }, 400],
    [{ title: 'x'.repeat(201) }, 400],
    [{ idempotencyKey: '' }, 400],
    [{ idempotencyKey: 'x'.repeat(129) }, 400],
    [{ idempotencyKey: 'line\nbreak' }, 400],
    [{ idempotencyKey: 'trailing-newline\n' }, 400],
    [{ idempotencyKey: 'trailing-carriage-return\r' }, 400],
    [{ categoryId: 'not-a-known-category' }, 400],
    [{ categoryId: `${category}\n` }, 400],
    [{ categoryId: '' }, 400],
  ])
    await assert.rejects(f.begin(f.input(pdf, extra)), status(expected));
  assert.equal(f.metadata.rows.size, 0);
  assert.equal(f.objects.puts.length, 0);
});

test('category declarations require a complete UUID even if metadata recognizes another identifier', async () => {
  const f = setup();
  f.metadata.categories.add('non-uuid-category');
  await assert.rejects(
    f.begin(f.input(pdf, { categoryId: 'non-uuid-category' })),
    status(400),
  );
  assert.equal(f.metadata.rows.size, 0);
});

test('read rejects every non-view/export runtime action before authorization or object access', async () => {
  const f = setup();
  const upload = await f.begin();
  await f.content(upload.uploadId);
  await f.finalize(upload.uploadId);
  const reads = f.objects.gets.length;
  let authorizationCalls = 0;
  const uploadOnly = async (_patient, action) => {
    authorizationCalls++;
    if (action !== 'upload') throw new Error('synthetic denied');
  };
  for (const action of [
    'upload',
    'edit',
    'manage',
    'unknown-action',
    null,
    undefined,
  ])
    await assert.rejects(
      f.intake.read(patient, upload.documentId, action, uploadOnly),
      status(404),
    );
  assert.equal(authorizationCalls, 0);
  assert.equal(f.objects.gets.length, reads);
});

test('supported MIME signatures match the declared type; WebP length and codec are checked', async () => {
  const webp = Buffer.alloc(20);
  webp.write('RIFF');
  webp.writeUInt32LE(12, 4);
  webp.write('WEBPVP8 ', 8);
  const examples = [
    ['application/pdf', pdf],
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])],
    ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])],
    ['image/webp', webp],
  ];
  for (const [mimeType, bytes] of examples) {
    const f = setup();
    const upload = await f.begin(f.input(bytes, { mimeType }));
    await f.content(upload.uploadId, bytes);
    assert.equal((await f.finalize(upload.uploadId)).state, 'ready');
    const wrong = await f.begin(
      f.input(Buffer.from('<html>synthetic</html>'), { mimeType }),
    );
    await assert.rejects(
      f.content(wrong.uploadId, Buffer.from('<html>synthetic</html>')),
      status(415),
    );
  }
  for (const offset of [4, 12]) {
    const corrupt = Buffer.from(webp);
    corrupt[offset] = 0;
    const f = setup();
    const upload = await f.begin(f.input(corrupt, { mimeType: 'image/webp' }));
    await assert.rejects(f.content(upload.uploadId, corrupt), status(415));
  }
});

test('25 MiB inclusive bound, actual length and checksum are enforced before object writes', async () => {
  const f = setup();
  const large = Buffer.alloc(maximumDocumentBytes);
  pdf.copy(large);
  const upload = await f.begin(f.input(large));
  await f.content(upload.uploadId, large);
  assert.equal((await f.finalize(upload.uploadId)).state, 'ready');
  const pending = await f.begin();
  const writes = f.objects.puts.length;
  await assert.rejects(
    f.content(pending.uploadId, Buffer.alloc(maximumDocumentBytes + 1)),
    status(413),
  );
  await assert.rejects(
    f.content(pending.uploadId, pdf.subarray(1)),
    status(400),
  );
  await assert.rejects(
    f.content(pending.uploadId, Buffer.from('x'.repeat(pdf.length))),
    status(400),
  );
  assert.equal(f.objects.puts.length, writes);
  assert.equal(f.metadata.rows.get(pending.uploadId).state, 'pending');
});

test('idempotency serializes begin across instances and rejects conflicting declarations', async () => {
  const f = setup();
  const declaration = f.input();
  const second = new DocumentIntake(f.metadata, f.objects);
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, n) =>
      (n % 2 ? f.intake : second).begin(patient, declaration, allow),
    ),
  );
  assert.equal(new Set(results.map((r) => r.uploadId)).size, 1);
  assert.equal(f.metadata.rows.size, 1);
  for (const extra of [
    { title: 'Different' },
    { mimeType: 'image/png' },
    { bytes: pdf.length + 1 },
    { sha256: 'a'.repeat(64) },
    { categoryId: otherCategory },
  ])
    await assert.rejects(f.begin({ ...declaration, ...extra }), status(409));
  assert.equal(
    (
      await f.begin({
        ...declaration,
        sha256: declaration.sha256.toUpperCase(),
      })
    ).uploadId,
    results[0].uploadId,
  );
  assert.notEqual(
    (await second.begin(randomUUID(), declaration, allow)).uploadId,
    results[0].uploadId,
  );
});

test('partial put is compensated and failed retry retains identity without duplicate active records', async () => {
  const f = setup();
  const declaration = f.input();
  const upload = await f.begin(declaration);
  const key = f.metadata.rows.get(upload.uploadId).objectKey;
  f.objects.failPut = true;
  await assert.rejects(f.content(upload.uploadId), status(503));
  assert.equal(f.metadata.rows.get(upload.uploadId).state, 'failed');
  await assert.rejects(f.objects.get(key));
  await assert.rejects(f.finalize(upload.uploadId), status(409));
  assert.deepEqual(await f.begin(declaration), { ...upload, state: 'failed' });
  f.objects.failPut = false;
  await f.content(upload.uploadId);
  assert.equal((await f.finalize(upload.uploadId)).state, 'ready');
  assert.equal(f.metadata.rows.size, 1);
  assert.equal(f.metadata.rows.get(upload.uploadId).objectKey, key);
});

test('partial object whose cleanup fails stays failed and its next retry removes the orphan', async () => {
  const f = setup();
  const upload = await f.begin();
  const key = f.metadata.rows.get(upload.uploadId).objectKey;
  f.objects.failPut = true;
  f.objects.onPut = async () => {
    f.objects.failRemove = true;
  };
  await assert.rejects(f.content(upload.uploadId), status(503));
  assert.equal(f.metadata.rows.get(upload.uploadId).state, 'failed');
  assert.deepEqual(await f.objects.get(key), pdf);
  await assert.rejects(
    f.intake.read(patient, upload.documentId, 'view', allow),
    status(404),
  );
  f.objects.failPut = false;
  f.objects.failRemove = false;
  f.objects.onPut = undefined;
  await f.content(upload.uploadId);
  assert.equal((await f.finalize(upload.uploadId)).state, 'ready');
  assert.equal(f.metadata.rows.size, 1);
});

test('invalid retries against READY content leave original and metadata intact', async () => {
  const f = setup();
  const upload = await f.begin();
  await f.content(upload.uploadId);
  await f.finalize(upload.uploadId);
  const removals = f.objects.removals.length;
  const writes = f.objects.puts.length;
  await assert.rejects(
    f.content(upload.uploadId, Buffer.from('x'.repeat(pdf.length))),
    status(400),
  );
  assert.equal(f.objects.removals.length, removals);
  assert.equal(f.objects.puts.length, writes);
  assert.equal(f.metadata.rows.get(upload.uploadId).state, 'ready');
  assert.deepEqual(
    (await f.intake.read(patient, upload.documentId, 'view', allow)).bytes,
    pdf,
  );
});

test('cleanup failure keeps a failed recoverable manifest; metadata failure never deletes stored bytes', async () => {
  const f = setup();
  const upload = await f.begin();
  await f.content(upload.uploadId);
  const key = f.metadata.rows.get(upload.uploadId).objectKey;
  f.objects.failRemove = true;
  await assert.rejects(f.content(upload.uploadId), status(503));
  assert.equal(f.metadata.rows.get(upload.uploadId).state, 'failed');
  assert.deepEqual(await f.objects.get(key), pdf);
  f.objects.failRemove = false;
  await f.content(upload.uploadId);
  f.metadata.failReady = true;
  f.metadata.failFailed = true;
  await assert.rejects(f.finalize(upload.uploadId), status(503));
  // Simulates an uncertain READY write followed by a failed FAILED transition.
  // Preserve the verified original instead of producing READY without bytes.
  assert.deepEqual(await f.objects.get(key), pdf);
  f.metadata.failFailed = false;
  assert.equal((await f.finalize(upload.uploadId)).state, 'ready');
});

test('uncertain ready update compensates only after recording failed, and can recover', async () => {
  const f = setup();
  const upload = await f.begin();
  await f.content(upload.uploadId);
  f.metadata.failReady = true;
  await assert.rejects(f.finalize(upload.uploadId), status(503));
  assert.equal(f.metadata.rows.get(upload.uploadId).state, 'failed');
  await assert.rejects(
    f.objects.get(f.metadata.rows.get(upload.uploadId).objectKey),
  );
  await f.content(upload.uploadId);
  await f.finalize(upload.uploadId);
});

test('transaction rollback after finalize leaves verified bytes and a recoverable pending record', async () => {
  const f = setup();
  const upload = await f.begin();
  await f.content(upload.uploadId);
  f.metadata.failCommit = true;
  await assert.rejects(f.finalize(upload.uploadId), status(503));
  assert.equal(f.metadata.rows.get(upload.uploadId).state, 'pending');
  assert.deepEqual(
    await f.objects.get(f.metadata.rows.get(upload.uploadId).objectKey),
    pdf,
  );
  assert.equal((await f.finalize(upload.uploadId)).state, 'ready');
});

test('missing and corrupted objects never finalize or read successfully', async () => {
  const f = setup();
  const missing = await f.begin();
  await assert.rejects(f.finalize(missing.uploadId), status(503));
  assert.equal(f.metadata.rows.get(missing.uploadId).state, 'failed');
  const corrupt = await f.begin();
  await f.content(corrupt.uploadId);
  const row = f.metadata.rows.get(corrupt.uploadId);
  await f.objects.put(row.objectKey, Buffer.from('corrupt'), row.mimeType);
  await assert.rejects(f.finalize(corrupt.uploadId), status(503));
  assert.equal(f.metadata.rows.get(corrupt.uploadId).state, 'failed');
  await f.content(corrupt.uploadId);
  await f.finalize(corrupt.uploadId);
  await f.objects.put(row.objectKey, Buffer.from('corrupt'), row.mimeType);
  await assert.rejects(
    f.intake.read(patient, corrupt.documentId, 'view', allow),
    status(503),
  );
  const removes = f.objects.removals.length;
  await assert.rejects(f.finalize(corrupt.uploadId), status(503));
  assert.equal(f.objects.removals.length, removes);
});

test('same-upload content and finalize calls serialize across instances', async () => {
  const f = setup();
  const upload = await f.begin();
  const writing = deferred();
  const release = deferred();
  f.objects.onPut = async () => {
    writing.resolve();
    await release.promise;
  };
  const first = f.content(upload.uploadId);
  await writing.promise;
  const secondIntake = new DocumentIntake(f.metadata, f.objects);
  const retry = secondIntake.content(patient, upload.uploadId, pdf, allow);
  const finalize = secondIntake.finalize(patient, upload.uploadId, allow);
  release.resolve();
  const outcomes = await Promise.all([first, retry, finalize]);
  assert.deepEqual(
    outcomes.map((o) => o.state),
    ['pending', 'pending', 'ready'],
  );
  assert.equal(f.metadata.rows.size, 1);
  assert.equal(
    (
      await f.intake.read(patient, upload.documentId, 'view', allow)
    ).bytes.equals(pdf),
    true,
  );
});

test('content copies caller bytes before awaiting authorization', async () => {
  const f = setup();
  const upload = await f.begin();
  const input = Buffer.from(pdf);
  const entered = deferred();
  const release = deferred();
  const pending = f.content(upload.uploadId, input, async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  input.fill(0);
  release.resolve();
  await pending;
  await f.finalize(upload.uploadId);
  assert.deepEqual(
    (await f.intake.read(patient, upload.documentId, 'view', allow)).bytes,
    pdf,
  );
});

test('current category permission is required on begin, content and finalize', async () => {
  const f = setup();
  const denied = new Error('synthetic authorization denied');
  const deny = async () => {
    throw denied;
  };
  await assert.rejects(f.begin(f.input(), deny), (error) => error === denied);
  assert.equal(f.metadata.rows.size, 0);
  const upload = await f.begin();
  await assert.rejects(
    f.content(upload.uploadId, pdf, deny),
    (error) => error === denied,
  );
  assert.equal(f.objects.puts.length, 0);
  await f.content(upload.uploadId);
  await assert.rejects(
    f.finalize(upload.uploadId, deny),
    (error) => error === denied,
  );
  assert.equal(f.metadata.rows.get(upload.uploadId).state, 'pending');
});

test('revocation during get blocks finalize/read; view does not imply export', async () => {
  const f = setup();
  const upload = await f.begin();
  await f.content(upload.uploadId);
  let revoked = false;
  const denied = new Error('synthetic current permission denied');
  const auth = async (_patient, action) => {
    if (revoked || action === 'export') throw denied;
  };
  f.objects.onGet = async () => {
    revoked = true;
  };
  await assert.rejects(
    f.finalize(upload.uploadId, auth),
    (error) => error === denied,
  );
  assert.equal(f.metadata.rows.get(upload.uploadId).state, 'pending');
  f.objects.onGet = undefined;
  revoked = false;
  await f.finalize(upload.uploadId, auth);
  await assert.rejects(
    f.intake.read(patient, upload.documentId, 'export', auth),
    (error) => error === denied,
  );
  await f.intake.read(patient, upload.documentId, 'view', auth);
  f.objects.onGet = async () => {
    revoked = true;
  };
  await assert.rejects(
    f.intake.read(patient, upload.documentId, 'view', auth),
    (error) => error === denied,
  );
});

test('cross-patient and forged IDs do not read or write objects', async () => {
  const f = setup();
  const upload = await f.begin();
  const stranger = randomUUID();
  await assert.rejects(
    f.intake.content(stranger, upload.uploadId, pdf, allow),
    status(404),
  );
  await assert.rejects(
    f.intake.finalize(stranger, upload.uploadId, allow),
    status(404),
  );
  await assert.rejects(
    f.intake.read(stranger, upload.documentId, 'view', allow),
    status(404),
  );
  await assert.rejects(f.content(randomUUID()), status(404));
  assert.equal(f.objects.puts.length, 0);
  assert.equal(f.objects.gets.length, 0);
});

test('unconfigured object storage and database failures fail closed with sanitized errors', async () => {
  const disabled = setup(new UnavailableObjectStore());
  assert.equal(disabled.intake.storageReady, false);
  await assert.rejects(disabled.begin(), status(503));
  assert.equal(disabled.metadata.rows.size, 0);
  const f = setup();
  f.metadata.failCreate = true;
  await assert.rejects(
    f.begin(),
    (error) => status(503)(error) && !error.message.includes('sensitive'),
  );
  assert.equal(f.metadata.rows.size, 0);
});
