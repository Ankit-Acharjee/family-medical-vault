import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { backupSignatureNamespace } from '../backup/verify-signature.mjs';
import {
  encodeBackupCompletion,
  verifySignedBackupCompletion,
} from '../backup/completion-manifest.mjs';
const ciphertext = Buffer.from('synthetic ciphertext representation only');
const value = () => ({
  format: 'fmv-encrypted-recovery-v1',
  environment: 'development',
  setId: 'a'.repeat(32),
  completedAt: 1000,
  ciphertextBytes: ciphertext.length,
  ciphertextSha256: createHash('sha256').update(ciphertext).digest('hex'),
});
test('completion encoder rejects private/extra fields, invalid hashes and unsafe sizes', () => {
  for (const item of [
    null,
    { ...value(), patientId: 'private' },
    { ...value(), environment: 'production' },
    { ...value(), ciphertextBytes: 0 },
    { ...value(), completedAt: NaN },
    { ...value(), ciphertextSha256: 'bad' },
  ])
    assert.throws(
      () => encodeBackupCompletion(item),
      /^Error: Backup completion validation failed$/,
    );
  assert.deepEqual(JSON.parse(encodeBackupCompletion(value())), value());
});
test('signed completion binds exact selected set, time and actual ciphertext measurement', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'fmv-completion-fixture-'),
  );
  try {
    const key = path.join(directory, 'synthetic-key');
    const run = (args, input) => {
      const r = spawnSync('/usr/bin/ssh-keygen', args, {
        input,
        timeout: 5000,
        maxBuffer: 65536,
        env: { PATH: '/usr/bin:/bin', TMPDIR: directory },
      });
      assert.ok(
        !r.error && r.status === 0,
        'Synthetic completion signing must succeed (output suppressed)',
      );
      return r.stdout;
    };
    run(['-q', '-t', 'ed25519', '-N', '', '-C', 'synthetic', '-f', key]);
    const trustedPublicKey = (await readFile(key + '.pub', 'utf8'))
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(' ');
    const sign = (manifest) =>
      run(['-Y', 'sign', '-f', key, '-n', backupSignatureNamespace], manifest);
    const manifest = encodeBackupCompletion(value());
    const args = {
      manifest,
      signature: sign(manifest),
      trustedPublicKey,
      expectedSetId: value().setId,
      now: 1000,
      observedCiphertext: {
        bytes: ciphertext.length,
        sha256: value().ciphertextSha256,
      },
    };
    assert.deepEqual(await verifySignedBackupCompletion(args), value());
    const copiedManifest = Buffer.from(manifest),
      copiedSignature = Buffer.from(args.signature);
    const observed = { ...args.observedCiphertext };
    const pending = verifySignedBackupCompletion({
      ...args,
      manifest: copiedManifest,
      signature: copiedSignature,
      observedCiphertext: observed,
    });
    copiedManifest.fill(0);
    copiedSignature.fill(0);
    observed.bytes = 0;
    assert.deepEqual(
      await pending,
      value(),
      'Caller mutation after invocation must not change verified inputs',
    );
    const rejected = (input) =>
      assert.rejects(
        verifySignedBackupCompletion(input),
        /^Error: Backup completion validation failed$/,
      );
    await rejected({ ...args, expectedSetId: 'b'.repeat(32) });
    await rejected({ ...args, now: 999 });
    await rejected({
      ...args,
      observedCiphertext: {
        ...args.observedCiphertext,
        bytes: ciphertext.length + 1,
      },
    });
    await rejected({
      ...args,
      observedCiphertext: {
        ...args.observedCiphertext,
        sha256: 'b'.repeat(64),
      },
    });
    for (const raw of [
      Buffer.from(manifest.toString() + '\n'),
      Buffer.from('{"format":"wrong",' + manifest.toString().slice(1)),
      Buffer.from(JSON.stringify({ ...value(), title: 'private' })),
      Buffer.from('not JSON'),
    ])
      await rejected({ ...args, manifest: raw, signature: sign(raw) });
    await rejected({ ...args, signature: Buffer.from('untrusted') });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
