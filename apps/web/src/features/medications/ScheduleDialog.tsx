import { useEffect, useRef, useState } from 'react';
import {
  isMedicationScheduleHistory,
  medicationScheduleMatchesCurrent,
  medicationScheduleDefinitionValue,
} from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { useManualResource, useManualWrite } from '../manual-readings/api';
import {
  emptyScheduleDraft,
  recordedScheduleDraft,
  scheduleDraftDefinition,
} from './schedule-draft';
import { ScheduleForm } from './ScheduleForm';
import { ScheduleSummary } from './ScheduleSummary';
export function ScheduleDialog({
  patientId,
  patientName,
  medicationId,
  enabled,
  onClose,
  onSaved,
  onDenied,
  onRestoreFocus,
}: {
  patientId: string;
  patientName: string;
  medicationId: string;
  enabled: boolean;
  onClose: (uncertain?: boolean) => void;
  onSaved: () => void;
  onDenied: () => void;
  onRestoreFocus: () => void;
}) {
  const base = `/api/patients/${encodeURIComponent(patientId)}/medication-reconciliations/${encodeURIComponent(medicationId)}/schedule`;
  const [pages, setPages] = useState<(number | null)[]>([null]),
    [draft, setDraft] = useState(emptyScheduleDraft),
    [editing, setEditing] = useState(false),
    [retiring, setRetiring] = useState(false),
    [baseline, setBaseline] = useState<string | null>(null),
    [ack, setAck] = useState<string | null>(null),
    [validation, setValidation] = useState('');
  const [element, setElement] = useState<HTMLDivElement | null>(null),
    [height, setHeight] = useState(0);
  const requestId = useRef<string | null>(null),
    before = pages.at(-1);
  const resource = useManualResource(
    enabled ? base + (before ? `?beforeRevision=${before}` : '') : null,
    (v): v is import('@fmv/contracts').MedicationScheduleHistory =>
      isMedicationScheduleHistory(v) &&
      v.patientId === patientId &&
      v.medicationId === medicationId,
    onDenied,
  );
  const data = enabled ? resource.value : null,
    stamp = data
      ? JSON.stringify([
          data.medicationRevision,
          data.current?.revision ?? 0,
          data.sourceState,
        ])
      : null;
  useEffect(() => {
    if (!element || !data) return;
    const observer = new ResizeObserver(() =>
      setHeight((h) =>
        Math.max(h, Math.ceil(element.getBoundingClientRect().height)),
      ),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, data]);
  useEffect(() => {
    if (data && !data.canWrite) {
      setEditing(false);
      setRetiring(false);
      setDraft(emptyScheduleDraft());
      setBaseline(null);
      setAck(null);
    }
  }, [data]);
  const stale = baseline !== null && stamp !== null && baseline !== stamp;
  const ready =
    !!data?.canWrite &&
    !stale &&
    baseline !== null &&
    ((editing && data.sourceState === 'current-source') ||
      (retiring && data.current?.recordedState === 'recorded'));
  const write = useManualWrite(ready, onSaved, onDenied),
    locked = ['pending', 'uncertain', 'conflict'].includes(write.phase),
    ackKey = JSON.stringify([baseline, retiring, draft]);
  const close = () => {
    if (write.phase !== 'pending') onClose(write.phase === 'uncertain');
  };
  const start = (retire: boolean) => {
    if (!data || write.phase === 'pending') return;
    write.reset();
    requestId.current = null;
    setBaseline(stamp);
    setEditing(!retire);
    setRetiring(retire);
    setDraft(
      data.current
        ? recordedScheduleDraft(data.current.definition)
        : emptyScheduleDraft(),
    );
    setAck(null);
    setValidation('');
  };
  const reload = () => {
    write.reset();
    requestId.current = null;
    setEditing(false);
    setRetiring(false);
    setBaseline(null);
    setAck(null);
    setDraft(emptyScheduleDraft());
    setValidation('');
    setPages([null]);
    resource.reload();
  };
  const submit = () => {
    if (!data || !ready || ack !== ackKey || write.phase === 'pending') return;
    const definition =
      retiring && data.current
        ? medicationScheduleDefinitionValue(data.current.definition)
        : scheduleDraftDefinition(draft);
    if (!definition) {
      setValidation(
        'Enter timing as reported, or choose a valid named timezone, weekdays and unique clock times. Optional dates must be exact and ordered; text is limited to 120 characters.',
      );
      return;
    }
    requestId.current ??= crypto.randomUUID();
    void write.submit({
      url: base,
      method: 'PUT',
      revision: data.current?.revision ?? 0,
      body: JSON.stringify({
        requestId: requestId.current,
        expectedRevision: data.current?.revision ?? 0,
        medicationRevision: data.medicationRevision,
        confirmed: true,
        meaning: 'owner-recorded-informational-schedule',
        recordedState: retiring ? 'retired' : 'recorded',
        definition,
      }),
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        ref={setElement}
        closeDisabled={write.phase === 'pending'}
        style={{
          minHeight: height
            ? `min(${height}px, calc(100dvh - 2rem))`
            : undefined,
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onRestoreFocus();
        }}
        onEscapeKeyDown={(e) => {
          if (write.phase === 'pending') e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (write.phase === 'pending') e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Medication schedule</DialogTitle>
          <DialogDescription>
            Patient: {patientName}. Owner-recorded informational timing.
          </DialogDescription>
        </DialogHeader>
        {!enabled ? (
          <p role="status">Checking schedule access…</p>
        ) : resource.phase === 'failed' ? (
          <div className="space-y-3">
            <p role="alert">Schedule could not be loaded.</p>
            <Button variant="outline" onClick={resource.reload}>
              Try again
            </Button>
          </div>
        ) : !data ? (
          <p role="status">Loading schedule…</p>
        ) : (
          <div className="min-w-0 space-y-4">
            {data.medicationName && (
              <p className="font-medium [overflow-wrap:anywhere]">
                Medication: {data.medicationName}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Schedule timing is recorded separately from treatment status. No
              dose-taking confirmation is required.
            </p>
            {data.sourceState !== 'current-source' && (
              <div className="space-y-3">
                <p role="status" className="text-sm text-muted-foreground">
                  Review the prescription source and update the medication
                  record before recording a schedule. Source changes do not mean
                  treatment stopped.
                </p>
                {data.canWrite && (
                  <Button
                    variant="outline"
                    disabled={write.phase === 'pending'}
                    onClick={() => {
                      if (write.phase === 'pending') return;
                      close();
                      window.location.hash = 'documents';
                    }}
                  >
                    Review prescription documents
                  </Button>
                )}
              </div>
            )}
            {data.current ? (
              <div className="space-y-2">
                <h2 className="font-semibold">Latest recorded version</h2>
                <ScheduleSummary entry={data.current} />
                {data.current.recordedState === 'recorded' &&
                  !medicationScheduleMatchesCurrent(
                    data.current,
                    data.medicationRevision,
                    data.sourceState,
                  ) && (
                    <p role="status" className="text-sm text-muted-foreground">
                      This schedule needs owner review before use with the
                      current medication/source version. It has not been
                      automatically reactivated.
                    </p>
                  )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No schedule recorded. Timing is never created automatically from
                a prescription.
              </p>
            )}
            {data.canWrite && (stale || write.phase === 'conflict') ? (
              <div className="space-y-3">
                <p role="alert">
                  The medication, source or schedule version changed. Your draft
                  was not saved.
                </p>
                <Button
                  variant="outline"
                  disabled={write.phase === 'pending'}
                  onClick={reload}
                >
                  Discard draft and load latest
                </Button>
              </div>
            ) : ready ? (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <h2 className="font-semibold">
                  {retiring
                    ? 'Retire this informational schedule'
                    : data.current?.recordedState === 'retired'
                      ? 'Review and record schedule again'
                      : data.current
                        ? 'Review schedule changes'
                        : 'Record informational schedule'}
                </h2>
                {retiring ? (
                  <p className="text-sm text-muted-foreground">
                    The existing timing and history will be preserved.
                    Retirement affects only this schedule, not the medication's
                    treatment status.
                  </p>
                ) : (
                  <ScheduleForm
                    draft={draft}
                    disabled={locked}
                    onChange={(next) => {
                      setDraft(next);
                      setAck(null);
                      setValidation('');
                      if (write.phase === 'invalid') {
                        write.reset();
                        requestId.current = null;
                      }
                    }}
                  />
                )}
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-primary"
                    checked={ack === ackKey}
                    disabled={locked}
                    onChange={(e) => setAck(e.target.checked ? ackKey : null)}
                  />
                  <span>
                    {retiring
                      ? 'I confirm retiring only this informational schedule. This does not mean medication stopped.'
                      : 'I reviewed this timing and explicitly confirm the recorded schedule for the current medication version. This does not prescribe treatment.'}
                  </span>
                </label>
                {validation && (
                  <p role="alert" className="text-sm text-destructive">
                    {validation}
                  </p>
                )}
                {write.phase === 'invalid' && (
                  <p role="alert" className="text-sm text-destructive">
                    The schedule was not accepted. Check its timing and confirm
                    again.
                  </p>
                )}
                {write.phase === 'uncertain' && (
                  <div className="space-y-3">
                    <p role="alert">
                      The save was not confirmed. Retry the exact request or
                      check the latest schedule.
                    </p>
                    <Button variant="outline" onClick={resource.reload}>
                      Check latest schedule version
                    </Button>
                  </div>
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
                    type="submit"
                    disabled={ack !== ackKey || write.phase === 'pending'}
                  >
                    {write.phase === 'pending'
                      ? 'Saving schedule…'
                      : write.phase === 'uncertain'
                        ? 'Retry exact save'
                        : retiring
                          ? 'Confirm schedule retirement'
                          : 'Confirm recorded schedule'}
                  </Button>
                </div>
              </form>
            ) : data.canWrite && !editing && !retiring ? (
              <div className="flex flex-wrap gap-3">
                <Button
                  disabled={data.sourceState !== 'current-source'}
                  onClick={() => start(false)}
                >
                  {!data.current
                    ? 'Record schedule'
                    : data.current.recordedState === 'retired' ||
                        !medicationScheduleMatchesCurrent(
                          data.current,
                          data.medicationRevision,
                          data.sourceState,
                        )
                      ? 'Review and record schedule'
                      : 'Edit schedule'}
                </Button>
                {data.current?.recordedState === 'recorded' && (
                  <Button variant="outline" onClick={() => start(true)}>
                    Retire schedule
                  </Button>
                )}
              </div>
            ) : null}
            {(data.history.some((e) => e.revision !== data.current?.revision) ||
              pages.length > 1 ||
              data.nextBeforeRevision !== null) && (
              <section className="space-y-3" aria-label="Schedule history">
                <h2 className="font-semibold">Preserved schedule versions</h2>
                {data.history
                  .filter((e) => e.revision !== data.current?.revision)
                  .map((e) => (
                    <ScheduleSummary key={e.revision} entry={e} />
                  ))}
                <nav
                  aria-label="Schedule history pages"
                  className="flex flex-wrap gap-3"
                >
                  <Button
                    variant="outline"
                    disabled={pages.length === 1 || write.phase === 'pending'}
                    onClick={() => setPages((p) => p.slice(0, -1))}
                  >
                    Newer schedule versions
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      !data.nextBeforeRevision || write.phase === 'pending'
                    }
                    onClick={() => {
                      if (data.nextBeforeRevision)
                        setPages((p) => [...p, data.nextBeforeRevision]);
                    }}
                  >
                    Older schedule versions
                  </Button>
                </nav>
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
