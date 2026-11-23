import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
  encodeLedgerReceipt,
  ledgerReceiptNamespace,
  publishLedgerEvent,
  verifyLedgerReceipt,
} from '../backup/publish-ledger-event.mjs';

// Ephemeral in-memory test signing only. No key files, environment or transport.
const signing = generateKeyPairSync('ed25519'),
  wrongSigning = generateKeyPairSync('ed25519');
const publicPem = (key) => key.export({ format: 'pem', type: 'spki' });
const trustedPublicKey = publicPem(signing.publicKey);
const now = 1700000000000,
  destinationId = 'd'.repeat(32);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const objectKey = (value) =>
  `fmv-restore-evidence/v1/development/${value.ledgerId}/events/${value.eventId}.age`;
const failure =
  /^Error: Ledger publication unconfirmed; protection remains pending and restored services must remain closed\.$/;
const expectedFlags = {
  perEventReceiptVerified: true,
  exactVersionBytesVerified: true,
  independentHostingVerified: false,
  sourceLossCoverageVerified: false,
  immutabilityVerified: false,
  completionAuthorized: false,
  automaticReopenAllowed: false,
};
const artifact = () => {
  const ciphertext = Buffer.concat([
    Buffer.from('age-encryption.org/v1\n'),
    Buffer.alloc(160, 7),
  ]);
  return {
    environment: 'development',
    ledgerId: 'a'.repeat(32),
    policyId: id(1),
    eventId: id(2),
    recipientSha256: '1'.repeat(64),
    sourceSha256: '2'.repeat(64),
    payloadSha256: '3'.repeat(64),
    ciphertextSha256: hash(ciphertext),
    ciphertextBytes: ciphertext.length,
    ciphertext,
  };
};
const expected = (value = artifact(), providerVersionId = 'version_1') => ({
  format: 'fmv-ledger-object-receipt-v1',
  environment: value.environment,
  destinationId,
  ledgerId: value.ledgerId,
  policyId: value.policyId,
  eventId: value.eventId,
  recipientSha256: value.recipientSha256,
  sourceSha256: value.sourceSha256,
  payloadSha256: value.payloadSha256,
  ciphertextSha256: value.ciphertextSha256,
  ciphertextBytes: value.ciphertextBytes,
  objectKey: objectKey(value),
  providerVersionId,
});
const signed = (context, overrides = {}, privateKey = signing.privateKey) => {
  const receipt = encodeLedgerReceipt({
    ...context,
    verifiedAt: now - 1,
    ...overrides,
  });
  return {
    receipt,
    signature: sign(
      null,
      Buffer.concat([Buffer.from(ledgerReceiptNamespace), receipt]),
      privateKey,
    ),
  };
};
const verifyInput = () => {
  const context = expected();
  return { ...signed(context), trustedPublicKey, expected: context, now };
};
const fixture = ({ existing = false, uploadMode = 'normal' } = {}) => {
  const value = artifact(),
    calls = [],
    state = {
      versions: existing ? [{ versionId: 'version_1', action: 'upload' }] : [],
      bytes: existing ? Buffer.from(value.ciphertext) : undefined,
    };
  const record = (name, args, keys) => {
    calls.push(name);
    assert.deepEqual(Object.keys(args).sort(), [...keys, 'signal'].sort());
    assert.ok(args.signal instanceof globalThis.AbortSignal);
    if (name !== 'receipt') assert.equal(args.objectKey, objectKey(value));
  };
  const input = {
    artifact: value,
    destinationId,
    trustedPublicKey,
    now,
    discover: async (args) => {
      record('discover', args, ['objectKey']);
      return {
        paginationExhausted: true,
        versions: state.versions.map((entry) => ({ ...entry })),
      };
    },
    upload: async (args) => {
      record('upload', args, ['objectKey', 'ciphertext']);
      if (uploadMode !== 'fail-before-commit') {
        state.bytes = Buffer.from(args.ciphertext);
        state.versions = [{ versionId: 'version_1', action: 'upload' }];
      }
      if (uploadMode !== 'normal') throw Error('PRIVATE_CALLBACK_MARKER');
      return { ignoredAcknowledgement: 'PRIVATE_CALLBACK_MARKER' };
    },
    download: async (args) => {
      record('download', args, ['objectKey', 'versionId']);
      assert.equal(args.versionId, 'version_1');
      return Buffer.from(state.bytes);
    },
    obtainReceipt: async (args) => {
      record('receipt', args, ['expected']);
      assert.deepEqual(args.expected, expected(value));
      assert.equal(Object.hasOwn(args.expected, 'verifiedAt'), false);
      return signed(args.expected);
    },
  };
  return { input, value, state, calls };
};
const rejected = async (input) =>
  assert.rejects(publishLedgerEvent(input), failure);

test('receipt encoding is canonical and its signature is bound to the dedicated namespace', () => {
  assert.equal(ledgerReceiptNamespace, 'fmv.restore-ledger.receipt.v1\0');
  const context = expected(),
    value = { ...context, verifiedAt: now - 1 };
  const canonical = Buffer.from(JSON.stringify(value));
  assert.deepEqual(
    encodeLedgerReceipt(Object.fromEntries(Object.entries(value).reverse())),
    canonical,
  );
  const valid = verifyInput();
  assert.deepEqual(verifyLedgerReceipt(valid), {
    perEventReceiptVerified: true,
  });
  assert.throws(
    () =>
      verifyLedgerReceipt({
        ...valid,
        signature: sign(null, valid.receipt, signing.privateKey),
      }),
    failure,
  );
  assert.throws(
    () =>
      verifyLedgerReceipt({
        ...valid,
        signature: sign(
          null,
          Buffer.concat([Buffer.from('different-namespace\0'), valid.receipt]),
          signing.privateKey,
        ),
      }),
    failure,
  );
});

test('receipt verification rejects tampering, wrong pins, noncanonical JSON and mismatched expected context', () => {
  const valid = verifyInput();
  for (const patch of [
    { destinationId: 'e'.repeat(32) },
    { ledgerId: 'b'.repeat(32) },
    { policyId: id(3) },
    { eventId: id(4) },
    { environment: 'production' },
    { recipientSha256: '4'.repeat(64) },
    { sourceSha256: '5'.repeat(64) },
    { payloadSha256: '6'.repeat(64) },
    { ciphertextSha256: '7'.repeat(64) },
    { ciphertextBytes: valid.expected.ciphertextBytes + 1 },
    { providerVersionId: 'version_other' },
    { objectKey: valid.expected.objectKey + '.other' },
  ])
    assert.throws(
      () =>
        verifyLedgerReceipt({
          ...valid,
          expected: { ...valid.expected, ...patch },
        }),
      failure,
    );
  for (const [field, value] of [
    ['eventId', id(4)],
    ['destinationId', 'e'.repeat(32)],
  ]) {
    const nonEnumerable = { ...valid.expected };
    Object.defineProperty(nonEnumerable, field, { value, enumerable: false });
    assert.throws(
      () => verifyLedgerReceipt({ ...valid, expected: nonEnumerable }),
      failure,
    );
  }
  for (const patch of [
    { trustedPublicKey: publicPem(wrongSigning.publicKey) },
    { signature: Buffer.alloc(64) },
    { signature: Buffer.alloc(63) },
    { signature: new Uint8Array(64) },
    { receipt: Buffer.alloc(4097) },
    { receipt: Buffer.from(valid.receipt.toString() + '\n') },
    { receipt: Buffer.from('{malformed') },
    { expected: { ...valid.expected, extra: undefined } },
    { now: now - 2 },
    { now: undefined },
    { now: '1700000000000' },
  ])
    assert.throws(() => verifyLedgerReceipt({ ...valid, ...patch }), failure);
  const reordered = Buffer.from(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(JSON.parse(valid.receipt.toString())).reverse(),
      ),
    ),
  );
  assert.throws(
    () =>
      verifyLedgerReceipt({
        ...valid,
        receipt: reordered,
        signature: sign(
          null,
          Buffer.concat([Buffer.from(ledgerReceiptNamespace), reordered]),
          signing.privateKey,
        ),
      }),
    failure,
  );
  const changed = Buffer.from(valid.receipt);
  changed[changed.length - 2] ^= 1;
  assert.throws(
    () => verifyLedgerReceipt({ ...valid, receipt: changed }),
    failure,
  );
});

test('receipt encoding rejects private fields, coercion, bad identity and invalid timestamps', () => {
  const value = { ...expected(), verifiedAt: now - 1 };
  for (const patch of [
    { extra: undefined },
    { toJSON: () => value },
    { format: 'another-format' },
    { environment: 'production' },
    { destinationId: 'G'.repeat(32) },
    { ledgerId: ['a'.repeat(32)] },
    { policyId: [id(1)] },
    { eventId: [id(2)] },
    { ledgerId: 'b'.repeat(32) },
    { recipientSha256: 'invalid' },
    { ciphertextBytes: 127 },
    { ciphertextBytes: 65537 },
    { providerVersionId: 'invalid/version' },
    { providerVersionId: 'v'.repeat(257) },
    { verifiedAt: -1 },
    { verifiedAt: 1.5 },
    { verifiedAt: '1' },
  ])
    assert.throws(() => encodeLedgerReceipt({ ...value, ...patch }), failure);
  const accessor = { ...value };
  Object.defineProperty(accessor, 'ledgerId', {
    enumerable: true,
    get: () => {
      throw Error('PRIVATE_CALLBACK_MARKER');
    },
  });
  assert.throws(() => encodeLedgerReceipt(accessor), failure);
});

test('first publication uploads once, rediscovers and rechecks exact version before signing', async () => {
  const f = fixture();
  assert.deepEqual(await publishLedgerEvent(f.input), expectedFlags);
  assert.deepEqual(f.calls, [
    'discover',
    'upload',
    'discover',
    'download',
    'discover',
    'receipt',
  ]);
  assert.ok(f.state.bytes.equals(f.value.ciphertext));
});

test('replay verifies the existing object version without any upload', async () => {
  const f = fixture({ existing: true });
  assert.deepEqual(await publishLedgerEvent(f.input), expectedFlags);
  assert.deepEqual(f.calls, ['discover', 'download', 'discover', 'receipt']);
});

test('a trusted clock can advance before a freshly issued receipt is verified', async () => {
  const f = fixture({ existing: true }),
    observed = [];
  let clock = now;
  f.input.now = () => {
    observed.push(clock);
    return clock;
  };
  f.input.obtainReceipt = async ({ expected: context }) => {
    clock = now + 1000;
    return signed(context, { verifiedAt: clock });
  };
  assert.deepEqual(await publishLedgerEvent(f.input), expectedFlags);
  assert.equal(observed.at(-1), now + 1000);
});

test('lost acknowledgement recovers by one rediscovery; absent commit stays pending without blind upload retry', async () => {
  const recovered = fixture({ uploadMode: 'lost-ack' });
  assert.deepEqual(await publishLedgerEvent(recovered.input), expectedFlags);
  assert.deepEqual(recovered.calls, [
    'discover',
    'upload',
    'discover',
    'download',
    'discover',
    'receipt',
  ]);
  const absent = fixture({ uploadMode: 'fail-before-commit' });
  await rejected(absent.input);
  assert.deepEqual(absent.calls, ['discover', 'upload', 'discover']);
});

test('ambiguous versions, hide/start markers, bad IDs and incomplete discovery fail before object access', async () => {
  for (const versions of [
    [
      { versionId: 'one', action: 'upload' },
      { versionId: 'two', action: 'upload' },
    ],
    [
      { versionId: 'same', action: 'upload' },
      { versionId: 'same', action: 'upload' },
    ],
    ...['hide', 'start', 'other'].map((action) => [
      { versionId: 'one', action },
    ]),
    ...['', 'bad/id', 'x'.repeat(257), null].map((versionId) => [
      { versionId, action: 'upload' },
    ]),
    [{ versionId: 'one', action: 'upload', extra: undefined }],
    Array.from({ length: 101 }, (_, index) => ({
      versionId: `v${index}`,
      action: 'upload',
    })),
  ]) {
    const f = fixture({ existing: true });
    f.state.versions = versions;
    await rejected(f.input);
    assert.deepEqual(f.calls, ['discover']);
  }
  for (const result of [
    { paginationExhausted: false, versions: [] },
    { paginationExhausted: true, versions: null },
    { paginationExhausted: true, versions: [], extra: undefined },
  ]) {
    const f = fixture();
    f.input.discover = async () => result;
    await rejected(f.input);
    assert.deepEqual(f.calls, []);
  }
});

test('conflicting bytes and changed post-download version prevent receipt acquisition', async () => {
  const conflict = fixture({ existing: true });
  conflict.state.bytes[conflict.state.bytes.length - 1] ^= 1;
  await rejected(conflict.input);
  assert.deepEqual(conflict.calls, ['discover', 'download']);
  for (const versions of [
    [],
    [{ versionId: 'version_changed', action: 'upload' }],
    [
      { versionId: 'version_1', action: 'upload' },
      { versionId: 'version_new', action: 'upload' },
    ],
  ]) {
    const f = fixture({ existing: true }),
      download = f.input.download;
    f.input.download = async (args) => {
      const bytes = await download(args);
      f.state.versions = versions;
      return bytes;
    };
    await rejected(f.input);
    assert.deepEqual(f.calls, ['discover', 'download', 'discover']);
  }
});

test('a changed ciphertext for the same event conflicts at its unchanged event-only object key', async () => {
  const f = fixture({ existing: true }),
    priorKey = objectKey(f.value);
  f.value.ciphertext[f.value.ciphertext.length - 1] ^= 1;
  f.value.ciphertextSha256 = hash(f.value.ciphertext);
  assert.equal(objectKey(f.value), priorKey);
  assert.ok(!priorKey.includes(f.value.ciphertextSha256));
  await rejected(f.input);
  assert.deepEqual(f.calls, ['discover', 'download']);
});

test('untrusted receipts and adapter failures remain pending without exposing callback errors', async () => {
  for (const obtainReceipt of [
    async ({ expected: context }) => signed(context, { verifiedAt: now + 1 }),
    async ({ expected: context }) =>
      signed(context, { destinationId: 'e'.repeat(32) }),
    async ({ expected: context }) =>
      signed(context, {}, wrongSigning.privateKey),
    async () => {
      throw Error('PRIVATE_CALLBACK_MARKER');
    },
    async () => ({ receipt: Buffer.alloc(0), signature: Buffer.alloc(64) }),
  ]) {
    const f = fixture({ existing: true });
    f.input.obtainReceipt = obtainReceipt;
    await rejected(f.input);
    assert.equal(f.calls.includes('upload'), false);
  }
  for (const name of ['discover', 'download']) {
    const f = fixture({ existing: true });
    f.input[name] = async () => {
      throw Error('PRIVATE_CALLBACK_MARKER');
    };
    await rejected(f.input);
    assert.equal(f.calls.includes('receipt'), false);
  }
});

test('invalid artifact, key, destination and clock inputs reject before any adapter', async () => {
  const wrongType = publicPem(
    generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey,
  );
  for (const trustedPublicKey of [
    undefined,
    '',
    'invalid-key',
    '-----BEGIN PRIVATE KEY-----\nSYNTHETIC\n-----END PRIVATE KEY-----\n',
    wrongType,
  ]) {
    const f = fixture();
    await rejected({ ...f.input, trustedPublicKey });
    assert.deepEqual(f.calls, []);
  }
  for (const patch of [
    { environment: 'production' },
    { ledgerId: ['a'.repeat(32)] },
    { policyId: [id(1)] },
    { eventId: [id(2)] },
    { extra: undefined },
    { sourceSha256: 'invalid' },
    { payloadSha256: 'invalid' },
    { recipientSha256: 'invalid' },
    { ciphertextSha256: '0'.repeat(64) },
    { ciphertextBytes: 127 },
    { ciphertext: Buffer.alloc(181) },
    { ciphertext: new Uint8Array(181) },
  ]) {
    const f = fixture();
    await rejected({ ...f.input, artifact: { ...f.value, ...patch } });
    assert.deepEqual(f.calls, []);
  }
  for (const destinationId of [
    undefined,
    '',
    'G'.repeat(32),
    ['d'.repeat(32)],
  ]) {
    const f = fixture();
    await rejected({ ...f.input, destinationId });
    assert.deepEqual(f.calls, []);
  }
  for (const now of [
    undefined,
    null,
    -1,
    NaN,
    Infinity,
    '1700000000000',
    1.5,
  ]) {
    const f = fixture();
    await rejected({ ...f.input, now });
    assert.deepEqual(f.calls, []);
  }
});

test('caller and upload-adapter buffer mutation cannot change the staged bytes being verified', async () => {
  const caller = fixture(),
    original = Buffer.from(caller.value.ciphertext),
    discover = caller.input.discover;
  caller.input.discover = async (args) => {
    caller.value.ciphertext.fill(0);
    return discover(args);
  };
  assert.deepEqual(await publishLedgerEvent(caller.input), expectedFlags);
  assert.ok(caller.state.bytes.equals(original));
  const adapter = fixture(),
    upload = adapter.input.upload;
  adapter.input.upload = async (args) => {
    await upload(args);
    args.ciphertext.fill(0);
  };
  assert.deepEqual(await publishLedgerEvent(adapter.input), expectedFlags);
  assert.ok(adapter.state.bytes.equals(adapter.value.ciphertext));
});

test(
  'pre-cancelled and in-flight cancelled work rejects without later provider or signer calls',
  { timeout: 2000 },
  async () => {
    const pre = new globalThis.AbortController();
    pre.abort();
    const untouched = fixture();
    await rejected({ ...untouched.input, signal: pre.signal });
    assert.deepEqual(untouched.calls, []);
    const controller = new globalThis.AbortController(),
      f = fixture();
    let invoked = 0;
    f.input.discover = async ({ signal }) => {
      invoked++;
      assert.ok(signal instanceof globalThis.AbortSignal);
      controller.abort();
      return new Promise(() => {});
    };
    await rejected({ ...f.input, signal: controller.signal });
    assert.equal(invoked, 1);
    assert.deepEqual(f.calls, []);
  },
);
