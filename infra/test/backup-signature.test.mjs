import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import {
  backupSignatureNamespace,
  verifyBackupCompletionSignature,
} from '../backup/verify-signature.mjs';
const rejected = (promise) =>
  assert.rejects(
    promise,
    /^Error: Backup completion signature verification failed$/,
  );
test('standard SSH signatures require exact bytes, trusted signer and backup namespace', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'fmv-signature-fixture-'),
  );
  try {
    const run = (args, input) => {
      const r = spawnSync('/usr/bin/ssh-keygen', args, {
        input,
        timeout: 5000,
        maxBuffer: 65536,
        env: { PATH: '/usr/bin:/bin', TMPDIR: directory },
      });
      assert.ok(
        !r.error && r.status === 0,
        'Synthetic signing command must succeed (output suppressed)',
      );
      return r.stdout;
    };
    const first = path.join(directory, 'first'),
      other = path.join(directory, 'other');
    for (const key of [first, other])
      run(['-q', '-t', 'ed25519', '-N', '', '-C', 'synthetic', '-f', key]);
    const publicKey = async (key) =>
      (await readFile(key + '.pub', 'utf8'))
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .join(' ');
    const trustedPublicKey = await publicKey(first);
    const manifest = Buffer.from(
      '{"fixture":"synthetic-completion","ciphertextSha256":"not-a-real-manifest"}',
    );
    const sign = (key, namespace, value) =>
      run(['-Y', 'sign', '-f', key, '-n', namespace], value);
    const signature = sign(first, backupSignatureNamespace, manifest);
    assert.deepEqual(
      await verifyBackupCompletionSignature({
        manifest,
        signature,
        trustedPublicKey,
      }),
      { signatureVerified: true },
    );
    await rejected(
      verifyBackupCompletionSignature({
        manifest: Buffer.concat([manifest, Buffer.from(' ')]),
        signature,
        trustedPublicKey,
      }),
    );
    await rejected(
      verifyBackupCompletionSignature({
        manifest,
        signature,
        trustedPublicKey: await publicKey(other),
      }),
    );
    await rejected(
      verifyBackupCompletionSignature({
        manifest,
        signature: sign(other, backupSignatureNamespace, manifest),
        trustedPublicKey,
      }),
    );
    await rejected(
      verifyBackupCompletionSignature({
        manifest,
        signature: sign(first, 'other-purpose', manifest),
        trustedPublicKey,
      }),
    );
    await rejected(
      verifyBackupCompletionSignature({
        manifest,
        signature: Buffer.from('invalid-signature'),
        trustedPublicKey,
      }),
    );
    await rejected(
      verifyBackupCompletionSignature({
        manifest,
        signature,
        trustedPublicKey: trustedPublicKey + '\nmalicious extra signer',
      }),
    );
    await rejected(
      verifyBackupCompletionSignature({
        manifest: Buffer.alloc(65537),
        signature,
        trustedPublicKey,
      }),
    );
    await rejected(
      verifyBackupCompletionSignature({
        manifest,
        signature: Buffer.alloc(8193),
        trustedPublicKey,
      }),
    );
    await rejected(
      verifyBackupCompletionSignature({
        manifest: 'not bytes',
        signature,
        trustedPublicKey,
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
