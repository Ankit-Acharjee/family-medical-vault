import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
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
      typeof bucket !== 'string' ||
      bucket.length < 3 ||
      bucket.length > 63 ||
      !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(bucket) ||
      bucket.startsWith('replace_') ||
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
async function json(response) {
  if (response.status !== 200 || !response.body) throw fail();
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 65536) throw fail();
      chunks.push(Buffer.from(next.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function checkBackupDestination(
  config,
  fetcher = globalThis.fetch,
) {
  // Revalidate structured callers as well as the CLI; never inherit R2/AWS keys.
  const c = backupDestinationConfig({
    BACKUP_ENABLED: 'false',
    BACKUP_B2_BUCKET: config?.bucket,
    BACKUP_B2_ENDPOINT: config?.endpoint,
    BACKUP_B2_READ_KEY_ID: config?.keyId,
    BACKUP_B2_READ_APPLICATION_KEY: config?.applicationKey,
  });
  const signal = globalThis.AbortSignal.timeout(15000);
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
      ![null, '', 'fmv-backups/v1/development/'].includes(allowed.namePrefix) ||
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
      bucket.bucketType !== 'allPrivate'
    )
      throw fail();
    signal.throwIfAborted();
    return {
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
