import { useEffect, useRef, useState } from 'react';
import { Plus, History } from 'lucide-react';
import { isManualReadingsPage, isManualReadingHistory } from '@fmv/contracts';
import type { PatientSummary, ManualReadingEntry } from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogHeader,
  DialogDescription,
} from '../../components/ui/dialog';
import { usePatientContext } from '../patients';
import { useManualResource, useManualWrite } from './api';
import {
  draftReading,
  emptyDraft,
  manualLabels,
  manualValue,
  readingDraft,
} from './draft';
import { ManualReadingForm } from './ManualReadingForm';
type Action = {
  mode: 'create' | 'history' | 'edit' | 'withdraw';
  id: string;
  revision: number;
};
export function ManualReadingsPanel({
  patient,
  enabled,
}: {
  patient: PatientSummary;
  enabled: boolean;
}) {
  const eligible =
    patient.relationship === 'self' ||
    patient.capabilities.some(
      (c) => c.action === 'view' && c.scope.kind === 'patient',
    );
  return eligible ? (
    <ManualSurface key={patient.id} patient={patient} enabled={enabled} />
  ) : (
    <section
      aria-label="Manual readings"
      className="rounded-2xl border border-border bg-card p-5"
    >
      <h2 className="text-lg font-semibold">Manual readings</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Patient-wide View is required for manual readings. Your document and
        category access is unchanged.
      </p>
    </section>
  );
}
function ReadingSummary({ entry }: { entry: ManualReadingEntry }) {
  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <p className="text-xs text-muted-foreground">
        Manual / user-reported ·{' '}
        {entry.action === 'withdrawal' ? 'Withdrawn' : 'Recorded'} · revision{' '}
        {entry.revision}
      </p>
      <p className="mt-1 font-medium">{manualLabels[entry.reading.kind]}</p>
      <p className="mt-1 font-semibold tabular-nums">
        {manualValue(entry.reading)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Observed: {entry.reading.observedAt}
      </p>
    </div>
  );
}
function ManualSurface({
  patient,
  enabled,
}: {
  patient: PatientSummary;
  enabled: boolean;
}) {
  const context = usePatientContext(),
    base = `/api/patients/${encodeURIComponent(patient.id)}/manual-readings`;
  const [cursors, setCursors] = useState<(string | null)[]>([null]),
    [before, setBefore] = useState<(number | null)[]>([null]);
  const [action, setAction] = useState<Action | null>(null),
    [draft, setDraft] = useState(emptyDraft),
    [ack, setAck] = useState<string | null>(null),
    [notice, setNotice] = useState(''),
    [validation, setValidation] = useState(''),
    [accessError, setAccessError] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null),
    title = useRef<HTMLHeadingElement>(null),
    trigger = useRef<HTMLElement | null>(null);
  const [dialogElement, setDialogElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [dialogHeight, setDialogHeight] = useState(0);
  const denied = () => {
    setAccessError(true);
    setAction(null);
    setDraft(emptyDraft());
    setAck(null);
    setNotice('');
    context.reload();
  };
  const cursor = cursors.at(-1),
    historyBefore = before.at(-1);
  const list = useManualResource(
    enabled && !accessError
      ? base + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : '')
      : null,
    (v): v is import('@fmv/contracts').ManualReadingsPage =>
      isManualReadingsPage(v) && v.patientId === patient.id,
    denied,
  );
  const history = useManualResource(
    enabled && !accessError && action && action.mode !== 'create' && list.value
      ? `${base}/${action.id}${historyBefore ? `?beforeRevision=${historyBefore}` : ''}`
      : null,
    (v): v is import('@fmv/contracts').ManualReadingHistory =>
      isManualReadingHistory(v) &&
      v.current.patientId === patient.id &&
      v.current.readingId === action?.id,
    denied,
  );
  const ready = !!(
    enabled &&
    list.value &&
    action &&
    (action.mode === 'create' || history.value)
  );
  const current = history.value?.current;
  useEffect(() => {
    const node = dialogElement;
    if (!ready || !node) return;
    const observer = new ResizeObserver(() => {
      setDialogHeight((previous) =>
        Math.max(previous, Math.ceil(node.getBoundingClientRect().height)),
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ready, dialogElement]);
  const stale = !!(
    action &&
    ['edit', 'withdraw'].includes(action.mode) &&
    current &&
    action.revision !== current.revision
  );
  const owner =
    !!list.value?.canWrite &&
    (action?.mode === 'create' || !!history.value?.canWrite);
  const refresh = () => {
    setCursors([null]);
    list.reload();
  };
  const saved = () => {
    setNotice(
      action?.mode === 'withdraw'
        ? 'Manual reading withdrawn; history preserved.'
        : action?.mode === 'edit'
          ? 'Correction saved; previous versions preserved.'
          : 'Manual reading saved.',
    );
    setAction(null);
    setDraft(emptyDraft());
    setAck(null);
    refresh();
  };
  const write = useManualWrite(ready && owner && !stale, saved, denied);
  const locked = ['pending', 'uncertain', 'conflict'].includes(write.phase);
  const ackKey = JSON.stringify([
    action,
    action?.mode === 'withdraw' ? null : draft,
  ]);
  const acknowledged = ack !== null && ack === ackKey;
  const close = () => {
    if (write.phase === 'pending') return;
    if (write.phase === 'uncertain') {
      setNotice(
        'The save was not confirmed. Check the refreshed readings before creating another entry.',
      );
      refresh();
    }
    write.reset();
    setAction(null);
    setAck(null);
    setDraft(emptyDraft());
    setValidation('');
  };
  const begin = (next: Action, node: HTMLElement) => {
    setDialogHeight(0);
    trigger.current = node;
    write.reset();
    setNotice('');
    setValidation('');
    setBefore([null]);
    setAck(null);
    setDraft(emptyDraft());
    setAction(next);
  };
  const submit = () => {
    if (!action || !ready || !owner || stale || !acknowledged) return;
    const reading = draftReading(draft);
    if (action.mode !== 'withdraw' && !reading) {
      setValidation(
        'Check each value, selected unit, observation date/time and explicit UTC offset. Use non-negative decimal values, without signs or scientific notation.',
      );
      return;
    }
    setValidation('');
    const body = {
      requestId: crypto.randomUUID(),
      expectedRevision: action.revision,
      confirmed: true,
      ...(action.mode === 'withdraw' ? {} : { reading }),
    };
    void write.submit({
      url: `${base}/${action.id}${action.mode === 'withdraw' ? '/withdraw' : ''}`,
      method: action.mode === 'withdraw' ? 'POST' : 'PUT',
      body: JSON.stringify(body),
      revision: action.revision,
    });
  };
  return (
    <section
      aria-labelledby="manual-readings-heading"
      className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            ref={heading}
            tabIndex={-1}
            id="manual-readings-heading"
            className="text-lg font-semibold"
          >
            Manual readings
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            User-reported observations, separate from verified laboratory
            reports. Recent updates are listed first.
          </p>
        </div>
        {enabled && list.value?.canWrite && (
          <Button
            onClick={(e) =>
              begin(
                { mode: 'create', id: crypto.randomUUID(), revision: 0 },
                e.currentTarget,
              )
            }
          >
            <Plus size={16} aria-hidden="true" />
            Add reading
          </Button>
        )}
      </div>
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {!enabled ? (
        <p role="status" className="text-sm">
          Checking manual-reading access…
        </p>
      ) : accessError ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert">Manual-reading access could not be validated.</p>
          <Button
            variant="outline"
            onClick={() => {
              setAccessError(false);
              refresh();
            }}
          >
            Try again
          </Button>
        </div>
      ) : list.phase === 'failed' ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert">Manual readings could not be loaded.</p>
          <Button variant="outline" onClick={list.reload}>
            Try again
          </Button>
        </div>
      ) : !list.value ? (
        <p role="status" className="text-sm">
          Loading manual readings…
        </p>
      ) : (
        <>
          {!list.value.entries.length ? (
            <p className="text-sm text-muted-foreground">
              No manual readings are available.
              {list.value.canWrite
                ? ' Add an observation to start your history.'
                : ''}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {list.value.entries.map((entry) => (
                <li
                  key={entry.readingId}
                  className="flex min-w-0 flex-wrap items-start justify-between gap-3 py-4"
                >
                  <ReadingSummary entry={entry} />
                  <Button
                    variant="outline"
                    aria-label={`History: ${manualLabels[entry.reading.kind]}, ${manualValue(entry.reading)}`}
                    onClick={(e) =>
                      begin(
                        {
                          mode: 'history',
                          id: entry.readingId,
                          revision: entry.revision,
                        },
                        e.currentTarget,
                      )
                    }
                  >
                    <History size={16} aria-hidden="true" />
                    History
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={cursors.length === 1}
              onClick={() => setCursors((old) => old.slice(0, -1))}
            >
              Previous readings
            </Button>
            <Button
              variant="outline"
              disabled={!list.value.nextCursor}
              onClick={() =>
                setCursors((old) => [
                  ...old,
                  JSON.stringify(list.value!.nextCursor),
                ])
              }
            >
              Next readings
            </Button>
            <Button variant="ghost" onClick={refresh}>
              Refresh manual readings
            </Button>
          </div>
          {!list.value.canWrite && (
            <p className="text-xs text-muted-foreground">
              Only the profile owner can add, correct or withdraw manual
              readings.
            </p>
          )}
        </>
      )}
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          ref={setDialogElement}
          className="max-w-2xl content-start"
          style={
            dialogHeight
              ? { minHeight: `min(${dialogHeight}px, calc(100dvh - 2rem))` }
              : undefined
          }
          closeDisabled={write.phase === 'pending'}
          onEscapeKeyDown={(e) => {
            if (write.phase === 'pending') e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (write.phase === 'pending') e.preventDefault();
          }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            title.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            (trigger.current?.isConnected
              ? trigger.current
              : heading.current
            )?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle ref={title} tabIndex={-1}>
              {action?.mode === 'create'
                ? 'Add manual reading'
                : action?.mode === 'edit'
                  ? 'Correct manual reading'
                  : action?.mode === 'withdraw'
                    ? 'Withdraw manual reading'
                    : 'Manual reading history'}
            </DialogTitle>
            <DialogDescription className="[overflow-wrap:anywhere]">
              {enabled ? (
                <span className="mb-1 block font-medium text-foreground">
                  Patient: {patient.displayName}
                </span>
              ) : null}
              Manual / user-reported. These entries do not verify laboratory
              data. Earlier versions remain in history.
            </DialogDescription>
          </DialogHeader>
          {!enabled || !list.value ? (
            <p role="status">Checking manual-reading access…</p>
          ) : history.phase === 'failed' && action?.mode !== 'create' ? (
            <div className="flex flex-col items-start gap-3">
              <p role="alert">Reading history could not be loaded.</p>
              <Button variant="outline" onClick={history.reload}>
                Try again
              </Button>
            </div>
          ) : !ready ? (
            <p role="status">Loading current reading…</p>
          ) : stale ? (
            <p role="alert">
              The current reading changed. Close this dialog and reopen its
              latest history before saving.
            </p>
          ) : action?.mode === 'history' && current ? (
            <>
              <section
                aria-label="Current manual reading"
                className="rounded-xl border border-border bg-muted/30 p-4"
              >
                <h3 className="mb-3 text-sm font-semibold">Current state</h3>
                <ReadingSummary entry={current} />
              </section>
              {history.value?.canWrite && (
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDraft(readingDraft(current.reading));
                      setAck(null);
                      setAction({
                        ...action,
                        mode: 'edit',
                        revision: current.revision,
                      });
                    }}
                  >
                    Correct reading
                  </Button>
                  <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={() => {
                      setAck(null);
                      setAction({
                        ...action,
                        mode: 'withdraw',
                        revision: current.revision,
                      });
                    }}
                  >
                    Withdraw reading
                  </Button>
                </div>
              )}
              <section
                aria-label="Manual version history"
                className="flex min-w-0 flex-col gap-3"
              >
                <h3 className="text-sm font-semibold">Version history</h3>
                <p className="text-xs text-muted-foreground">
                  Earlier versions are historical; the current state stays
                  above.
                </p>
                <ol className="divide-y divide-border">
                  {history.value?.history.map((entry) => (
                    <li key={entry.revision} className="min-w-0 py-3">
                      <ReadingSummary entry={entry} />
                      <p className="mt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {entry.action} · saved {entry.recordedAt}
                      </p>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    disabled={before.length === 1}
                    onClick={() => setBefore((old) => old.slice(0, -1))}
                  >
                    Newer versions
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!history.value?.nextBeforeRevision}
                    onClick={() =>
                      setBefore((old) => [
                        ...old,
                        history.value!.nextBeforeRevision,
                      ])
                    }
                  >
                    Older versions
                  </Button>
                </div>
              </section>
            </>
          ) : (
            <>
              {!owner ? (
                <p role="alert">
                  Owner authority is unavailable. Close this dialog and refresh
                  access.
                </p>
              ) : (
                <>
                  {action?.mode === 'withdraw' ? (
                    <div className="flex min-w-0 flex-col gap-3">
                      <p className="text-sm">
                        Withdraw this reading from current use. Its values and
                        earlier corrections remain in history. This reading
                        identity cannot be edited afterward.
                      </p>
                      {current && <ReadingSummary entry={current} />}
                    </div>
                  ) : (
                    <ManualReadingForm
                      draft={draft}
                      onChange={(d) => {
                        setDraft(d);
                        setValidation('');
                      }}
                      editing={action?.mode === 'edit'}
                      disabled={locked}
                    />
                  )}
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1 size-5 shrink-0 accent-primary"
                      disabled={locked}
                      checked={acknowledged}
                      onChange={(e) => setAck(e.target.checked ? ackKey : null)}
                    />
                    <span>
                      {action?.mode === 'withdraw'
                        ? 'I want to withdraw this manual reading and retain its history.'
                        : 'I confirm the entered values, unit and observation time/offset as a manual reading.'}
                    </span>
                  </label>
                  {validation && (
                    <p role="alert" className="text-sm text-destructive">
                      {validation}
                    </p>
                  )}
                  <div className="flex flex-wrap justify-end gap-3">
                    <Button
                      variant="outline"
                      disabled={write.phase === 'pending'}
                      onClick={close}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant={
                        action?.mode === 'withdraw' ? 'outline' : 'default'
                      }
                      className={
                        action?.mode === 'withdraw'
                          ? 'text-destructive'
                          : undefined
                      }
                      disabled={
                        !acknowledged ||
                        write.phase === 'pending' ||
                        write.phase === 'conflict'
                      }
                      onClick={submit}
                    >
                      {write.phase === 'pending'
                        ? 'Saving…'
                        : write.phase === 'uncertain'
                          ? 'Retry safely'
                          : action?.mode === 'withdraw'
                            ? 'Confirm withdrawal'
                            : action?.mode === 'edit'
                              ? 'Save correction'
                              : 'Save reading'}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
          {write.phase === 'uncertain' && (
            <p role="alert" className="text-sm">
              The save could not be confirmed. Retry safely with the same
              request, or close and check refreshed readings before creating
              another entry.
            </p>
          )}
          {write.phase === 'conflict' && (
            <p role="alert" className="text-sm">
              This reading changed. Close and reopen the latest history; no
              write will repeat automatically.
            </p>
          )}
          {write.phase === 'invalid' && (
            <p role="alert" className="text-sm">
              The reading was not accepted. Check the values, unit and explicit
              observation offset before submitting again.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
