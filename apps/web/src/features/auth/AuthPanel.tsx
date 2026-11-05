import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import './auth-panel.css';

export type AuthMode = 'login' | 'register' | 'recover' | 'reset' | 'verify';

type AuthValues = { email: string; password: string };

export interface AuthPanelProps {
  mode: AuthMode;
  busy: boolean;
  error?: string;
  notice?: string;
  onModeChange: (mode: AuthMode) => void;
  onSubmit: (values: AuthValues) => void;
  onGoogle: () => void;
  onResend: (email: string) => void;
}

const headings: Record<AuthMode, string> = {
  login: 'Sign in to your account',
  register: 'Create your account',
  recover: 'Reset your password',
  reset: 'Choose a new password',
  verify: 'Check your inbox',
};

export function AuthPanel({
  mode,
  busy,
  error,
  notice,
  onModeChange,
  onSubmit,
  onGoogle,
  onResend,
}: AuthPanelProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const heading = headings[mode];
  const isPasswordMode = mode === 'register' || mode === 'reset';

  useEffect(() => {
    headingRef.current?.focus();
    setPassword('');
    setConfirmPassword('');
    setLocalError('');
  }, [mode]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError('');
    if (isPasswordMode && password !== confirmPassword) {
      setLocalError('The passwords do not match.');
      return;
    }
    onSubmit({ email, password });
    setPassword('');
    setConfirmPassword('');
  }

  return (
    <section
      className="auth-panel"
      aria-labelledby="auth-heading"
      aria-busy={busy}
    >
      <header className="auth-panel__header">
        <p className="auth-panel__eyebrow">Family Medical Vault</p>
        <h1 id="auth-heading" ref={headingRef} tabIndex={-1}>
          {heading}
        </h1>
        <p className="auth-panel__intro">
          {mode === 'register' && 'Create a secure account to get started.'}
          {mode === 'login' && 'Enter your email and password to continue.'}
          {mode === 'recover' &&
            'Enter your email and we’ll help you reset your password.'}
          {mode === 'reset' &&
            'Use a new password with at least 12 characters.'}
          {mode === 'verify' &&
            'If this address is eligible, a verification message will arrive. Open the link in this browser to continue.'}
        </p>
      </header>

      {notice && (
        <p className="auth-panel__notice" role="status">
          {notice}
        </p>
      )}
      {(error || localError) && (
        <p className="auth-panel__error" role="alert">
          {localError || error}
        </p>
      )}

      {mode === 'verify' ? (
        <form
          className="auth-panel__form"
          onSubmit={(event) => {
            event.preventDefault();
            onResend(email);
          }}
        >
          <label htmlFor="auth-email">Email address</label>
          <Input
            id="auth-email"
            type="email"
            name="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={busy || !email.trim()}
          >
            {busy ? 'Sending…' : 'Resend verification email'}
          </Button>
          {busy && (
            <span className="auth-panel__progress" role="status">
              Please wait…
            </span>
          )}
        </form>
      ) : (
        <form className="auth-panel__form" onSubmit={submit}>
          {mode !== 'reset' && (
            <>
              <label htmlFor="auth-email">Email address</label>
              <Input
                id="auth-email"
                type="email"
                name="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
              />
            </>
          )}
          {mode !== 'recover' && (
            <>
              <label htmlFor="auth-password">
                {isPasswordMode ? 'New password' : 'Password'}
              </label>
              <Input
                id="auth-password"
                type="password"
                name="password"
                autoComplete={
                  isPasswordMode ? 'new-password' : 'current-password'
                }
                required
                minLength={isPasswordMode ? 12 : undefined}
                maxLength={isPasswordMode ? 128 : undefined}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
              {isPasswordMode && (
                <>
                  <label htmlFor="auth-confirm-password">
                    Confirm new password
                  </label>
                  <Input
                    id="auth-confirm-password"
                    type="password"
                    name="confirmPassword"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    disabled={busy}
                  />
                </>
              )}
            </>
          )}
          <Button type="submit" disabled={busy}>
            {busy
              ? 'Please wait…'
              : mode === 'login'
                ? 'Sign in'
                : mode === 'register'
                  ? 'Create account'
                  : mode === 'recover'
                    ? 'Send reset instructions'
                    : 'Save new password'}
          </Button>
          {busy && (
            <span className="auth-panel__progress" role="status">
              Please wait…
            </span>
          )}
          {(mode === 'login' || mode === 'register') && (
            <>
              <div className="auth-panel__divider">
                <span>or</span>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={onGoogle}
                disabled={busy}
              >
                Continue with Google
              </Button>
            </>
          )}
        </form>
      )}

      <nav className="auth-panel__nav" aria-label="Account options">
        {(mode === 'login' || mode === 'register') && (
          <>
            {mode === 'login' ? (
              <p>
                New here?{' '}
                <button
                  type="button"
                  onClick={() => onModeChange('register')}
                  disabled={busy}
                >
                  Create an account
                </button>
              </p>
            ) : (
              <p>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => onModeChange('login')}
                  disabled={busy}
                >
                  Sign in
                </button>
              </p>
            )}
            <button
              type="button"
              onClick={() => onModeChange('recover')}
              disabled={busy}
            >
              Forgot password?
            </button>
          </>
        )}
        {(mode === 'recover' || mode === 'reset' || mode === 'verify') && (
          <button
            type="button"
            onClick={() => onModeChange('login')}
            disabled={busy}
          >
            Back to sign in
          </button>
        )}
      </nav>
    </section>
  );
}
