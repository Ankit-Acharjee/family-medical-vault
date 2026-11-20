import { Buffer } from 'node:buffer';
import { verifyBackupCompletionSignature } from './verify-signature.mjs';
const fail = () => new Error('Backup completion validation failed');
const fields = [
  'format',
  'environment',
  'setId',
  'completedAt',
  'ciphertextBytes',
  'ciphertextSha256',
];
function validate(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...fields].sort().join(',') ||
    value.format !== 'fmv-encrypted-recovery-v1' ||
    value.environment !== 'development' ||
    typeof value.setId !== 'string' ||
    !/^[a-f0-9]{32}$/.test(value.setId) ||
    !Number.isSafeInteger(value.completedAt) ||
    value.completedAt < 0 ||
    !Number.isSafeInteger(value.ciphertextBytes) ||
    value.ciphertextBytes < 1 ||
    typeof value.ciphertextSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.ciphertextSha256)
  )
    throw fail();
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

/** Fixed-order UTF-8 JSON prevents duplicate-key and parser ambiguity.
 * Metadata contains no patient IDs, filenames, plaintext hashes or source keys.
 */
export function encodeBackupCompletion(value) {
  try {
    return Buffer.from(JSON.stringify(validate(value)), 'utf8');
  } catch {
    throw fail();
  }
}

/** expectedSetId comes from an independent trusted selection/catalog, not this
 * manifest. observedCiphertext describes bytes actually read/hashed by caller.
 * This verifies a selected artifact, not latest-backup status or restore safety.
 */
export async function verifySignedBackupCompletion({
  manifest,
  signature,
  trustedPublicKey,
  expectedSetId,
  observedCiphertext,
  now,
} = {}) {
  try {
    if (
      !Buffer.isBuffer(manifest) ||
      manifest.length < 1 ||
      manifest.length > 65536 ||
      !Number.isSafeInteger(now) ||
      now < 0 ||
      typeof expectedSetId !== 'string' ||
      !/^[a-f0-9]{32}$/.test(expectedSetId)
    )
      throw fail();
    if (
      !observedCiphertext ||
      typeof observedCiphertext !== 'object' ||
      Object.keys(observedCiphertext).sort().join(',') !== 'bytes,sha256'
    )
      throw fail();
    const observed = Object.freeze({
      bytes: observedCiphertext.bytes,
      sha256: observedCiphertext.sha256,
    });
    const bytes = Buffer.from(manifest);
    await verifyBackupCompletionSignature({
      manifest: bytes,
      signature,
      trustedPublicKey,
    });
    const value = validate(JSON.parse(bytes.toString('utf8')));
    if (
      !encodeBackupCompletion(value).equals(bytes) ||
      value.completedAt > now ||
      value.setId !== expectedSetId ||
      observed.bytes !== value.ciphertextBytes ||
      observed.sha256 !== value.ciphertextSha256
    )
      throw fail();
    return Object.freeze(value);
  } catch {
    throw fail();
  }
}
