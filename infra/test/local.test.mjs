import assert from 'node:assert/strict';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  readLocalEnvironment,
  setupLocalEnvironment,
} from '../scripts/local.mjs';

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'fmv-local-config-test-'));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('setup creates private distinct random credentials and preserves them on retry', () =>
  fixture((directory) => {
    setupLocalEnvironment(directory);
    const before = readFileSync(join(directory, 'compose.env'), 'utf8');
    const values = readLocalEnvironment(directory);
    assert.ok(/^[a-f0-9]{64}$/.test(values.LOCAL_DB_OWNER_PASSWORD));
    assert.ok(/^[a-f0-9]{64}$/.test(values.LOCAL_DB_APP_PASSWORD));
    assert.ok(values.LOCAL_DB_OWNER_PASSWORD !== values.LOCAL_DB_APP_PASSWORD);
    assert.equal(lstatSync(directory).mode & 0o777, 0o700);
    assert.equal(lstatSync(join(directory, 'compose.env')).mode & 0o777, 0o600);
    setupLocalEnvironment(directory);
    assert.ok(before === readFileSync(join(directory, 'compose.env'), 'utf8'));
  }));

test('insecure file permissions fail closed and existing credentials stay untouched', () =>
  fixture((directory) => {
    setupLocalEnvironment(directory);
    const path = join(directory, 'compose.env');
    const before = readFileSync(path, 'utf8');
    chmodSync(path, 0o644);
    assert.throws(
      () => setupLocalEnvironment(directory),
      /private regular file/,
    );
    assert.ok(before === readFileSync(path, 'utf8'));
  }));

test('symlinked configuration and directories are rejected', () =>
  fixture((directory) => {
    setupLocalEnvironment(directory);
    const config = join(directory, 'compose.env');
    const content = readFileSync(config, 'utf8');
    rmSync(config);
    writeFileSync(join(directory, 'original.env'), content, { mode: 0o600 });
    symlinkSync(join(directory, 'original.env'), config);
    assert.throws(
      () => readLocalEnvironment(directory),
      /private regular file/,
    );
    const link = join(directory, 'alias');
    symlinkSync(directory, link);
    assert.throws(() => readLocalEnvironment(link), /not a symlink/);
  }));

test('malformed, duplicate and extra configuration keys fail without echoing their contents', () =>
  fixture((directory) => {
    setupLocalEnvironment(directory);
    const path = join(directory, 'compose.env');
    const original = readFileSync(path, 'utf8');
    for (const content of [
      'SYNTHETIC_SECRET=do-not-echo\n',
      `${original}EXTRA=value\n`,
      `${original}LOCAL_API_PORT=3001\n`,
      original.replace('3000', '99999'),
    ]) {
      writeFileSync(path, content);
      assert.throws(
        () => readLocalEnvironment(directory),
        (error) => {
          assert.equal(error.message.includes('do-not-echo'), false);
          return /configuration is invalid/.test(error.message);
        },
      );
    }
  }));
