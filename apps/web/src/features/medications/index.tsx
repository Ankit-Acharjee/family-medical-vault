import { usePageReminders } from './reminders/usePageReminders';
import { ScheduleDialog } from './ScheduleDialog';
import { InventoryDialog } from './InventoryDialog';
import { useEffect, useRef, useState } from 'react';
import { History, Pill, RefreshCw, Plus } from 'lucide-react';
import {
  isMedicationReconciliationsPage,
  isMedicationReconciliationHistory,
} from '@fmv/contracts';
import type { PatientSummary } from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import { ResourceState } from '../../components/ui/resource-state';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { usePatientContext } from '../patients';
import { useManualResource as useMedicationResource } from '../manual-readings/api';
import { MedicationSummary } from './MedicationSummary';
import { OwnerMedicationDialog } from './OwnerMedicationDialog';
import type { MedicationEditorTarget } from './OwnerMedicationDialog';
export function MedicationsPanel({
  onRequestPatient,
}: {
  onRequestPatient: () => void;
}) {
  const context = usePatientContext();
  const [retained, setRetained] = useState(context.selectedPatient);
  if (context.selectedPatient && context.selectedPatient.id !== retained?.id)
    setRetained(context.selectedPatient);
  if (!context.loading && !context.selectedPatient && retained)
    setRetained(null);
  const patient =
    context.selectedPatient ?? (context.loading ? retained : null);
  if (!patient)
    return context.loading ? (
      <p role="status">Checking patient access…</p>
    ) : (
      <ResourceState
        state="empty"
        title="Choose a patient"
        description="Select a patient to view their recorded medication context and prescription history."
        icon={<Pill size={28} aria-hidden="true" />}
        actionLabel="Select patient"
        onAction={onRequestPatient}
      />
    );
  const eligible =
    patient.relationship === 'self' ||
    patient.capabilities.some(
      (c) => c.action === 'view' && c.scope.kind === 'patient',
    );
  return eligible ? (
    <MedicationSurface
      key={patient.id}
      patient={patient}
      enabled={!context.loading && context.selectedPatient?.id === patient.id}
    />
  ) : (
    <ResourceState
      state="denied"
      title="Patient-wide View required"
      description="The medication list requires patient-wide View and current access to each source. Your permitted document and category access is unchanged."
    />
  );
}
function MedicationSurface({
  patient,
  enabled,
}: {
  patient: PatientSummary;
  enabled: boolean;
}) {
  const context = usePatientContext(),
    base = `/api/patients/${encodeURIComponent(patient.id)}/medication-reconciliations`;
  const [cursors, setCursors] = useState<(string | null)[]>([null]),
    [before, setBefore] = useState<(number | null)[]>([null]),
    [selected, setSelected] = useState<string | null>(null),
    [denied, setDenied] = useState(false),
    [editor, setEditor] = useState<MedicationEditorTarget | null>(null),
    [notice, setNotice] = useState(''),
    [inventoryId, setInventoryId] = useState<string | null>(null),
    [scheduleId, setScheduleId] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null),
    trigger = useRef<HTMLElement | null>(null);
  const [element, setElement] = useState<HTMLDivElement | null>(null),
    [height, setHeight] = useState(0);
  const onDenied = () => {
    setDenied(true);
    setSelected(null);
    setEditor(null);
    setNotice('');
    setInventoryId(null);
    setScheduleId(null);
    context.reload();
  };
  const cursor = cursors.at(-1),
    revision = before.at(-1);
  const list = useMedicationResource(
    enabled && !denied
      ? base + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : '')
      : null,
    (v): v is import('@fmv/contracts').MedicationReconciliationsPage =>
      isMedicationReconciliationsPage(v) && v.patientId === patient.id,
    onDenied,
  );
  const data = enabled ? list.value : null;
  const reminders = usePageReminders(
    patient.id,
    denied ? false : data ? data.canWrite : null,
  );
  useEffect(() => {
    if (enabled && data && !data.canWrite) setEditor(null);
  }, [enabled, data]);
  const history = useMedicationResource(
    data && selected
      ? `${base}/${selected}${revision ? `?beforeRevision=${revision}` : ''}`
      : null,
    (v): v is import('@fmv/contracts').MedicationReconciliationHistory =>
      isMedicationReconciliationHistory(v) &&
      v.current.entry.patientId === patient.id &&
      v.current.entry.medicationId === selected,
    onDenied,
  );
  const detail = data ? history.value : null;
  useEffect(() => {
    if (!detail || !element) return;
    const observer = new ResizeObserver(() =>
      setHeight((previous) =>
        Math.max(previous, Math.ceil(element.getBoundingClientRect().height)),
      ),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [detail, element]);
  const refresh = () => {
    setCursors([null]);
    list.reload();
  };
  return (
    <section aria-label="Recorded medications" className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Patient: {patient.displayName}
          </p>
          <h2
            ref={heading}
            tabIndex={-1}
            className="mt-1 text-xl font-semibold focus-visible:outline-2 focus-visible:outline-ring"
          >
            Recorded medication context
          </h2>
          <p className="mt-2 max-w-2xl text-pretty text-sm text-muted-foreground">
            Current and historical status is recorded explicitly by the owner.
            Source review alone does not create a medication record.
          </p>
        </div>
        {data && (
          <div className="flex flex-wrap gap-3">
            {data.canWrite && (
              <Button
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  setNotice('');
                  setEditor({ kind: 'create' });
                }}
              >
                <Plus size={16} aria-hidden="true" />
                Record medication
              </Button>
            )}
            <Button variant="outline" onClick={refresh}>
              <RefreshCw size={16} aria-hidden="true" />
              Refresh medications
            </Button>
          </div>
        )}
      </div>
      {reminders.items.length > 0 && (
        <section
          aria-label="Page reminders"
          className="space-y-3 rounded-xl border border-border bg-card p-4"
        >
          <p className="text-sm text-muted-foreground">
            Reminders run only while this Meds page is open and visible.
            Delivery is not guaranteed.
          </p>
          {reminders.items.some((i) => i.state === 'due') && (
            <p role="status" className="font-medium">
              A page reminder is due. Review your recorded schedule.
            </p>
          )}
          {reminders.items.some((i) => i.state === 'review') && (
            <p role="status" className="text-sm">
              A clock time needs owner review. No occurrence was chosen.
            </p>
          )}
          {reminders.items.some((i) => i.state === 'unavailable') && (
            <p role="status" className="text-sm">
              A reminder stopped because its current context could not be
              verified. Review the schedule before enabling again.
            </p>
          )}
          <Button variant="outline" onClick={() => reminders.session.stop()}>
            Stop page reminders
          </Button>
        </section>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {!enabled ? (
        <p role="status">Checking medication access…</p>
      ) : denied ? (
        <ResourceState
          state="denied"
          title="Medication access could not be validated"
          description="No medication details are shown. Recheck your current patient permissions."
          actionLabel="Check access again"
          onAction={() => {
            setDenied(false);
            context.reload();
            list.reload();
          }}
        />
      ) : list.phase === 'failed' ? (
        <ResourceState
          state="error"
          title="Medications could not be loaded"
          description="Your records have not changed. Try loading the list again."
          actionLabel="Try again"
          onAction={list.reload}
        />
      ) : !data ? (
        <p role="status">Loading recorded medications…</p>
      ) : (
        <>
          {!data.entries.length ? (
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-lg font-semibold">
                No recorded medications on this page
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Prescription source statements and recorded medication context
                are separate. No treatment status is inferred from an upload.
              </p>
              <a
                className="text-link mt-4 inline-flex min-h-11 items-center"
                href="#documents"
              >
                Review prescription documents
              </a>
            </div>
          ) : (
            <>
              {(['current', 'historical'] as const).map((status) => (
                <section
                  key={status}
                  aria-label={`Recorded ${status}`}
                  className="space-y-3"
                >
                  <h3 className="text-lg font-semibold">Recorded {status}</h3>
                  {data.entries.filter((r) => r.entry.recordedStatus === status)
                    .length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No {status} entries on this page.
                    </p>
                  ) : (
                    <ul className="grid min-w-0 gap-3 lg:grid-cols-2">
                      {data.entries
                        .filter((r) => r.entry.recordedStatus === status)
                        .map((record) => (
                          <li
                            key={record.entry.medicationId}
                            className="min-w-0 rounded-2xl border border-border bg-card p-5"
                          >
                            <MedicationSummary record={record} />
                            <div className="mt-4 flex flex-wrap gap-3">
                              <Button
                                variant="outline"
                                onClick={(e) => {
                                  trigger.current = e.currentTarget;
                                  setHeight(0);
                                  setBefore([null]);
                                  setSelected(record.entry.medicationId);
                                }}
                              >
                                <History size={16} aria-hidden="true" />
                                Details and history
                                <span className="sr-only">
                                  {' '}
                                  for {record.entry.fields.medication}
                                </span>
                              </Button>
                              <Button
                                variant="outline"
                                onClick={(event) => {
                                  trigger.current = event.currentTarget;
                                  setInventoryId(record.entry.medicationId);
                                  setNotice('');
                                }}
                              >
                                Inventory
                                <span className="sr-only">
                                  {' '}
                                  for {record.entry.fields.medication}
                                </span>
                              </Button>
                              <Button
                                variant="outline"
                                onClick={(event) => {
                                  trigger.current = event.currentTarget;
                                  setScheduleId(record.entry.medicationId);
                                  setNotice('');
                                }}
                              >
                                Schedule
                                <span className="sr-only">
                                  {' '}
                                  for {record.entry.fields.medication}
                                </span>
                              </Button>
                            </div>
                          </li>
                        ))}
                    </ul>
                  )}
                </section>
              ))}
            </>
          )}
          <nav aria-label="Medication pages" className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={cursors.length === 1}
              onClick={() => setCursors((v) => v.slice(0, -1))}
            >
              Previous page
            </Button>
            <Button
              variant="outline"
              disabled={!data.nextCursor}
              onClick={() => {
                if (data.nextCursor)
                  setCursors((v) => [...v, JSON.stringify(data.nextCursor)]);
              }}
            >
              Next page
            </Button>
          </nav>
          <p className="text-xs text-muted-foreground">
            This page contains up to 20 records. Source changes do not mean
            treatment stopped. This information is not prescribing advice.
          </p>
        </>
      )}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setBefore([null]);
          }
        }}
      >
        <DialogContent
          ref={setElement}
          style={{
            minHeight: height
              ? `min(${height}px, calc(100dvh - 2rem))`
              : undefined,
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (editor) return;
            const node = trigger.current;
            if (node?.isConnected) node.focus();
            else heading.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Medication details and history</DialogTitle>
            <DialogDescription>
              Patient: {patient.displayName}. Previous versions are preserved;
              the current record is shown separately.
            </DialogDescription>
          </DialogHeader>
          {!data ? (
            <p role="status">Checking medication access…</p>
          ) : history.phase === 'failed' ? (
            <div className="space-y-3">
              <p role="alert">Medication history could not be loaded.</p>
              <Button variant="outline" onClick={history.reload}>
                Try history again
              </Button>
            </div>
          ) : !detail ? (
            <p role="status">Loading medication history…</p>
          ) : (
            <div className="min-w-0 space-y-5">
              <section
                aria-label="Current recorded version"
                className="rounded-xl border border-border bg-muted p-4"
              >
                <h2 className="mb-3 font-semibold">Current recorded version</h2>
                <MedicationSummary record={detail.current} details />
                {detail.canWrite &&
                  detail.current.sourceState === 'current-source' && (
                    <Button
                      className="mt-4"
                      onClick={() => {
                        setSelected(null);
                        setEditor({
                          kind: 'edit',
                          id: detail.current.entry.medicationId,
                        });
                      }}
                    >
                      Update recorded medication
                    </Button>
                  )}
                {detail.canWrite &&
                  detail.current.sourceState !== 'current-source' && (
                    <div className="mt-3 space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Review this prescription again before linking its
                        current source. The existing record and history will be
                        retained.
                      </p>
                      <Button
                        onClick={() => {
                          setSelected(null);
                          setEditor({
                            kind: 'edit',
                            id: detail.current.entry.medicationId,
                            reviewSource: true,
                          });
                        }}
                      >
                        Review source and update record
                      </Button>
                    </div>
                  )}
              </section>
              <section aria-label="Preserved versions" className="space-y-3">
                <h2 className="font-semibold">Preserved versions</h2>
                <ol className="min-w-0 space-y-3">
                  {detail.history.map((record) => (
                    <li
                      key={record.entry.revision}
                      className="min-w-0 rounded-xl border border-border p-4"
                    >
                      <details>
                        <summary className="min-h-11 cursor-pointer content-center rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
                          Revision {record.entry.revision} ·{' '}
                          {record.entry.recordedStatus} ·{' '}
                          {record.entry.recordedAt}
                        </summary>
                        <div className="pt-3">
                          <MedicationSummary record={record} details />
                        </div>
                      </details>
                    </li>
                  ))}
                </ol>
              </section>
              <nav
                aria-label="Medication history pages"
                className="flex flex-wrap gap-3"
              >
                <Button
                  variant="outline"
                  disabled={before.length === 1}
                  onClick={() => setBefore((v) => v.slice(0, -1))}
                >
                  Newer versions
                </Button>
                <Button
                  variant="outline"
                  disabled={detail.nextBeforeRevision === null}
                  onClick={() => {
                    if (detail.nextBeforeRevision !== null)
                      setBefore((v) => [...v, detail.nextBeforeRevision]);
                  }}
                >
                  Older versions
                </Button>
              </nav>
              <Button
                variant="outline"
                onClick={() => {
                  setSelected(null);
                  window.location.hash = 'documents';
                }}
              >
                Browse source documents
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {scheduleId && (
        <ScheduleDialog
          key={scheduleId}
          patientId={patient.id}
          patientName={patient.displayName}
          medicationId={scheduleId}
          enabled={enabled && !!data && !denied}
          reminderState={
            reminders.items.find((i) => i.id === scheduleId)?.state
          }
          onEnableReminder={(value) => {
            void reminders.session.enable(value);
          }}
          onStopReminder={() => reminders.session.stop(scheduleId)}
          onClose={(uncertain) => {
            if (uncertain) reminders.session.stop(scheduleId);
            setScheduleId(null);
            if (uncertain)
              setNotice(
                'Schedule save was not confirmed. Check its latest version before trying again.',
              );
          }}
          onSaved={() => {
            reminders.session.stop(scheduleId);
            setScheduleId(null);
            setNotice(
              'Informational schedule saved; prior versions are preserved.',
            );
          }}
          onDenied={() => {
            setScheduleId(null);
            context.reload();
            refresh();
          }}
          onRestoreFocus={() => {
            if (trigger.current?.isConnected) trigger.current.focus();
            else heading.current?.focus();
          }}
        />
      )}
      {inventoryId && (
        <InventoryDialog
          key={inventoryId}
          patientId={patient.id}
          patientName={patient.displayName}
          medicationId={inventoryId}
          medicationName={
            data?.entries.find((r) => r.entry.medicationId === inventoryId)
              ?.entry.fields.medication ?? null
          }
          enabled={enabled && !!data && !denied}
          onClose={(uncertain) => {
            setInventoryId(null);
            if (uncertain)
              setNotice(
                'Inventory save was not confirmed. Check its latest version before trying again.',
              );
          }}
          onSaved={() => {
            setInventoryId(null);
            setNotice(
              'Inventory information saved; prior versions are preserved.',
            );
          }}
          onDenied={() => {
            setInventoryId(null);
            context.reload();
            refresh();
          }}
          onRestoreFocus={() => {
            if (trigger.current?.isConnected) trigger.current.focus();
            else heading.current?.focus();
          }}
        />
      )}
      {editor && (
        <OwnerMedicationDialog
          key={
            editor.kind === 'edit'
              ? `${editor.id}:${editor.reviewSource ? 'source' : 'fields'}`
              : 'create'
          }
          patient={patient}
          target={editor}
          enabled={enabled && !!data?.canWrite && !denied}
          onClose={(uncertain) => {
            setEditor(null);
            if (uncertain) {
              setNotice(
                'The save was not confirmed. Check the refreshed recorded version before trying again.',
              );
            }
            refresh();
          }}
          onSaved={() => {
            setEditor(null);
            setNotice('Medication context saved; prior history is preserved.');
            refresh();
          }}
          onDenied={() => {
            setEditor(null);
            setNotice(
              'Recording permission could not be validated. Current readable records are being rechecked.',
            );
            context.reload();
            refresh();
          }}
          onRestoreFocus={() => {
            if (trigger.current?.isConnected) trigger.current.focus();
            else heading.current?.focus();
          }}
        />
      )}
    </section>
  );
}
