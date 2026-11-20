import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
export const backupSignatureNamespace = 'fmv-backup-completion-v1';
const failure = () =>
  new Error('Backup completion signature verification failed');

/** Authenticate exact manifest bytes against an independently trusted public key.
 * This does not validate manifest meaning, freshness or encrypted object receipts.
 * Never obtain the trusted key solely from the backup being checked.
 */
export async function verifyBackupCompletionSignature({
  manifest,
  signature,
  trustedPublicKey,
} = {}) {
  let directory;
  try {
    if (
      !Buffer.isBuffer(manifest) ||
      manifest.length < 1 ||
      manifest.length > 65536 ||
      !Buffer.isBuffer(signature) ||
      signature.length < 1 ||
      signature.length > 8192 ||
      typeof trustedPublicKey !== 'string' ||
      trustedPublicKey.length > 256 ||
      !/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(trustedPublicKey)
    )
      throw failure();
    // Freeze caller-owned buffers before awaiting filesystem operations.
    const bytes = Buffer.from(manifest),
      detached = Buffer.from(signature);
    directory = await mkdtemp(
      path.join(tmpdir(), 'fmv-signature-verification-'),
    );
    const signers = path.join(directory, 'allowed-signers'),
      sigfile = path.join(directory, 'manifest.sig');
    await writeFile(
      signers,
      `fmv-backup namespaces="${backupSignatureNamespace}" ${trustedPublicKey}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    await writeFile(sigfile, detached, { flag: 'wx', mode: 0o600 });
    const result = spawnSync(
      '/usr/bin/ssh-keygen',
      [
        '-Y',
        'verify',
        '-f',
        signers,
        '-I',
        'fmv-backup',
        '-n',
        backupSignatureNamespace,
        '-s',
        sigfile,
      ],
      {
        input: bytes,
        timeout: 5000,
        maxBuffer: 65536,
        env: { PATH: '/usr/bin:/bin', TMPDIR: directory },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    if (result.error || result.status !== 0) throw failure();
    return { signatureVerified: true };
  } catch {
    throw failure();
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
