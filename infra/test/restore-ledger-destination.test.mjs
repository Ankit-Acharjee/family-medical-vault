import test from 'node:test';
import assert from 'node:assert/strict';
import {
  restoreLedgerDestinationConfig,
  checkRestoreLedgerDestination,
  checkRestoreLedgerVersionDiscovery,
} from '../backup/b2-preflight.mjs';
const env = {
  BACKUP_ENABLED: 'false',
  BACKUP_LEDGER_ENABLED: 'false',
  BACKUP_B2_BUCKET: 'synthetic-backups',
  BACKUP_LEDGER_B2_BUCKET: 'synthetic-ledger',
  BACKUP_LEDGER_B2_ENDPOINT: 'https://s3.us-east-005.backblazeb2.com',
  BACKUP_LEDGER_B2_READ_KEY_ID: 'fixture-ledger-id',
  BACKUP_LEDGER_B2_READ_APPLICATION_KEY: 'fixture-ledger-key',
};
const auth = () => ({
  accountId: 'fixture-account',
  authorizationToken: 'fixture-token',
  applicationKeyExpirationTimestamp: null,
  apiInfo: {
    storageApi: {
      apiUrl: 'https://api005.backblazeb2.com',
      s3ApiUrl: env.BACKUP_LEDGER_B2_ENDPOINT,
      allowed: {
        buckets: [{ id: 'fixture-bucket', name: env.BACKUP_LEDGER_B2_BUCKET }],
        capabilities: [
          'listBuckets',
          'listFiles',
          'readFiles',
          'readBucketLifecycleRules',
        ],
        namePrefix: 'fmv-restore-evidence/v1/development/',
      },
    },
  },
});
const result = () => ({
  buckets: [
    {
      accountId: 'fixture-account',
      bucketId: 'fixture-bucket',
      bucketName: env.BACKUP_LEDGER_B2_BUCKET,
      bucketType: 'allPrivate',
      lifecycleRules: [],
    },
  ],
});
const response = (value) =>
  new globalThis.Response(JSON.stringify(value), { status: 200 });
function fixture(first = auth(), second = result()) {
  const calls = [];
  return {
    calls,
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return response(calls.length === 1 ? first : second);
    },
  };
}
test('ledger config requires separate explicit credentials and disabled execution', () => {
  const config = restoreLedgerDestinationConfig(env);
  assert.equal(config.bucket, env.BACKUP_LEDGER_B2_BUCKET);
  for (const extra of [
    { BACKUP_LEDGER_B2_BUCKET: env.BACKUP_B2_BUCKET },
    { BACKUP_LEDGER_ENABLED: 'true' },
    { BACKUP_B2_READ_KEY_ID: env.BACKUP_LEDGER_B2_READ_KEY_ID },
    {
      BACKUP_LEDGER_B2_READ_KEY_ID: undefined,
      BACKUP_B2_READ_KEY_ID: 'never-fallback',
    },
    {
      BACKUP_LEDGER_B2_ENDPOINT: undefined,
      BACKUP_B2_ENDPOINT: env.BACKUP_LEDGER_B2_ENDPOINT,
    },
    { BACKUP_ENABLED: 'true' },
    { VITE_BACKUP_LEDGER_B2_READ_APPLICATION_KEY: 'exposed' },
  ])
    assert.throws(() => restoreLedgerDestinationConfig({ ...env, ...extra }));
});
test('read-only ledger metadata check verifies lifecycle isolation without object operations', async () => {
  const f = fixture();
  const flags = await checkRestoreLedgerDestination(
    restoreLedgerDestinationConfig(env),
    f.fetcher,
  );
  assert.deepEqual(flags, {
    destination: 'backblaze-b2',
    privateBucket: true,
    singleBucketReadKey: true,
    separateFromBackupBucket: true,
    automaticExpirationRulesAbsent: true,
    objectAccessTested: false,
    immutabilityVerified: false,
    ledgerWritesEnabled: false,
  });
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].url.endsWith('/b2_authorize_account'));
  assert.ok(f.calls[1].url.endsWith('/b2_list_buckets'));
  assert.equal(f.calls[1].options.redirect, 'error');
  assert.equal(
    JSON.parse(f.calls[1].options.body).bucketName,
    env.BACKUP_LEDGER_B2_BUCKET,
  );
  assert.ok(!JSON.stringify(flags).includes('fixture'));
});
test('rejects expiration rules, missing lifecycle evidence, write keys and backup prefix reuse', async () => {
  for (const change of [
    (value) => {
      value.buckets[0].lifecycleRules = [{ daysFromHidingToDeleting: 90 }];
    },
    (value) => {
      delete value.buckets[0].lifecycleRules;
    },
    (value) => {
      value.buckets[0].bucketType = 'allPublic';
    },
  ]) {
    const value = result();
    change(value);
    const f = fixture(auth(), value);
    await assert.rejects(
      checkRestoreLedgerDestination(
        restoreLedgerDestinationConfig(env),
        f.fetcher,
      ),
    );
  }
  for (const change of [
    (value) => value.apiInfo.storageApi.allowed.capabilities.push('writeFiles'),
    (value) =>
      value.apiInfo.storageApi.allowed.capabilities.push('listAllBucketNames'),
    (value) => value.apiInfo.storageApi.allowed.capabilities.push('listKeys'),
    (value) => {
      value.apiInfo.storageApi.allowed.capabilities =
        value.apiInfo.storageApi.allowed.capabilities.filter(
          (c) => c !== 'readBucketLifecycleRules',
        );
    },
    (value) => {
      value.apiInfo.storageApi.allowed.namePrefix =
        'fmv-backups/v1/development/';
    },
    (value) => {
      value.apiInfo.storageApi.allowed.namePrefix = null;
    },
    (value) => {
      value.apiInfo.storageApi.allowed.namePrefix = '';
    },
  ]) {
    const value = auth();
    change(value);
    const f = fixture(value);
    await assert.rejects(
      checkRestoreLedgerDestination(
        restoreLedgerDestinationConfig(env),
        f.fetcher,
      ),
    );
    assert.equal(f.calls.length, 1);
  }
  const f = fixture();
  await assert.rejects(
    checkRestoreLedgerDestination(
      {
        ...restoreLedgerDestinationConfig(env),
        backupBucket: env.BACKUP_LEDGER_B2_BUCKET,
      },
      f.fetcher,
    ),
  );
  assert.equal(f.calls.length, 0);
  await assert.rejects(
    checkRestoreLedgerDestination(
      {
        ...restoreLedgerDestinationConfig(env),
        backupKeyId: env.BACKUP_LEDGER_B2_READ_KEY_ID,
      },
      f.fetcher,
    ),
  );
  assert.equal(f.calls.length, 0);
});

test('version discovery uses explicit prefix and version API only, without object downloads', async () => {
  const calls = [];
  const values = [
    auth(),
    result(),
    { files: [], nextFileName: null, nextFileId: null },
  ];
  const flags = await checkRestoreLedgerVersionDiscovery(
    restoreLedgerDestinationConfig(env),
    async (url, options) => {
      calls.push({ url, options });
      return response(values[calls.length - 1]);
    },
  );
  assert.equal(calls.length, 3);
  assert.ok(calls[2].url.endsWith('/b2_list_file_versions'));
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    bucketId: 'fixture-bucket',
    prefix: 'fmv-restore-evidence/v1/development/',
    maxFileCount: 100,
  });
  assert.equal(flags.versionPaginationExhausted, true);
  assert.equal(flags.versionMetadataCount, 0);
  assert.equal(flags.immutableHistoryVerified, false);
  assert.equal(flags.recoverySafetyVerified, false);
  assert.equal(flags.ledgerWritesEnabled, false);
});

test('populated version pages have their own bounded transport budget', async () => {
  const page = {
    files: Array.from({ length: 100 }, (_, index) => ({
      accountId: 'fixture-account',
      bucketId: 'fixture-bucket',
      action: 'upload',
      fileId: 'fixture-version-' + index,
      fileName: 'fmv-restore-evidence/v1/development/opaque-' + index + '.age',
      contentLength: 100,
      uploadTimestamp: 1000,
      fileInfo: { synthetic: 'x'.repeat(800) },
    })),
    nextFileName: null,
    nextFileId: null,
  };
  assert.ok(
    new globalThis.TextEncoder().encode(JSON.stringify(page)).length > 65536,
  );
  let call = 0;
  const values = [auth(), result(), page];
  const flags = await checkRestoreLedgerVersionDiscovery(
    restoreLedgerDestinationConfig(env),
    async () => response(values[call++]),
  );
  assert.equal(flags.versionMetadataCount, 100);
  assert.equal(flags.versionPaginationExhausted, true);
  const oversized = {
    files: [],
    nextFileName: null,
    nextFileId: null,
    padding: 'x'.repeat(8 * 1024 * 1024 + 1),
  };
  call = 0;
  const bad = [auth(), result(), oversized];
  await assert.rejects(
    checkRestoreLedgerVersionDiscovery(
      restoreLedgerDestinationConfig(env),
      async () => response(bad[call++]),
    ),
  );
});
