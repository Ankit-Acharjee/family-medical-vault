import { Buffer } from 'node:buffer';
import { createHash, createPublicKey, verify } from 'node:crypto';

export const ledgerReceiptNamespace = 'fmv.restore-ledger.receipt.v1\0';
const prefix = 'fmv-restore-evidence/v1/development/';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const opaque = /^[a-f0-9]{32}$/;
const digest = /^[a-f0-9]{64}$/;
const version = /^[A-Za-z0-9_-]{1,256}$/;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const failure = () =>
  new Error(
    'Ledger publication unconfirmed; protection remains pending and restored services must remain closed.',
  );
const contextFields = [
  'environment',
  'ledgerId',
  'policyId',
  'eventId',
  'recipientSha256',
  'sourceSha256',
  'payloadSha256',
  'ciphertextSha256',
  'ciphertextBytes',
];
const receiptFields = [
  'format',
  'environment',
  'destinationId',
  'ledgerId',
  'policyId',
  'eventId',
  'recipientSha256',
  'sourceSha256',
  'payloadSha256',
  'ciphertextSha256',
  'ciphertextBytes',
  'objectKey',
  'providerVersionId',
  'verifiedAt',
];
// Reject hooks/accessors and unexpected fields before canonical serialization.
function exact(value, fields) {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== fields.length ||
    !fields.every(
      (key) =>
        Object.hasOwn(value, key) &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'),
    )
  )
    throw failure();
}
function context(value) {
  if (
    value.environment !== 'development' ||
    typeof value.ledgerId !== 'string' ||
    !opaque.test(value.ledgerId) ||
    typeof value.policyId !== 'string' ||
    !uuid.test(value.policyId) ||
    typeof value.eventId !== 'string' ||
    !uuid.test(value.eventId) ||
    ![
      'recipientSha256',
      'sourceSha256',
      'payloadSha256',
      'ciphertextSha256',
    ].every(
      (key) => typeof value[key] === 'string' && digest.test(value[key]),
    ) ||
    !Number.isSafeInteger(value.ciphertextBytes) ||
    value.ciphertextBytes < 128 ||
    value.ciphertextBytes > 65536
  )
    throw failure();
}
const keyFor = (value) =>
  prefix + value.ledgerId + '/events/' + value.eventId + '.age';
function publicKey(value) {
  // Accept public SPKI PEM only, never a private key or a key obtained from the receipt.
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    !/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\r\n]+\n-----END PUBLIC KEY-----\n?$/.test(
      value,
    )
  )
    throw failure();
  const key = createPublicKey(value);
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519')
    throw failure();
  return key;
}

export function encodeLedgerReceipt(value) {
  try {
    exact(value, receiptFields);
    context(value);
    if (
      value.format !== 'fmv-ledger-object-receipt-v1' ||
      typeof value.destinationId !== 'string' ||
      !opaque.test(value.destinationId) ||
      value.objectKey !== keyFor(value) ||
      typeof value.providerVersionId !== 'string' ||
      !version.test(value.providerVersionId) ||
      !Number.isSafeInteger(value.verifiedAt) ||
      value.verifiedAt < 0
    )
      throw failure();
    return Buffer.from(
      JSON.stringify(
        Object.fromEntries(receiptFields.map((key) => [key, value[key]])),
      ),
    );
  } catch {
    throw failure();
  }
}

/** Cryptographic binding to one observed object version, not proof of hosting,
 * immutable history, current-head freshness, source coverage or completion.
 */
export function verifyLedgerReceipt({
  receipt,
  signature,
  trustedPublicKey,
  expected,
  now,
} = {}) {
  try {
    if (
      !Buffer.isBuffer(receipt) ||
      receipt.length < 1 ||
      receipt.length > 4096 ||
      !Buffer.isBuffer(signature) ||
      signature.length !== 64 ||
      !Number.isSafeInteger(now) ||
      now < 0
    )
      throw failure();
    exact(
      expected,
      receiptFields.filter((field) => field !== 'verifiedAt'),
    );
    const bytes = Buffer.from(receipt),
      detached = Buffer.from(signature);
    const value = JSON.parse(bytes.toString('utf8'));
    if (
      !encodeLedgerReceipt(value).equals(bytes) ||
      value.verifiedAt > now ||
      !receiptFields
        .filter((field) => field !== 'verifiedAt')
        .every((field) => value[field] === expected[field]) ||
      !verify(
        null,
        Buffer.concat([Buffer.from(ledgerReceiptNamespace), bytes]),
        publicKey(trustedPublicKey),
        detached,
      )
    )
      throw failure();
    return { perEventReceiptVerified: true };
  } catch {
    throw failure();
  }
}

/** Portable orchestration only. Adapters must enforce trusted account/bucket,
 * exact-key complete bounded pagination, exact-version reads, transport limits
 * and independent signer custody. This module has no network/DB/keyfile access.
 * Retry scans first; at most one upload per invocation, never global exactly-once.
 */
export async function publishLedgerEvent({
  artifact,
  destinationId,
  trustedPublicKey,
  discover,
  upload,
  download,
  obtainReceipt,
  now,
  signal: callerSignal,
} = {}) {
  try {
    exact(artifact, [...contextFields, 'ciphertext']);
    context(artifact);
    if (
      typeof destinationId !== 'string' ||
      !opaque.test(destinationId) ||
      ![discover, upload, download, obtainReceipt].every(
        (fn) => typeof fn === 'function',
      ) ||
      (typeof now !== 'function' && (!Number.isSafeInteger(now) || now < 0)) ||
      !Buffer.isBuffer(artifact.ciphertext) ||
      artifact.ciphertext.length !== artifact.ciphertextBytes
    )
      throw failure();
    publicKey(trustedPublicKey);
    const ciphertext = Buffer.from(artifact.ciphertext);
    const ageHeader = Buffer.from('age-encryption.org/v1\n');
    if (
      !ciphertext.subarray(0, ageHeader.length).equals(ageHeader) ||
      hash(ciphertext) !== artifact.ciphertextSha256
    )
      throw failure();
    const frozen = Object.freeze(
      Object.fromEntries(
        contextFields.map((field) => [field, artifact[field]]),
      ),
    );
    const objectKey = keyFor(frozen);
    const deadline = globalThis.AbortSignal.timeout(30000);
    const signal =
      callerSignal === undefined
        ? deadline
        : globalThis.AbortSignal.any([deadline, callerSignal]);
    const call = async (fn, args) => {
      signal.throwIfAborted();
      let abort;
      try {
        return await Promise.race([
          Promise.resolve().then(() => {
            signal.throwIfAborted();
            return fn({ ...args, signal });
          }),
          new Promise((_, reject) => {
            abort = () => reject(failure());
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
          }),
        ]);
      } finally {
        if (abort) signal.removeEventListener('abort', abort);
      }
    };
    const scan = async () => {
      const result = await call(discover, { objectKey });
      exact(result, ['paginationExhausted', 'versions']);
      if (
        result.paginationExhausted !== true ||
        !Array.isArray(result.versions) ||
        result.versions.length > 1
      )
        throw failure();
      if (!result.versions.length) return null;
      const entry = result.versions[0];
      exact(entry, ['versionId', 'action']);
      if (
        entry.action !== 'upload' ||
        typeof entry.versionId !== 'string' ||
        !version.test(entry.versionId)
      )
        throw failure();
      return entry.versionId;
    };
    let selected = await scan();
    if (selected === null) {
      // A failed acknowledgement can still mean stored bytes. Do not retry upload.
      try {
        await call(upload, { objectKey, ciphertext: Buffer.from(ciphertext) });
      } catch {
        signal.throwIfAborted();
      }
      selected = await scan();
      if (selected === null) throw failure();
    }
    const bytes = await call(download, { objectKey, versionId: selected });
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length !== frozen.ciphertextBytes ||
      !Buffer.from(bytes).equals(ciphertext) ||
      hash(bytes) !== frozen.ciphertextSha256 ||
      (await scan()) !== selected
    )
      throw failure();
    const expected = Object.freeze({
      format: 'fmv-ledger-object-receipt-v1',
      environment: frozen.environment,
      destinationId,
      ...Object.fromEntries(
        contextFields
          .filter((field) => field !== 'environment')
          .map((field) => [field, frozen[field]]),
      ),
      objectKey,
      providerVersionId: selected,
    });
    const signed = await call(obtainReceipt, { expected });
    exact(signed, ['receipt', 'signature']);
    verifyLedgerReceipt({
      ...signed,
      trustedPublicKey,
      expected,
      now: typeof now === 'function' ? now() : now,
    });
    signal.throwIfAborted();
    return {
      perEventReceiptVerified: true,
      exactVersionBytesVerified: true,
      independentHostingVerified: false,
      sourceLossCoverageVerified: false,
      immutabilityVerified: false,
      completionAuthorized: false,
      automaticReopenAllowed: false,
    };
  } catch {
    throw failure();
  }
}
