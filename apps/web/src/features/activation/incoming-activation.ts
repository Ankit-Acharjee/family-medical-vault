import { isActivationToken } from '@fmv/contracts';
export type IncomingActivation = { active: true; token: string | null };
export function parseIncomingActivation(
  hash: string,
): IncomingActivation | null {
  if (hash === '#activate') return { active: true, token: null };
  if (!hash.startsWith('#activate=')) return null;
  const token = hash.slice('#activate='.length);
  return { active: true, token: isActivationToken(token) ? token : null };
}
export function captureIncomingActivation() {
  const next = parseIncomingActivation(window.location.hash);
  if (next)
    window.history.replaceState(
      null,
      '',
      window.location.pathname + '#activate',
    );
  return next;
}
let seed: IncomingActivation | null = captureIncomingActivation();
export const incomingActivationSeed = () => seed;
export const clearActivationSeed = () => {
  seed = null;
};
export function activationUrl(base: string, token: string) {
  if (!isActivationToken(token)) throw Error('Invalid activation secret');
  const url = new URL(base);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error('Invalid application URL');
  url.search = '';
  url.hash = 'activate=' + token;
  return url.href;
}
