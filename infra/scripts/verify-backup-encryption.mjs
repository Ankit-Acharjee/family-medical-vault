import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { withTool, CheckError } from '../ci/tools.mjs';

export async function verifyBackupEncryption() {
  return withTool('age', async (age) => {
    const directory = dirname(age),
      keygen = join(directory, 'age-keygen');
    const run = (binary, args) => {
      const result = spawnSync(binary, args, {
        encoding: 'utf8',
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: directory },
      });
      if (result.error || result.status !== 0)
        throw new CheckError(
          'Backup encryption verification failed. No key material printed.',
        );
      return result.stdout.trim();
    };
    if (run(age, ['--version']) !== 'v1.3.2')
      throw new CheckError('Unexpected backup encryption version.');
    const identity = join(directory, 'synthetic-identity'),
      original = join(directory, 'synthetic-input'),
      encrypted = join(directory, 'synthetic.age'),
      restored = join(directory, 'synthetic-restored');
    const expected =
      'Synthetic backup encryption verification. No records or credentials.';
    await writeFile(original, expected, { mode: 0o600, flag: 'wx' });
    run(keygen, ['-o', identity]);
    const recipient = run(keygen, ['-y', identity]);
    run(age, [
      '--encrypt',
      '--recipient',
      recipient,
      '--output',
      encrypted,
      original,
    ]);
    run(age, [
      '--decrypt',
      '--identity',
      identity,
      '--output',
      restored,
      encrypted,
    ]);
    if ((await readFile(restored, 'utf8')) !== expected)
      throw new CheckError('Backup encryption round-trip failed.');
    const ciphertext = await readFile(encrypted);
    if (ciphertext.includes(Buffer.from(expected)))
      throw new CheckError('Backup encryption exposed plaintext.');
    ciphertext[ciphertext.length - 1] ^= 1;
    const tampered = join(directory, 'tampered.age');
    await writeFile(tampered, ciphertext, { mode: 0o600, flag: 'wx' });
    const bad = spawnSync(
      age,
      [
        '--decrypt',
        '--identity',
        identity,
        '--output',
        join(directory, 'tampered-restored'),
        tampered,
      ],
      {
        encoding: 'utf8',
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: directory },
      },
    );
    if (bad.error || bad.status !== 1)
      throw new CheckError('Backup tamper detection could not be verified.');
    return {
      tool: 'age',
      version: '1.3.2',
      roundTrip: true,
      tamperRejected: true,
      realRecoveryIdentityCreated: false,
    };
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  verifyBackupEncryption()
    .then((result) => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch(() => {
      process.stderr.write(
        'Backup encryption verification failed; no key material printed.\n',
      );
      process.exitCode = 1;
    });
}
