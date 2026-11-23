import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import {
  BackupDestinationError,
  checkRestoreLedgerProducer,
  restoreLedgerDestinationConfig,
  restoreLedgerProducerConfig,
} from '../backup/b2-preflight.mjs';

const env = {
  BACKUP_ENABLED: 'false',
  BACKUP_LEDGER_ENABLED: 'false',
  BACKUP_B2_BUCKET: 'synthetic-backups',
  BACKUP_B2_READ_KEY_ID: 'fixture-backup-id',
  BACKUP_LEDGER_B2_BUCKET: 'synthetic-ledger',
  BACKUP_LEDGER_B2_ENDPOINT: 'https://s3.us-east-005.backblazeb2.com',
  BACKUP_LEDGER_B2_READ_KEY_ID: 'fixture-reader-id',
  BACKUP_LEDGER_B2_READ_APPLICATION_KEY: 'fixture-reader-key',
  BACKUP_LEDGER_B2_PRODUCER_KEY_ID: 'fixture-producer-id',
  BACKUP_LEDGER_B2_PRODUCER_APPLICATION_KEY: 'fixture-producer-key',
};
const prefix = 'fmv-restore-evidence/v1/development/';
const expectedFlags = {
  destination: 'backblaze-b2',
  privateBucket: true,
  separateProducerKey: true,
  sameAccountAndBucket: true,
  exactDevelopmentPrefix: true,
  writeFilesOnly: true,
  automaticExpirationRulesAbsent: true,
  objectAccessTested: false,
  providerPublishingAttempted: false,
  immutabilityVerified: false,
  independentConfirmation: false,
  sourceLossCoverageVerified: false,
  ledgerWritesEnabled: false,
};
const reader = () => ({
  accountId: 'fixture-account',
  authorizationToken: 'fixture-reader-token',
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
        namePrefix: prefix,
      },
    },
  },
});
const bucket = () => ({
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
const producer = () => ({
  accountId: 'fixture-account',
  authorizationToken: 'fixture-producer-token',
  applicationKeyExpirationTimestamp: null,
  apiInfo: {
    storageApi: {
      apiUrl: 'https://api005.backblazeb2.com',
      s3ApiUrl: env.BACKUP_LEDGER_B2_ENDPOINT,
      allowed: {
        buckets: [{ id: 'fixture-bucket', name: null }],
        capabilities: ['writeFiles'],
        namePrefix: prefix,
      },
    },
  },
});
const response = (value) =>
  new globalThis.Response(JSON.stringify(value), { status: 200 });
const fixture = (values = [reader(), bucket(), producer()]) => {
  const calls = [];
  return {
    calls,
    fetcher: async (url, options) => {
      calls.push({ url, options });
      assert.ok(calls.length <= values.length, 'Unexpected provider operation');
      return response(values[calls.length - 1]);
    },
  };
};
const config = () => restoreLedgerProducerConfig(env);
const rejects = (selected, fetcher) =>
  assert.rejects(checkRestoreLedgerProducer(selected, fetcher), (error) => {
    assert.ok(error instanceof BackupDestinationError);
    assert.equal(
      error.message,
      'Ledger producer authorization preflight failed; no provider publishing attempted.',
    );
    return true;
  });

test('producer configuration requires distinct explicit private credentials and disabled execution', () => {
  assert.deepEqual(config(), {
    ...restoreLedgerDestinationConfig(env),
    producerKeyId: env.BACKUP_LEDGER_B2_PRODUCER_KEY_ID,
    producerApplicationKey: env.BACKUP_LEDGER_B2_PRODUCER_APPLICATION_KEY,
  });
  for (const patch of [
    { BACKUP_LEDGER_B2_PRODUCER_KEY_ID: undefined },
    { BACKUP_LEDGER_B2_PRODUCER_APPLICATION_KEY: undefined },
    { BACKUP_LEDGER_B2_PRODUCER_KEY_ID: env.BACKUP_LEDGER_B2_READ_KEY_ID },
    { BACKUP_LEDGER_B2_PRODUCER_KEY_ID: env.BACKUP_B2_READ_KEY_ID },
    { BACKUP_LEDGER_B2_PRODUCER_KEY_ID: 'replace_producer' },
    { BACKUP_LEDGER_B2_PRODUCER_KEY_ID: 'fixture:id' },
    { BACKUP_LEDGER_B2_PRODUCER_APPLICATION_KEY: 'replace_producer' },
    { BACKUP_LEDGER_B2_PRODUCER_APPLICATION_KEY: 'fixture key' },
    { BACKUP_LEDGER_B2_PRODUCER_APPLICATION_KEY: 'fixture\nkey' },
    { BACKUP_LEDGER_B2_BUCKET: env.BACKUP_B2_BUCKET },
    { VITE_BACKUP_LEDGER_B2_PRODUCER_KEY_ID: 'fixture-exposed' },
    { VITE_BACKUP_LEDGER_B2_PRODUCER_APPLICATION_KEY: 'fixture-exposed' },
  ])
    assert.throws(
      () => restoreLedgerProducerConfig({ ...env, ...patch }),
      BackupDestinationError,
    );
  for (const key of ['BACKUP_ENABLED', 'BACKUP_LEDGER_ENABLED'])
    for (const value of ['true', 'TRUE', '1', '', true, false])
      assert.throws(
        () => restoreLedgerProducerConfig({ ...env, [key]: value }),
        BackupDestinationError,
      );
});

test('metadata preflight uses exactly reader auth, bucket inspection and separate producer auth', async () => {
  const f = fixture();
  const flags = await checkRestoreLedgerProducer(config(), f.fetcher);
  assert.deepEqual(flags, expectedFlags);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(
    f.calls.map((call) => call.url),
    [
      'https://api.backblazeb2.com/b2api/v4/b2_authorize_account',
      'https://api005.backblazeb2.com/b2api/v4/b2_list_buckets',
      'https://api.backblazeb2.com/b2api/v4/b2_authorize_account',
    ],
  );
  assert.deepEqual(
    f.calls.map((call) => call.options.method),
    ['GET', 'POST', 'GET'],
  );
  const basic = (id, key) =>
    'Basic ' + Buffer.from(id + ':' + key).toString('base64');
  assert.equal(
    f.calls[0].options.headers.Authorization,
    basic(
      env.BACKUP_LEDGER_B2_READ_KEY_ID,
      env.BACKUP_LEDGER_B2_READ_APPLICATION_KEY,
    ),
  );
  assert.equal(
    f.calls[1].options.headers.Authorization,
    'fixture-reader-token',
  );
  assert.equal(
    f.calls[2].options.headers.Authorization,
    basic(
      env.BACKUP_LEDGER_B2_PRODUCER_KEY_ID,
      env.BACKUP_LEDGER_B2_PRODUCER_APPLICATION_KEY,
    ),
  );
  assert.deepEqual(JSON.parse(f.calls[1].options.body), {
    accountId: 'fixture-account',
    bucketId: 'fixture-bucket',
    bucketName: env.BACKUP_LEDGER_B2_BUCKET,
  });
  assert.equal(f.calls[2].options.body, undefined);
  for (const call of f.calls) {
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.cache, 'no-store');
    assert.ok(call.options.signal instanceof globalThis.AbortSignal);
  }
  assert.ok(!JSON.stringify(flags).includes('fixture'));
  assert.ok(!JSON.stringify(flags).includes('synthetic'));
});

test('producer accepts null or matching bucket name and a valid future or unlimited expiry', async () => {
  for (const name of [null, env.BACKUP_LEDGER_B2_BUCKET]) {
    for (const expiry of [null, Date.now() + 60000]) {
      const auth = producer();
      auth.apiInfo.storageApi.allowed.buckets[0].name = name;
      auth.applicationKeyExpirationTimestamp = expiry;
      auth.apiInfo.storageApi.apiUrl = 'https://api006.backblazeb2.com';
      const f = fixture([reader(), bucket(), auth]);
      assert.deepEqual(
        await checkRestoreLedgerProducer(config(), f.fetcher),
        expectedFlags,
      );
      assert.equal(f.calls.length, 3);
    }
  }
});

test('direct structured configurations cannot bypass credential, destination or scope isolation', async () => {
  for (const patch of [
    { producerKeyId: env.BACKUP_LEDGER_B2_READ_KEY_ID },
    { producerKeyId: env.BACKUP_B2_READ_KEY_ID },
    { producerKeyId: undefined },
    { producerApplicationKey: undefined },
    { producerApplicationKey: 'fixture\nkey' },
    { keyId: env.BACKUP_B2_READ_KEY_ID },
    { backupBucket: env.BACKUP_LEDGER_B2_BUCKET },
    { endpoint: 'https://unapproved.example.test' },
  ]) {
    const f = fixture();
    await rejects({ ...config(), ...patch }, f.fetcher);
    assert.equal(f.calls.length, 0);
  }
});

test('reader authorization and private lifecycle evidence are required before producer authorization', async () => {
  for (const change of [
    (auth) => {
      auth.apiInfo.storageApi.allowed.capabilities.push('writeFiles');
    },
    (auth) => {
      auth.apiInfo.storageApi.allowed.namePrefix =
        'fmv-backups/v1/development/';
    },
  ]) {
    const auth = reader();
    change(auth);
    const f = fixture([auth, bucket(), producer()]);
    await rejects(config(), f.fetcher);
    assert.equal(f.calls.length, 1);
  }
  for (const change of [
    (value) => {
      value.buckets[0].bucketType = 'allPublic';
    },
    (value) => {
      value.buckets[0].lifecycleRules = [{ daysFromHidingToDeleting: 90 }];
    },
    (value) => {
      delete value.buckets[0].lifecycleRules;
    },
    (value) => {
      value.buckets[0].bucketId = 'fixture-other-bucket';
    },
  ]) {
    const value = bucket();
    change(value);
    const f = fixture([reader(), value, producer()]);
    await rejects(config(), f.fetcher);
    assert.equal(f.calls.length, 2);
  }
});

test('producer must match the exact reader account, single bucket and S3 endpoint', async () => {
  for (const change of [
    (auth) => {
      auth.accountId = 'fixture-other-account';
    },
    (auth) => {
      auth.accountId = null;
    },
    (auth) => {
      auth.authorizationToken = '';
    },
    (auth) => {
      auth.apiInfo.storageApi.allowed.buckets = [];
    },
    (auth) => {
      auth.apiInfo.storageApi.allowed.buckets = null;
    },
    (auth) => {
      auth.apiInfo.storageApi.allowed.buckets.push({
        id: 'fixture-other-bucket',
        name: null,
      });
    },
    (auth) => {
      auth.apiInfo.storageApi.allowed.buckets[0].id = 'fixture-other-bucket';
    },
    (auth) => {
      auth.apiInfo.storageApi.allowed.buckets[0].name = 'fixture-other-name';
    },
    (auth) => {
      delete auth.apiInfo.storageApi.allowed.buckets[0].name;
    },
    (auth) => {
      auth.apiInfo.storageApi.s3ApiUrl =
        'https://s3.us-west-001.backblazeb2.com';
    },
  ]) {
    const auth = producer();
    change(auth);
    const f = fixture([reader(), bucket(), auth]);
    await rejects(config(), f.fetcher);
    assert.equal(f.calls.length, 3);
  }
});

test('producer requires only writeFiles, the exact development prefix and a valid API endpoint', async () => {
  for (const capabilities of [
    [],
    null,
    ['readFiles'],
    ['writeFiles', 'writeFiles'],
    ...[
      'readFiles',
      'listFiles',
      'deleteFiles',
      'listBuckets',
      'writeBuckets',
      'writeKeys',
      'listKeys',
    ].map((extra) => ['writeFiles', extra]),
  ]) {
    const auth = producer();
    auth.apiInfo.storageApi.allowed.capabilities = capabilities;
    await rejects(config(), fixture([reader(), bucket(), auth]).fetcher);
  }
  for (const namePrefix of [
    undefined,
    null,
    '',
    'fmv-restore-evidence/v1/',
    'fmv-restore-evidence/v1/production/',
    prefix.slice(0, -1),
    'fmv-backups/v1/development/',
  ]) {
    const auth = producer();
    auth.apiInfo.storageApi.allowed.namePrefix = namePrefix;
    await rejects(config(), fixture([reader(), bucket(), auth]).fetcher);
  }
  for (const apiUrl of [
    undefined,
    null,
    'http://api005.backblazeb2.com',
    'https://unapproved.example.test',
    'https://api005.backblazeb2.com/path',
    'https://api005.backblazeb2.com?override=true',
    'https://api005.backblazeb2.com:8443',
  ]) {
    const auth = producer();
    auth.apiInfo.storageApi.apiUrl = apiUrl;
    await rejects(config(), fixture([reader(), bucket(), auth]).fetcher);
  }
});

test('producer rejects expired, missing or malformed expiry metadata', async () => {
  for (const expiry of [
    undefined,
    0,
    Date.now() - 1,
    '9999999999999',
    true,
    Date.now() + 60000.5,
  ]) {
    const auth = producer();
    auth.applicationKeyExpirationTimestamp = expiry;
    await rejects(config(), fixture([reader(), bucket(), auth]).fetcher);
  }
});

test('redirects, provider errors and malformed or oversized responses stay masked', async () => {
  const values = [reader(), bucket(), producer()];
  for (const failAt of [0, 1, 2]) {
    for (const status of [302, 401, 403, 500]) {
      let calls = 0;
      await rejects(config(), async (_url, options) => {
        assert.equal(options.redirect, 'error');
        if (calls++ === failAt)
          return new globalThis.Response('fixture-private-provider-body', {
            status,
            headers: { Location: 'https://unapproved.example.test/' },
          });
        return response(values[calls - 1]);
      });
      assert.equal(calls, failAt + 1);
    }
    let calls = 0;
    await rejects(config(), async () => {
      if (calls++ === failAt)
        throw Error('fixture-private-provider-body fixture-producer-key');
      return response(values[calls - 1]);
    });
  }
  for (const body of [
    null,
    '{malformed-json',
    JSON.stringify({ padding: 'x'.repeat(65537) }),
  ]) {
    let calls = 0;
    await rejects(config(), async () => {
      if (calls++ === 2) return new globalThis.Response(body, { status: 200 });
      return response(values[calls - 1]);
    });
    assert.equal(calls, 3);
  }
});
