export type R2Config = {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function storageConfig(
  env: NodeJS.ProcessEnv = process.env,
): R2Config | null {
  try {
    if (
      Object.entries(env).some(
        ([key, value]) =>
          !!value &&
          (key.startsWith('VITE_R2_') ||
            key === 'R2_ENDPOINT' ||
            key === 'R2_PUBLIC_URL'),
      )
    )
      throw new Error();
    if (env['R2_ENABLED'] === undefined || env['R2_ENABLED'] === 'false')
      return null;
    if (env['R2_ENABLED'] !== 'true') throw new Error();
    const accountId = env['R2_ACCOUNT_ID'],
      bucket = env['R2_BUCKET'],
      accessKeyId = env['R2_ACCESS_KEY_ID'],
      secretAccessKey = env['R2_SECRET_ACCESS_KEY'];
    const credential = (value: unknown): value is string =>
      typeof value === 'string' &&
      value.length >= 1 &&
      value.length <= 256 &&
      !/[^\x21-\x7e]/.test(value);
    if (
      typeof accountId !== 'string' ||
      accountId.length !== 32 ||
      !/^[a-f0-9]{32}$/.test(accountId) ||
      typeof bucket !== 'string' ||
      bucket.length < 3 ||
      bucket.length > 63 ||
      /[^a-z0-9-]/.test(bucket) ||
      !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(bucket) ||
      !credential(accessKeyId) ||
      !credential(secretAccessKey)
    )
      throw new Error();
    return { accountId, bucket, accessKeyId, secretAccessKey };
  } catch {
    throw new Error(
      'Object storage configuration is invalid; check the server-only R2 settings.',
    );
  }
}
