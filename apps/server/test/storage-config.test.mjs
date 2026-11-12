import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storageConfig } from '../dist/documents/storage.config.js';

const enabled = {
  R2_ENABLED: 'true',
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  R2_BUCKET: 'fmv-synthetic-private',
  R2_ACCESS_KEY_ID: 'synthetic-access-key',
  R2_SECRET_ACCESS_KEY: 'synthetic-secret-key',
};

function rejectsConfiguration(env) {
  assert.throws(
    () => storageConfig(env),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /configuration|storage/i);
      for (const value of Object.values(env)) {
        if (typeof value === 'string' && value.length >= 10)
          assert.equal(error.message.includes(value), false);
      }
      assert.equal(error.cause, undefined);
      return true;
    },
  );
}

test('storage stays unavailable unless explicitly enabled', () => {
  assert.equal(storageConfig({}), null);
  assert.equal(storageConfig({ R2_ENABLED: 'false' }), null);
  assert.equal(storageConfig({ ...enabled, R2_ENABLED: 'false' }), null);
  assert.equal(
    storageConfig({ R2_ACCOUNT_ID: 'incomplete-and-invalid' }),
    null,
  );
});

test('enabled storage returns only explicit server credentials and bucket identity', () => {
  assert.deepEqual(storageConfig(enabled), {
    accountId: enabled.R2_ACCOUNT_ID,
    bucket: enabled.R2_BUCKET,
    accessKeyId: enabled.R2_ACCESS_KEY_ID,
    secretAccessKey: enabled.R2_SECRET_ACCESS_KEY,
  });
  for (const bucket of ['a-b', 'abc', 'a'.repeat(63)])
    assert.equal(
      storageConfig({ ...enabled, R2_BUCKET: bucket }).bucket,
      bucket,
    );
});

test('mistyped enable flags fail closed instead of silently disabling storage', () => {
  for (const flag of ['', 'TRUE', 'True', '1', 'yes', ' true', 'false '])
    rejectsConfiguration({ ...enabled, R2_ENABLED: flag });
});

test('every required enabled setting must be present', () => {
  for (const key of Object.keys(enabled).filter(
    (key) => key !== 'R2_ENABLED',
  )) {
    const missing = { ...enabled };
    delete missing[key];
    rejectsConfiguration(missing);
    rejectsConfiguration({ ...enabled, [key]: '' });
  }
});

test('account and bucket cannot supply endpoints, paths, or invalid provider identities', () => {
  for (const account of [
    'a'.repeat(31),
    'a'.repeat(33),
    'A'.repeat(32),
    'g'.repeat(32),
    'https://synthetic.invalid',
    'a'.repeat(32) + '/path',
  ])
    rejectsConfiguration({ ...enabled, R2_ACCOUNT_ID: account });
  for (const bucket of [
    'ab',
    'a'.repeat(64),
    '-abc',
    'abc-',
    'ABC',
    'abc_def',
    'abc.def',
    '127.0.0.1',
    'abc/path',
    'https://synthetic.invalid',
    'abc\n',
  ])
    rejectsConfiguration({ ...enabled, R2_BUCKET: bucket });
});

test('credentials reject whitespace, controls, and excessive length without exposing values', () => {
  for (const key of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    for (const value of [
      ' ',
      '\t',
      ' leading-secret',
      'trailing-secret ',
      'embedded secret',
      'synthetic\nsecret',
      'synthetic\u0000secret',
      'synthetic\u007fsecret',
      'x'.repeat(257),
    ]) {
      rejectsConfiguration({ ...enabled, [key]: value });
    }
  }
});

test('browser exposure and arbitrary endpoint/public URL settings are rejected even while disabled', () => {
  for (const key of [
    'VITE_R2_ACCOUNT_ID',
    'VITE_R2_ACCESS_KEY_ID',
    'VITE_R2_SECRET_ACCESS_KEY',
    'VITE_R2_BUCKET',
    'VITE_R2_ANY_FUTURE_SETTING',
    'R2_ENDPOINT',
    'R2_PUBLIC_URL',
  ]) {
    for (const flag of ['true', 'false'])
      rejectsConfiguration({
        ...enabled,
        R2_ENABLED: flag,
        [key]: 'synthetic-sensitive-setting',
      });
  }
});
