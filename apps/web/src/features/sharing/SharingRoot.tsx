import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { parseIncomingShare } from './incoming-share';
import type { IncomingShare } from './incoming-share';
import { RecipientView } from './RecipientView';
function consume(): IncomingShare {
  const incoming = parseIncomingShare(window.location.hash);
  if (incoming.active)
    window.history.replaceState(null, '', window.location.pathname + '#shared');
  return incoming;
}
// Capture once before StrictMode renders; clear this module reference after mount.
// Secrets stay in ephemeral component state, never storage or a request URL.
let initial: IncomingShare | null = consume();
export function SharingRoot({ children }: { children: ReactNode }) {
  const [incoming, setIncoming] = useState<IncomingShare>(
    initial ?? { active: false, token: null },
  );
  useEffect(() => {
    initial = null;
    const change = () => setIncoming(consume());
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return incoming.active ? (
    <RecipientView
      key={incoming.token ?? 'missing'}
      token={incoming.token}
      onExit={() => {
        setIncoming({ active: false, token: null });
        window.location.hash = 'auth-login';
      }}
    />
  ) : (
    children
  );
}
