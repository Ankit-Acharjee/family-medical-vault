import { isTemporaryLinkToken } from '@fmv/contracts';
export type IncomingShare = { active: boolean; token: string | null };
export function parseIncomingShare(hash: string): IncomingShare {
  if (hash === '#shared') return { active: true, token: null };
  if (!hash.startsWith('#shared=')) return { active: false, token: null };
  const token = hash.slice('#shared='.length);
  return { active: true, token: isTemporaryLinkToken(token) ? token : null };
}
export function temporaryShareUrl(base: string, token: string) {
  if (!isTemporaryLinkToken(token)) throw Error('Invalid share capability');
  const url = new URL(base);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error('Invalid application URL');
  url.search = '';
  url.hash = `shared=${token}`;
  return url.href;
}
