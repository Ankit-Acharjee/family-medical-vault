import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backupDestinationConfig,
  checkBackupDestination,
} from '../backup/b2-preflight.mjs';
const env = {
  BACKUP_ENABLED: 'false',
  BACKUP_B2_BUCKET: 'synthetic-backup-dev',
  BACKUP_B2_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com',
  BACKUP_B2_READ_KEY_ID: 'fixture-key-id',
  BACKUP_B2_READ_APPLICATION_KEY: 'fixture-only-secret',
};
const auth = () => ({
  accountId: 'fixture-account',
  authorizationToken: 'fixture-token',
  applicationKeyExpirationTimestamp: null,
  apiInfo: {
    storageApi: {
      apiUrl: 'https://api004.backblazeb2.com',
      s3ApiUrl: env.BACKUP_B2_ENDPOINT,
      allowed: {
        buckets: [{ id: 'fixture-bucket-id', name: env.BACKUP_B2_BUCKET }],
        capabilities: [
          'listBuckets',
          'listFiles',
          'readFiles',
          'readBucketLifecycleRules',
          'readBucketEncryption',
        ],
        namePrefix: null,
      },
    },
  },
});
const buckets = () => ({
  buckets: [
    {
      accountId: 'fixture-account',
      bucketId: 'fixture-bucket-id',
      bucketName: env.BACKUP_B2_BUCKET,
      bucketType: 'allPrivate',
    },
  ],
});
const response = (v, status = 200) =>
  new globalThis.Response(JSON.stringify(v), { status });
test('destination configuration rejects unrelated endpoints, exposed keys and accidental backup enablement', () => {
  assert.equal(backupDestinationConfig(env).bucket, env.BACKUP_B2_BUCKET);
  for (const patch of [
    { BACKUP_ENABLED: 'true' },
    { BACKUP_ENABLED: 'yes' },
    { VITE_BACKUP_B2_READ_KEY_ID: 'fixture' },
    {
      BACKUP_B2_ENDPOINT:
        'https://s3.us-west-004.backblazeb2.com.attacker.test',
    },
    { BACKUP_B2_ENDPOINT: 'http://s3.us-west-004.backblazeb2.com' },
    { BACKUP_B2_ENDPOINT: env.BACKUP_B2_ENDPOINT + '?host=other.test' },
    { BACKUP_B2_ENDPOINT: env.BACKUP_B2_ENDPOINT + '/bucket' },
    { BACKUP_B2_READ_KEY_ID: 'replace_locally' },
    { BACKUP_B2_READ_KEY_ID: 'fixture:invalid' },
    { BACKUP_B2_READ_APPLICATION_KEY: env.BACKUP_B2_ENDPOINT },
    { BACKUP_B2_BUCKET: 'invalid/name' },
  ])
    assert.throws(() => backupDestinationConfig({ ...env, ...patch }));
  assert.throws(() =>
    backupDestinationConfig({ R2_BUCKET: env.BACKUP_B2_BUCKET }),
  );
});
test('read-only check authenticates only to B2 and requests exactly the scoped private bucket', async () => {
  const calls = [];
  const result = await checkBackupDestination(
    backupDestinationConfig(env),
    async (url, init) => {
      calls.push({ url, init });
      return response(calls.length === 1 ? auth() : buckets());
    },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[1].init.method, 'POST');
  for (const c of calls) {
    assert.equal(c.init.redirect, 'error');
    assert.equal(c.init.credentials, 'omit');
    assert.ok(!c.url.includes(env.BACKUP_B2_READ_APPLICATION_KEY));
  }
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    accountId: 'fixture-account',
    bucketId: 'fixture-bucket-id',
    bucketName: env.BACKUP_B2_BUCKET,
  });
  assert.equal(result.privateBucket, true);
  assert.equal(result.backupsEnabled, false);
  assert.equal(result.capacityVerified, false);
  for (const value of [
    'fixture-account',
    'fixture-token',
    env.BACKUP_B2_READ_APPLICATION_KEY,
  ])
    assert.ok(!JSON.stringify(result).includes(value));
});
test('broad, write-capable, expired and mismatched authorizations fail before bucket listing', async () => {
  const patches = [
    (a) => {
      a.apiInfo.storageApi.allowed.buckets = null;
    },
    (a) => {
      a.apiInfo.storageApi.allowed.buckets.push({ id: 'other', name: 'other' });
    },
    (a) => {
      a.apiInfo.storageApi.allowed.capabilities.push('writeFiles');
    },
    (a) => {
      a.apiInfo.storageApi.allowed.capabilities.push('deleteFiles');
    },
    (a) => {
      a.apiInfo.storageApi.allowed.capabilities.push('listKeys');
    },
    (a) => {
      a.apiInfo.storageApi.allowed.capabilities = [];
    },
    (a) => {
      a.apiInfo.storageApi.allowed.namePrefix = 'other/';
    },
    (a) => {
      a.apiInfo.storageApi.apiUrl = 'https://attacker.test';
    },
    (a) => {
      a.apiInfo.storageApi.s3ApiUrl =
        'https://s3.eu-central-003.backblazeb2.com';
    },
    (a) => {
      a.applicationKeyExpirationTimestamp = 1;
    },
  ];
  for (const patch of patches) {
    let calls = 0;
    const value = auth();
    patch(value);
    await assert.rejects(
      checkBackupDestination(backupDestinationConfig(env), async () => {
        calls++;
        return response(value);
      }),
    );
    assert.equal(calls, 1);
  }
});
test('public or mismatched bucket metadata and provider failures are rejected without details', async () => {
  for (const patch of [
    (b) => {
      b.buckets[0].bucketType = 'allPublic';
    },
    (b) => {
      b.buckets[0].bucketId = 'other';
    },
    (b) => {
      b.buckets[0].accountId = 'other';
    },
    (b) => {
      b.buckets = [];
    },
    (b) => {
      b.buckets.push({ ...b.buckets[0] });
    },
  ]) {
    let calls = 0;
    const value = buckets();
    patch(value);
    await assert.rejects(
      checkBackupDestination(backupDestinationConfig(env), async () =>
        response(++calls === 1 ? auth() : value),
      ),
    );
  }
  await assert.rejects(
    checkBackupDestination(backupDestinationConfig(env), async () => {
      throw Error(env.BACKUP_B2_READ_APPLICATION_KEY);
    }),
    (e) => !e.message.includes(env.BACKUP_B2_READ_APPLICATION_KEY),
  );
  await assert.rejects(
    checkBackupDestination(backupDestinationConfig(env), async () =>
      response({ error: 'fixture-token' }, 401),
    ),
    (e) => !e.message.includes('fixture-token'),
  );
  await assert.rejects(
    checkBackupDestination(backupDestinationConfig(env), async () =>
      response({ padding: 'x'.repeat(65537) }),
    ),
  );
});
