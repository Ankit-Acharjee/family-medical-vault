import { useEffect, useRef, useState } from 'react';
import { KeyRound, Moon, Sun } from 'lucide-react';
import {
  isActivationInspection,
  isActivationClaimStatus,
} from '@fmv/contracts';
import type {
  ActivationInspection,
  ActivationClaimStatus,
} from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import { useTheme } from '../../hooks/use-theme';
import { ManualApiError } from '../manual-readings/api';
import { sharingJson } from '../sharing/api';
export function ActivationClaimView({
  token,
  onExit,
}: {
  token: string | null;
  onExit: () => void;
}) {
  const { theme, toggleTheme } = useTheme(),
    [phase, setPhase] = useState<
      | 'idle'
      | 'loading'
      | 'review'
      | 'claimed'
      | 'accepted'
      | 'failed'
      | 'denied'
      | 'deferred'
    >('idle'),
    [review, setReview] = useState<ActivationInspection | null>(null),
    [claim, setClaim] = useState<ActivationClaimStatus | null>(null),
    [confirmed, setConfirmed] = useState(false);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const request = useRef<AbortController | null>(null),
    sequence = useRef(0),
    next = useRef<'inspect' | 'claim' | 'status'>('inspect'),
    started = useRef(false),
    scope = useRef<{ patientId: string; claimantRef: string | null } | null>(
      null,
    );
  useEffect(() => {
    if (started.current && phase !== 'idle' && phase !== 'loading')
      heading.current?.focus();
  }, [phase]);
  useEffect(
    () => () => {
      request.current?.abort();
      sequence.current++;
    },
    [],
  );
  async function run(action = next.current) {
    if (!token) return;
    request.current?.abort();
    const abort = new AbortController(),
      version = ++sequence.current;
    request.current = abort;
    next.current = action;
    started.current = true;
    setReview(null);
    setClaim(null);
    setConfirmed(false);
    setPhase('loading');
    const timer = window.setTimeout(() => abort.abort(), 15000);
    try {
      const value = await sharingJson(
        '/api/profile-activation/' + action,
        { token, ...(action === 'claim' ? { confirmed: true } : {}) },
        abort.signal,
      );
      abort.signal.throwIfAborted();
      if (version !== sequence.current) return;
      if (action === 'inspect') {
        if (!isActivationInspection(value)) throw Error();
        if (
          scope.current &&
          (scope.current.patientId !== value.patientId ||
            (scope.current.claimantRef &&
              scope.current.claimantRef !== value.claimantRef))
        )
          throw Error();
        scope.current = {
          patientId: value.patientId,
          claimantRef: value.claimantRef,
        };
        if (Date.parse(value.expiresAt) <= Date.now()) {
          setPhase('denied');
          return;
        }
        setReview(value);
        setPhase('review');
      } else {
        if (!isActivationClaimStatus(value)) throw Error();
        if (
          scope.current &&
          (scope.current.patientId !== value.patientId ||
            (scope.current.claimantRef &&
              scope.current.claimantRef !== value.claimantRef))
        )
          throw Error();
        scope.current = {
          patientId: value.patientId,
          claimantRef: value.claimantRef,
        };
        setClaim(value);
        setPhase(value.state);
        next.current = 'status';
      }
    } catch (e) {
      if (version !== sequence.current) return;
      setPhase(
        e instanceof ManualApiError && e.status === 409
          ? 'deferred'
          : e instanceof ManualApiError &&
              [400, 401, 403, 404].includes(e.status)
            ? 'denied'
            : 'failed',
      );
    } finally {
      window.clearTimeout(timer);
      if (request.current === abort) request.current = null;
    }
  }
  useEffect(() => {
    const hide = () => {
        if (document.visibilityState === 'hidden') {
          request.current?.abort();
          sequence.current++;
          setReview(null);
          setClaim(null);
          setConfirmed(false);
          setPhase('idle');
        } else if (started.current) void run();
      },
      focus = () => {
        if (started.current) void run();
      };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('focus', focus);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('focus', focus);
    };
  });
  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground">
      <section
        className="mx-auto max-w-xl space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-8"
        aria-labelledby="activation-title"
      >
        <header className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">
            Family Medical Vault
          </p>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? (
              <Sun aria-hidden="true" />
            ) : (
              <Moon aria-hidden="true" />
            )}
          </Button>
        </header>
        <KeyRound className="text-primary" aria-hidden="true" />
        <h1
          id="activation-title"
          ref={heading}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight"
        >
          Activate your managed profile
        </h1>
        <p className="text-sm text-muted-foreground">
          A claim grants no records or ownership. The original caregiver must
          separately approve your exact claimant reference. Existing personal
          identities require review; profiles are never merged automatically.
        </p>
        {!token || phase === 'denied' ? (
          <p role="alert">
            Activation is unavailable, expired or revoked. Reopen the original
            activation link in this signed-in browser, or ask the creator for a
            new link.
          </p>
        ) : phase === 'deferred' ? (
          <p role="alert">
            This identity or claim requires review. No profiles were merged or
            records moved. Contact the managed-profile creator; do not create
            another identity to work around this check.
          </p>
        ) : phase === 'loading' ? (
          <p role="status">Checking current activation access…</p>
        ) : phase === 'failed' ? (
          <div className="space-y-3">
            <p role="alert">
              The operation could not be confirmed. Retry the same operation to
              resolve its status.
            </p>
            <Button onClick={() => void run()}>
              Retry activation operation
            </Button>
          </div>
        ) : phase === 'review' && review ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
              <p className="font-medium">Profile: {review.patientName}</p>
              <p className="mt-1 text-muted-foreground">
                Expires {new Date(review.expiresAt).toLocaleString()}.
              </p>
            </div>
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-5 shrink-0 accent-primary"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I am the intended person for this profile and want to request
              activation. I will verify my claimant reference with its creator
              through another channel.
            </label>
            <Button disabled={!confirmed} onClick={() => void run('claim')}>
              Request creator approval
            </Button>
          </div>
        ) : claim && phase === 'claimed' ? (
          <div className="space-y-3">
            <h2 className="font-semibold">Waiting for creator approval</h2>
            <p className="text-sm">
              Give the creator this exact reference through a channel you both
              trust. Your claim has not activated ownership or record access.
            </p>
            <p className="break-words rounded-lg border border-border bg-muted/40 p-3 font-mono text-sm">
              {claim.claimantRef}
            </p>
            <Button variant="outline" onClick={() => void run('status')}>
              Check approval status
            </Button>
          </div>
        ) : claim && phase === 'accepted' ? (
          <div className="space-y-3">
            <p role="status">
              Profile activated. Its permanent Person ID and existing records
              are preserved.
            </p>
            <Button onClick={onExit}>Open my activated account</Button>
          </div>
        ) : (
          <Button onClick={() => void run('inspect')}>
            Review activation request
          </Button>
        )}
        <Button variant="ghost" onClick={onExit}>
          Leave activation
        </Button>
      </section>
    </main>
  );
}
