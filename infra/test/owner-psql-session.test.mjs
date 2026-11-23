import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL } from 'node:url';
import { developmentLedgerTarget } from '../backup/ledger-policy.mjs';
import {
  ownerPasswordEntry,
  withOwnerPasswordFile,
} from '../backup/owner-psql-session.mjs';

const failure = /^Error: Private development owner session is unavailable$/;
const address = (password = 'synthetic-test-only') => {
  // Construct synthetic components separately; never use a real connection URI.
  const url = new URL('postgresql://example.invalid/postgres');
  url.hostname = 'aws-0-ap-south-1.pooler.supabase.com';
  url.port = '5432';
  url.username = `postgres.${developmentLedgerTarget}`;
  url.password = encodeURIComponent(password);
  url.searchParams.set('schema', 'fmv');
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set('sslrootcert', '/synthetic/public-root-ca.crt');
  return url;
};
const entryPrefix = (url) => `${url.hostname}:5432:postgres:${url.username}:`;
const removed = async (filename, directory) => {
  await assert.rejects(lstat(filename), { code: 'ENOENT' });
  await assert.rejects(lstat(directory), { code: 'ENOENT' });
};

test('password entry decodes exactly once and escapes libpq colon and backslash delimiters', () => {
  const url = address('synthetic:colon\\slash');
  assert.equal(
    ownerPasswordEntry(url.href),
    entryPrefix(url) + 'synthetic\\:colon\\\\slash\n',
  );
  url.password = 'synthetic%3Aencoded%5Cslash%25percent%20space%40at';
  assert.equal(
    ownerPasswordEntry(url.href),
    entryPrefix(url) + 'synthetic\\:encoded\\\\slash%percent space@at\n',
  );
  const once = address('synthetic%3Aliteral');
  assert.equal(
    ownerPasswordEntry(once.href),
    entryPrefix(once) + 'synthetic%3Aliteral\n',
  );
});

test('password entry rejects decoded CR, LF, NUL and malformed percent encoding', () => {
  for (const password of [
    'synthetic\rsegment',
    'synthetic\nsegment',
    'synthetic\0segment',
    'synthetic\r\nsegment',
  ])
    assert.throws(() => ownerPasswordEntry(address(password).href), failure);
  const malformed = address();
  malformed.password = 'synthetic%zz';
  assert.throws(() => ownerPasswordEntry(malformed.href), failure);
});

test('only the pinned development owner and fixed TLS parameters are accepted', () => {
  for (const username of [
    'postgres',
    'postgres.anotherproject',
    `fmv_app.${developmentLedgerTarget}`,
    `fmv_ledger_worker.${developmentLedgerTarget}`,
  ]) {
    const url = address();
    url.username = username;
    assert.throws(() => ownerPasswordEntry(url.href), failure);
  }
  for (const [field, value] of [
    ['hostname', '127.0.0.1'],
    ['hostname', 'pooler.supabase.com.unapproved.example.test'],
    ['port', '6543'],
    ['pathname', '/another'],
    ['password', ''],
    ['hash', '#override'],
  ]) {
    const url = address();
    url[field] = value;
    assert.throws(() => ownerPasswordEntry(url.href), failure);
  }
  for (const protocol of ['postgres:', 'https:'])
    assert.throws(
      () =>
        ownerPasswordEntry(address().href.replace(/^postgresql:/, protocol)),
      failure,
    );
  for (const [key, value] of [
    ['schema', 'public'],
    ['sslmode', 'require'],
    ['sslrootcert', ''],
  ]) {
    const url = address();
    url.searchParams.set(key, value);
    assert.throws(() => ownerPasswordEntry(url.href), failure);
  }
  for (const key of ['schema', 'sslmode', 'sslrootcert']) {
    const missing = address();
    missing.searchParams.delete(key);
    assert.throws(() => ownerPasswordEntry(missing.href), failure);
    const duplicate = address();
    duplicate.searchParams.append(key, duplicate.searchParams.get(key));
    assert.throws(() => ownerPasswordEntry(duplicate.href), failure);
  }
  for (const key of [
    'options',
    'host',
    'user',
    'password',
    'service',
    'sslkey',
  ]) {
    const url = address();
    url.searchParams.append(key, 'synthetic');
    assert.throws(() => ownerPasswordEntry(url.href), failure);
  }
});

test('private password file uses mode600 in mode700 directory and never passes a password through arguments or environment', async () => {
  const password = 'synthetic:private\\session',
    url = address(password),
    expectedResult = {};
  let filename, directory;
  const inheritedEnvironment = process.env;
  // Replace the environment object with mock values without reading any secret.
  process.env = {
    PATH: '/synthetic/untrusted',
    PGPASSWORD: 'synthetic-inherited-password',
    PGSERVICE: 'synthetic-inherited-service',
    PGSERVICEFILE: '/synthetic/inherited-service-file',
  };
  try {
    const result = await withOwnerPasswordFile(url.href, async (session) => {
      assert.ok(Object.isFrozen(session));
      filename = session.env.PGPASSFILE;
      directory = path.dirname(filename);
      assert.ok(path.isAbsolute(filename));
      const fileStat = await lstat(filename),
        directoryStat = await lstat(directory);
      assert.ok(fileStat.isFile() && !fileStat.isSymbolicLink());
      assert.ok(directoryStat.isDirectory() && !directoryStat.isSymbolicLink());
      assert.equal(fileStat.mode & 0o777, 0o600);
      assert.equal(directoryStat.mode & 0o777, 0o700);
      assert.equal(
        await readFile(filename, 'utf8'),
        ownerPasswordEntry(url.href),
      );
      assert.deepEqual(session.args, [
        '--no-psqlrc',
        '--set=ON_ERROR_STOP=1',
        '--host=' + url.hostname,
        '--port=5432',
        '--dbname=postgres',
        '--username=' + url.username,
      ]);
      assert.deepEqual(session.env, {
        PATH: '/usr/bin:/bin',
        PGPASSFILE: filename,
        PGSSLMODE: 'verify-full',
        PGSSLROOTCERT: '/synthetic/public-root-ca.crt',
        PGOPTIONS: '-c timezone=UTC',
        PGAPPNAME: 'fmv-development-private-owner-session',
      });
      for (const value of [...session.args, ...Object.values(session.env)]) {
        assert.ok(
          !value.includes(password) &&
            !value.includes(encodeURIComponent(password)),
        );
        assert.ok(!value.includes('synthetic-inherited'));
      }
      for (const name of ['PGPASSWORD', 'PGSERVICE', 'PGSERVICEFILE'])
        assert.equal(Object.hasOwn(session.env, name), false);
      return expectedResult;
    });
    assert.equal(result, expectedResult);
  } finally {
    process.env = inheritedEnvironment;
  }
  await removed(filename, directory);
});

test('callback errors are sanitized and remove both private file and directory', async () => {
  let filename, directory;
  await assert.rejects(
    withOwnerPasswordFile(address().href, async (session) => {
      filename = session.env.PGPASSFILE;
      directory = path.dirname(filename);
      assert.ok((await lstat(filename)).isFile());
      throw Error('Synthetic callback marker must not escape');
    }),
    failure,
  );
  await removed(filename, directory);
});

test('invalid target never invokes the session callback', async () => {
  let called = false;
  const url = address();
  url.searchParams.set('options', 'synthetic-override');
  await assert.rejects(
    withOwnerPasswordFile(url.href, async () => {
      called = true;
    }),
    failure,
  );
  assert.equal(called, false);
});
