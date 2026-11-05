import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

export const opaque = () => randomBytes(32).toString('base64url');
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const challenge = (value: string) =>
  createHash('sha256').update(value).digest('base64url');
export const validOpaque = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

export function seal(value: unknown, key: Buffer, binding: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(binding));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return [
    '1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function unseal<T>(value: string, key: Buffer, binding: string): T {
  const [version, iv, tag, encrypted, extra] = value.split('.');
  if (version !== '1' || !iv || !tag || !encrypted || extra)
    throw new Error('Invalid session');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAAD(Buffer.from(binding));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8'),
  ) as T;
}
