export type IncomingLink = { kind: 'invite' | 'request'; token: string };
let incoming: IncomingLink | null = null;

export function captureIncomingLink(): IncomingLink | null {
  const hash = window.location.hash;
  const question = hash.indexOf('?');
  if (question < 0 || hash.slice(0, question) !== '#family-access') return null;
  const params = new URLSearchParams(hash.slice(question + 1));
  const invite = params.get('invite');
  const request = params.get('request');
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}#family-access`,
  );
  const token = invite ?? request;
  incoming =
    token && /^[A-Za-z0-9_-]{20,256}$/.test(token)
      ? { kind: invite ? 'invite' : 'request', token }
      : null;
  return incoming;
}

export function getIncomingLink() {
  return incoming;
}
export function clearIncomingLink() {
  incoming = null;
}

captureIncomingLink();
