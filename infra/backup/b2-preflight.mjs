import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { inspectLedgerVersionMetadata } from './ledger-version-metadata.mjs';
export class BackupDestinationError extends Error {}
const fail = () =>
  new BackupDestinationError(
    'B2 read-only preflight is unavailable; check private configuration and key scope.',
  );
const readCapabilities = new Set([
  'listAllBucketNames',
  'listBuckets',
  'readBuckets',
  'listFiles',
  'readFiles',
  'shareFiles',
  'readBucketEncryption',
  'readBucketRetentions',
  'readFileRetentions',
  'readFileLegalHolds',
  'readBucketReplications',
  'readBucketNotifications',
  'readBucketLogging',
  'readBucketLifecycleRules',
]);
const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v) =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= 1024 &&
  !/[^\x21-\x7e]/.test(v) &&
  !v.startsWith('replace_');
function endpoint(value, kind) {
  const u = new URL(value),
    pattern =
      kind === 's3'
        ? /^s3\.[a-z0-9]+(?:-[a-z0-9]+)+\.backblazeb2\.com$/
        : /^api\d*\.backblazeb2\.com$/;
  if (
    u.protocol !== 'https:' ||
    !pattern.test(u.hostname) ||
    u.port ||
    u.username ||
    u.password ||
    u.pathname !== '/' ||
    u.search ||
    u.hash
  )
    throw fail();
  return u.origin;
}
const bucketName = (value) =>
  typeof value === 'string' &&
  value.length >= 3 &&
  value.length <= 63 &&
  /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(value) &&
  !value.startsWith('replace_');
export function backupDestinationConfig(env) {
  try {
    if (env.BACKUP_ENABLED !== undefined && env.BACKUP_ENABLED !== 'false')
      throw fail();
    if (Object.entries(env).some(([k, v]) => v && k.startsWith('VITE_BACKUP')))
      throw fail();
    const bucket = env.BACKUP_B2_BUCKET,
      keyId = env.BACKUP_B2_READ_KEY_ID,
      applicationKey = env.BACKUP_B2_READ_APPLICATION_KEY;
    if (
      !bucketName(bucket) ||
      !text(keyId) ||
      !/^[A-Za-z0-9_-]+$/.test(keyId) ||
      !text(applicationKey) ||
      !/^[A-Za-z0-9+/_=-]+$/.test(applicationKey)
    )
      throw fail();
    return {
      bucket,
      keyId,
      applicationKey,
      endpoint: endpoint(env.BACKUP_B2_ENDPOINT, 's3'),
    };
  } catch {
    throw fail();
  }
}
async function json(response, maximumBytes = 65536) {
  if (response.status !== 200 || !response.body) throw fail();
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximumBytes) throw fail();
      chunks.push(Buffer.from(next.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function checkPrivateDestination(config, fetcher, policy) {
  // Revalidate structured callers as well as the CLI; never inherit R2/AWS keys.
  const c = backupDestinationConfig({
    BACKUP_ENABLED: 'false',
    BACKUP_B2_BUCKET: config?.bucket,
    BACKUP_B2_ENDPOINT: config?.endpoint,
    BACKUP_B2_READ_KEY_ID: config?.keyId,
    BACKUP_B2_READ_APPLICATION_KEY: config?.applicationKey,
  });
  const signal = globalThis.AbortSignal.timeout(
    policy.discoverVersions ? 30000 : 15000,
  );
  try {
    const auth = await json(
      await fetcher(
        'https://api.backblazeb2.com/b2api/v4/b2_authorize_account',
        {
          method: 'GET',
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
          signal,
          headers: {
            Accept: 'application/json',
            Authorization:
              'Basic ' +
              Buffer.from(c.keyId + ':' + c.applicationKey).toString('base64'),
          },
        },
      ),
    );
    const storage = auth?.apiInfo?.storageApi,
      allowed = storage?.allowed;
    if (
      !object(auth) ||
      !text(auth.accountId) ||
      !text(auth.authorizationToken) ||
      !object(allowed) ||
      !Array.isArray(allowed.buckets) ||
      allowed.buckets.length !== 1 ||
      allowed.buckets[0]?.name !== c.bucket ||
      !text(allowed.buckets[0]?.id) ||
      !Array.isArray(allowed.capabilities) ||
      allowed.capabilities.length > 64 ||
      !['listBuckets', 'listFiles', 'readFiles'].every((k) =>
        allowed.capabilities.includes(k),
      ) ||
      allowed.capabilities.some(
        (k) => typeof k !== 'string' || !readCapabilities.has(k),
      ) ||
      !policy.prefixes.includes(allowed.namePrefix) ||
      (policy.noLifecycleRules &&
        (allowed.capabilities.includes('listAllBucketNames') ||
          !allowed.capabilities.includes('readBucketLifecycleRules'))) ||
      endpoint(storage.s3ApiUrl, 's3') !== c.endpoint
    )
      throw fail();
    if (
      auth.applicationKeyExpirationTimestamp !== null &&
      (!Number.isSafeInteger(auth.applicationKeyExpirationTimestamp) ||
        auth.applicationKeyExpirationTimestamp <= Date.now())
    )
      throw fail();
    const api = endpoint(storage.apiUrl, 'api'),
      selected = allowed.buckets[0];
    const result = await json(
      await fetcher(api + '/b2api/v4/b2_list_buckets', {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: auth.authorizationToken,
        },
        body: JSON.stringify({
          accountId: auth.accountId,
          bucketId: selected.id,
          bucketName: c.bucket,
        }),
      }),
    );
    if (
      !object(result) ||
      !Array.isArray(result.buckets) ||
      result.buckets.length !== 1
    )
      throw fail();
    const bucket = result.buckets[0];
    if (
      !object(bucket) ||
      bucket.accountId !== auth.accountId ||
      bucket.bucketId !== selected.id ||
      bucket.bucketName !== c.bucket ||
      bucket.bucketType !== 'allPrivate' ||
      (policy.noLifecycleRules &&
        (!Array.isArray(bucket.lifecycleRules) ||
          bucket.lifecycleRules.length !== 0))
    )
      throw fail();
    signal.throwIfAborted();
    policy.observeIdentity?.({
      accountId: auth.accountId,
      bucketId: selected.id,
    });
    let versionMetadata;
    if (policy.discoverVersions) {
      versionMetadata = await inspectLedgerVersionMetadata(
        async (cursor) =>
          json(
            await fetcher(api + '/b2api/v4/b2_list_file_versions', {
              method: 'POST',
              redirect: 'error',
              credentials: 'omit',
              cache: 'no-store',
              signal,
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: auth.authorizationToken,
              },
              body: JSON.stringify({
                bucketId: selected.id,
                prefix: 'fmv-restore-evidence/v1/development/',
                maxFileCount: 100,
                ...cursor,
              }),
            }),
            8 * 1024 * 1024,
          ),
        {
          accountId: auth.accountId,
          bucketId: selected.id,
          prefix: 'fmv-restore-evidence/v1/development/',
          signal,
        },
      );
    }
    signal.throwIfAborted();
    return {
      ...versionMetadata,
      destination: 'backblaze-b2',
      privateBucket: true,
      singleBucketReadKey: true,
      objectAccessTested: false,
      capacityVerified: false,
      backupsEnabled: false,
    };
  } catch {
    throw fail();
  }
}

export function checkBackupDestination(config, fetcher = globalThis.fetch) {
  return checkPrivateDestination(config, fetcher, {
    prefixes: [null, '', 'fmv-backups/v1/development/'],
    noLifecycleRules: false,
  });
}

export function restoreLedgerDestinationConfig(env) {
  try {
    if (
      (env.BACKUP_LEDGER_ENABLED !== undefined &&
        env.BACKUP_LEDGER_ENABLED !== 'false') ||
      !bucketName(env.BACKUP_B2_BUCKET) ||
      env.BACKUP_LEDGER_B2_BUCKET === env.BACKUP_B2_BUCKET ||
      (env.BACKUP_B2_READ_KEY_ID !== undefined &&
        env.BACKUP_LEDGER_B2_READ_KEY_ID === env.BACKUP_B2_READ_KEY_ID)
    )
      throw fail();
    const selected = backupDestinationConfig({
      ...env,
      BACKUP_B2_BUCKET: env.BACKUP_LEDGER_B2_BUCKET,
      BACKUP_B2_ENDPOINT: env.BACKUP_LEDGER_B2_ENDPOINT,
      BACKUP_B2_READ_KEY_ID: env.BACKUP_LEDGER_B2_READ_KEY_ID,
      BACKUP_B2_READ_APPLICATION_KEY: env.BACKUP_LEDGER_B2_READ_APPLICATION_KEY,
    });
    return {
      ...selected,
      backupBucket: env.BACKUP_B2_BUCKET,
      backupKeyId: env.BACKUP_B2_READ_KEY_ID,
    };
  } catch {
    throw fail();
  }
}

async function checkLedgerDestination(config, fetcher, discoverVersions) {
  try {
    if (
      !bucketName(config?.backupBucket) ||
      config.backupBucket === config.bucket ||
      (config.backupKeyId !== undefined && config.backupKeyId === config.keyId)
    )
      throw fail();
    const result = await checkPrivateDestination(config, fetcher, {
      prefixes: ['fmv-restore-evidence/v1/development/'],
      noLifecycleRules: true,
      discoverVersions,
    });
    return {
      ...(discoverVersions
        ? {
            versionPaginationExhausted: result.versionPaginationExhausted,
            pagesRead: result.pagesRead,
            versionMetadataCount: result.versionMetadataCount,
            uploadedVersions: result.uploadedVersions,
            hideMarkers: result.hideMarkers,
            unfinishedVersions: result.unfinishedVersions,
            immutableHistoryVerified: false,
            consistentSnapshotVerified: false,
            recoverySafetyVerified: false,
          }
        : {}),
      destination: result.destination,
      privateBucket: true,
      singleBucketReadKey: true,
      separateFromBackupBucket: true,
      automaticExpirationRulesAbsent: true,
      objectAccessTested: false,
      immutabilityVerified: false,
      ledgerWritesEnabled: false,
    };
  } catch {
    throw fail();
  }
}

export function checkRestoreLedgerDestination(
  config,
  fetcher = globalThis.fetch,
) {
  return checkLedgerDestination(config, fetcher, false);
}
export function checkRestoreLedgerVersionDiscovery(
  config,
  fetcher = globalThis.fetch,
) {
  return checkLedgerDestination(config, fetcher, true);
}

export function restoreLedgerProducerConfig(env) {
  try {
    const reader = restoreLedgerDestinationConfig(env);
    const producer = backupDestinationConfig({
      BACKUP_ENABLED: 'false',
      BACKUP_B2_BUCKET: reader.bucket,
      BACKUP_B2_ENDPOINT: reader.endpoint,
      BACKUP_B2_READ_KEY_ID: env.BACKUP_LEDGER_B2_PRODUCER_KEY_ID,
      BACKUP_B2_READ_APPLICATION_KEY:
        env.BACKUP_LEDGER_B2_PRODUCER_APPLICATION_KEY,
    });
    if ([reader.keyId, reader.backupKeyId].includes(producer.keyId))
      throw fail();
    return {
      ...reader,
      producerKeyId: producer.keyId,
      producerApplicationKey: producer.applicationKey,
    };
  } catch {
    throw fail();
  }
}

// Authorization metadata only: no upload URL, object operation or returned token.
export async function checkRestoreLedgerProducer(
  config,
  fetcher = globalThis.fetch,
) {
  try {
    const c = restoreLedgerProducerConfig({
      BACKUP_ENABLED: 'false',
      BACKUP_LEDGER_ENABLED: 'false',
      BACKUP_B2_BUCKET: config?.backupBucket,
      BACKUP_B2_READ_KEY_ID: config?.backupKeyId,
      BACKUP_LEDGER_B2_BUCKET: config?.bucket,
      BACKUP_LEDGER_B2_ENDPOINT: config?.endpoint,
      BACKUP_LEDGER_B2_READ_KEY_ID: config?.keyId,
      BACKUP_LEDGER_B2_READ_APPLICATION_KEY: config?.applicationKey,
      BACKUP_LEDGER_B2_PRODUCER_KEY_ID: config?.producerKeyId,
      BACKUP_LEDGER_B2_PRODUCER_APPLICATION_KEY: config?.producerApplicationKey,
    });
    let identity;
    await checkPrivateDestination(c, fetcher, {
      prefixes: ['fmv-restore-evidence/v1/development/'],
      noLifecycleRules: true,
      observeIdentity: (value) => {
        identity = value;
      },
    });
    const signal = globalThis.AbortSignal.timeout(15000);
    const auth = await json(
      await fetcher(
        'https://api.backblazeb2.com/b2api/v4/b2_authorize_account',
        {
          method: 'GET',
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
          signal,
          headers: {
            Accept: 'application/json',
            Authorization:
              'Basic ' +
              Buffer.from(
                c.producerKeyId + ':' + c.producerApplicationKey,
              ).toString('base64'),
          },
        },
      ),
    );
    const storage = auth?.apiInfo?.storageApi,
      allowed = storage?.allowed;
    if (
      !object(auth) ||
      !identity ||
      auth.accountId !== identity.accountId ||
      !text(auth.authorizationToken) ||
      !object(allowed) ||
      !Array.isArray(allowed.buckets) ||
      allowed.buckets.length !== 1 ||
      allowed.buckets[0]?.id !== identity.bucketId ||
      (allowed.buckets[0]?.name !== null &&
        allowed.buckets[0]?.name !== c.bucket) ||
      !Array.isArray(allowed.capabilities) ||
      allowed.capabilities.length !== 1 ||
      allowed.capabilities[0] !== 'writeFiles' ||
      allowed.namePrefix !== 'fmv-restore-evidence/v1/development/' ||
      endpoint(storage.s3ApiUrl, 's3') !== c.endpoint ||
      (auth.applicationKeyExpirationTimestamp !== null &&
        (!Number.isSafeInteger(auth.applicationKeyExpirationTimestamp) ||
          auth.applicationKeyExpirationTimestamp <= Date.now()))
    )
      throw fail();
    endpoint(storage.apiUrl, 'api');
    signal.throwIfAborted();
    return {
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
  } catch {
    throw new BackupDestinationError(
      'Ledger producer authorization preflight failed; no provider publishing attempted.',
    );
  }
}
