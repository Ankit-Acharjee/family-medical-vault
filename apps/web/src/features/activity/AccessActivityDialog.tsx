import { useEffect, useRef, useState } from 'react';
import { isAccessActivity } from '@fmv/contracts';
import type { AccessActivity } from '@fmv/contracts';
import { Eye, Download, Link, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { ManualApiError, manualJson } from '../manual-readings/api';
const labels = {
  'document.viewed': 'Document information viewed',
  'document.exported': 'Original accessed for export',
  'link.opened': 'Shared selection opened',
  'original.accessed': 'Shared original accessed',
};
const actors = {
  you: 'You',
  'authenticated-account': 'Authenticated account',
  'anonymous-link-holder': 'Anonymous link holder',
};
export function AccessActivityDialog({
  patientId,
  patientName,
  enabled,
  onClose,
  onRestoreFocus,
}: {
  enabled: boolean;
  patientId: string;
  patientName: string;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0),
    [state, setState] = useState<
      | { phase: 'loading' | 'failed' | 'denied' }
      | { phase: 'ready'; value: AccessActivity }
    >({ phase: 'loading' });
  const generation = useRef(0),
    heading = useRef<HTMLHeadingElement>(null),
    focusResult = useRef(false);
  useEffect(() => {
    if (state.phase === 'ready' && focusResult.current) {
      heading.current?.focus();
      focusResult.current = false;
    }
  }, [state]);
  useEffect(() => {
    const refresh = () => {
      generation.current++;
      setState({ phase: 'loading' });
      setCursor(null);
      setAttempt((n) => n + 1);
    };
    const visibility = () => {
      if (document.hidden) {
        generation.current++;
        setState({ phase: 'loading' });
      } else refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    if (document.hidden || !enabled) {
      setState({ phase: 'loading' });
      return;
    }
    const abort = new AbortController(),
      version = ++generation.current;
    setState({ phase: 'loading' });
    const timer = window.setTimeout(() => {
      abort.abort();
      if (generation.current === version) setState({ phase: 'failed' });
    }, 15000);
    void manualJson(
      `/api/patients/${encodeURIComponent(patientId)}/access-activity${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`,
      abort.signal,
    )
      .then((value) => {
        if (abort.signal.aborted || version !== generation.current) return;
        if (
          !isAccessActivity(value) ||
          value.patientId !== patientId ||
          (value.nextCursor !== null && value.nextCursor === cursor)
        )
          throw Error();
        setState({ phase: 'ready', value });
      })
      .catch((error) => {
        if (abort.signal.aborted || version !== generation.current) return;
        setState({
          phase:
            error instanceof ManualApiError &&
            [401, 403, 404].includes(error.status)
              ? 'denied'
              : 'failed',
        });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [patientId, cursor, attempt, enabled]);
  const value = state.phase === 'ready' ? state.value : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="content-start"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Document access history</DialogTitle>
          <DialogDescription>
            Patient: {patientName}. Ordinary access events from the last 90
            days. Owner access only.
          </DialogDescription>
        </DialogHeader>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <ShieldCheck size={18} className="shrink-0" aria-hidden="true" />
          Activity records access, not proof that a downloaded copy was saved.
          Critical security history is separate.
        </p>
        {!enabled || state.phase === 'loading' ? (
          <p role="status">Checking activity access…</p>
        ) : state.phase === 'denied' ? (
          <p role="alert">Activity is unavailable for your current access.</p>
        ) : state.phase === 'failed' ? (
          <div className="space-y-3">
            <p role="alert">Access history could not be loaded.</p>
            <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              Try history again
            </Button>
          </div>
        ) : (
          value && (
            <section aria-label="Access events" className="space-y-4">
              <h3
                ref={heading}
                tabIndex={-1}
                className="text-base font-semibold"
              >
                {cursor ? 'Earlier activity' : 'Recent activity'}
              </h3>
              {value.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {cursor
                    ? 'No earlier events remain in the retention window.'
                    : 'No ordinary document access is recorded in the last 90 days.'}
                </p>
              ) : (
                <ol className="divide-y divide-border">
                  {value.events.map((event) => {
                    const Icon =
                      event.kind === 'document.viewed'
                        ? Eye
                        : event.kind === 'document.exported'
                          ? Download
                          : Link;
                    return (
                      <li
                        key={event.source + event.id}
                        className="flex gap-3 py-4 first:pt-0"
                      >
                        <Icon
                          size={18}
                          className="mt-1 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-medium">
                            {labels[event.kind]}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {actors[event.actor]} · Access recorded
                          </p>
                          <time
                            dateTime={event.recordedAt}
                            className="block text-xs text-muted-foreground"
                          >
                            {new Date(event.recordedAt).toLocaleString()}
                          </time>
                          <p className="break-words text-xs text-muted-foreground">
                            {event.documentId
                              ? event.documentLabel
                              : 'Selected shared documents'}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
              <div className="flex flex-wrap gap-2">
                {cursor && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCursor(null);
                      focusResult.current = true;
                    }}
                  >
                    Back to recent activity
                  </Button>
                )}
                {value.nextCursor && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCursor(value.nextCursor);
                      focusResult.current = true;
                    }}
                  >
                    Earlier activity
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCursor(null);
                    setAttempt((n) => n + 1);
                  }}
                >
                  Refresh history
                </Button>
              </div>
            </section>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
