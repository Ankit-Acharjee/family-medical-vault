export type AuthConfig = {
  origin: string;
  providerUrl: string;
  publicKey: string;
  encryptionKey: Buffer;
  databaseUrl: string;
  secure: boolean;
};

export function authConfig(env = process.env): AuthConfig | null {
  if (env['AUTH_ENABLED'] !== 'true') return null;
  try {
    const origin = new URL(env['AUTH_ORIGIN'] ?? '');
    const provider = new URL(env['SUPABASE_URL'] ?? '');
    const database = new URL(env['DATABASE_URL'] ?? '');
    const local = ['localhost', '127.0.0.1'].includes(origin.hostname);
    const localDatabase =
      ['localhost', '127.0.0.1', 'postgres'].includes(database.hostname) &&
      env['NODE_ENV'] !== 'production';
    if (
      origin.origin !== env['AUTH_ORIGIN'] ||
      origin.username ||
      origin.password ||
      (origin.protocol !== 'https:' &&
        !(
          local &&
          env['NODE_ENV'] !== 'production' &&
          origin.protocol === 'http:'
        )) ||
      provider.protocol !== 'https:' ||
      provider.username ||
      provider.password ||
      provider.pathname !== '/' ||
      provider.search ||
      provider.hash ||
      !/^[a-z0-9-]+\.supabase\.co$/.test(provider.hostname) ||
      provider.port ||
      !env['SUPABASE_PUBLISHABLE_KEY']?.startsWith('sb_publishable_') ||
      !/^[0-9a-f]{64}$/.test(env['AUTH_SESSION_KEY'] ?? '') ||
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      !/^fmv_app(?:\.[a-z0-9-]+)?$/.test(database.username) ||
      !database.password ||
      database.hash ||
      (!localDatabase && database.searchParams.get('sslmode') !== 'verify-full')
    )
      throw new Error();
    return {
      origin: origin.origin,
      providerUrl: provider.origin,
      publicKey: env['SUPABASE_PUBLISHABLE_KEY']!,
      encryptionKey: Buffer.from(env['AUTH_SESSION_KEY']!, 'hex'),
      databaseUrl: env['DATABASE_URL']!,
      secure: origin.protocol === 'https:',
    };
  } catch {
    throw new Error(
      'Authentication configuration is invalid; check the documented server-only settings.',
    );
  }
}
