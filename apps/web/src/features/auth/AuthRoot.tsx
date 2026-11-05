import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthAccount, AuthBootstrap, AuthNotice } from '@fmv/contracts';
import { Moon, Sun } from 'lucide-react';
import { AuthPanel } from './AuthPanel';
import type { AuthMode } from './AuthPanel';
import { Button } from '../../components/ui/button';
import { useTheme } from '../../hooks/use-theme';

class AuthRequestError extends Error {
  constructor(readonly status: number) {
    super('Authentication request failed');
  }
}
async function request<T>(
  path: string,
  csrf?: string | null,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers:
      body === undefined
        ? {}
        : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new AuthRequestError(response.status);
  return response.json() as Promise<T>;
}
const modeFromHash = (): AuthMode => {
  const value = window.location.hash.replace('#auth-', '');
  return ['login', 'register', 'recover', 'reset', 'verify'].includes(value)
    ? (value as AuthMode)
    : 'login';
};

export function AuthRoot({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrap] = useState<AuthBootstrap | null>(null);
  const [account, setAccount] = useState<AuthAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [hash, setHash] = useState(window.location.hash);
  const [mode, setMode] = useState<AuthMode>(modeFromHash);
  const { theme, toggleTheme } = useTheme();
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const boot = await request<AuthBootstrap>('bootstrap');
      if (version !== loadVersion.current) return;
      setBootstrap(boot);
      if (!boot.enabled) {
        setAccount(null);
        setError(
          'Sign-in is unavailable until the development authentication service is configured.',
        );
        return;
      }
      let next: AuthAccount | null = null;
      try {
        next = await request<AuthAccount>('account');
      } catch (error) {
        if (
          !(error instanceof AuthRequestError) ||
          ![401, 403].includes(error.status)
        )
          throw error;
      }
      if (version !== loadVersion.current) return;
      setAccount(next);
      if (window.location.hash !== '#auth-error') setError('');
    } catch {
      if (version === loadVersion.current) {
        setAccount(null);
        setError('Sign-in is temporarily unavailable. Please try again.');
      }
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const change = () => {
      setHash(window.location.hash);
      setMode(modeFromHash());
      setError('');
      setNotice('');
      if (window.location.hash === '#auth-error')
        setError(
          'This link is invalid, expired or already used. Please start again in the same browser.',
        );
    };
    window.addEventListener('hashchange', change);
    if (window.location.hash === '#auth-error')
      setError(
        'This link is invalid, expired or already used. Please start again in the same browser.',
      );
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    if (mode !== 'reset' || !bootstrap?.enabled) return;
    void request('recovery').catch(() => {
      setMode('login');
      window.location.hash = 'auth-error';
    });
  }, [mode, bootstrap?.enabled]);
  useEffect(() => {
    if (!account) return;
    const check = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = window.setInterval(check, 60_000);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [account, load]);
  const changeMode = (next: AuthMode) => {
    window.location.hash = `auth-${next}`;
  };
  async function action(work: () => Promise<void>) {
    if (busy || !bootstrap?.enabled) return;
    ++loadVersion.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (error) {
      const status = error instanceof AuthRequestError ? error.status : 0;
      setError(
        status === 429
          ? 'Too many attempts. Please wait before trying again.'
          : status === 401 || status === 403
            ? 'Unable to continue. Check your details, verify your email, or start a new sign-in.'
            : 'The request could not be completed. Please try again.',
      );
      if (mode === 'reset') {
        setAccount(null);
        changeMode('login');
      }
    } finally {
      setBusy(false);
    }
  }

  const accountPage = hash === '#account';
  useEffect(() => {
    if (accountPage && account)
      document.getElementById('account-title')?.focus();
    if (!account || accountPage)
      document.title = `${accountPage && account ? 'Your account' : 'Account access'} | Family Medical Vault`;
  }, [accountPage, account]);
  if (account && !accountPage && mode !== 'reset') return children;
  return (
    <main className="auth-screen">
      <div className="auth-theme">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label={
            theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'
          }
        >
          {theme === 'light' ? (
            <Moon aria-hidden="true" />
          ) : (
            <Sun aria-hidden="true" />
          )}
        </Button>
      </div>
      {loading ? (
        <p role="status">Checking your session…</p>
      ) : account && accountPage ? (
        <section className="auth-panel" aria-labelledby="account-title">
          <h1 id="account-title" tabIndex={-1}>
            Your account
          </h1>
          <p>{account.email}</p>
          <p>No patient profiles are linked yet.</p>
          {error && <p role="alert">{error}</p>}
          <div className="account-actions">
            <Button asChild variant="outline">
              <a href="#overview">Back to vault</a>
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  try {
                    await request('logout', bootstrap?.csrf, {});
                  } finally {
                    setAccount(null);
                    window.location.hash = 'auth-login';
                  }
                })
              }
            >
              {busy ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        </section>
      ) : (
        <AuthPanel
          mode={mode}
          busy={busy || !bootstrap?.enabled}
          {...(error ? { error } : {})}
          {...(notice ? { notice } : {})}
          onModeChange={changeMode}
          onSubmit={(values) =>
            void action(async () => {
              if (mode === 'login') {
                await request('login', bootstrap?.csrf, values);
                setAccount(await request<AuthAccount>('account'));
                window.location.hash = 'overview';
              }
              if (mode === 'register') {
                const result = await request<AuthNotice>(
                  'register',
                  bootstrap?.csrf,
                  values,
                );
                setMode('verify');
                setNotice(result.message);
              }
              if (mode === 'recover') {
                const result = await request<AuthNotice>(
                  'recover',
                  bootstrap?.csrf,
                  { email: values.email },
                );
                setNotice(result.message);
              }
              if (mode === 'reset') {
                await request('reset', bootstrap?.csrf, {
                  password: values.password,
                });
                setAccount(null);
                setMode('login');
                window.history.replaceState(null, '', '/#auth-login');
                setNotice(
                  'Password updated. Sign in again; previous application sessions have been ended.',
                );
              }
            })
          }
          onGoogle={() =>
            void action(async () => {
              const result = await request<{ url: string }>(
                'google',
                bootstrap?.csrf,
                {},
              );
              // Only this provider's authorization endpoint may receive navigation.
              const target = new URL(result.url);
              if (
                target.protocol !== 'https:' ||
                !/^[a-z0-9-]+\.supabase\.co$/.test(target.hostname) ||
                target.pathname !== '/auth/v1/authorize' ||
                target.username ||
                target.password ||
                target.port
              )
                throw new Error();
              window.location.assign(target.href);
            })
          }
          onResend={(email) =>
            void action(async () => {
              const result = await request<AuthNotice>(
                'resend',
                bootstrap?.csrf,
                { email },
              );
              setNotice(result.message);
            })
          }
        />
      )}
      {!loading && !bootstrap?.enabled && (
        <Button
          variant="outline"
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          Try again
        </Button>
      )}
    </main>
  );
}
