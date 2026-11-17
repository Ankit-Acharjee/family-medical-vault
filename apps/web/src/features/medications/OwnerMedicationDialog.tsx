import { useEffect, useRef, useState } from 'react';
import {
  isMedicationSourceOptions,
  isMedicationReconciliationHistory,
} from '@fmv/contracts';
import type { MedicationSourceBinding, PatientSummary } from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { useManualResource, useManualWrite } from '../manual-readings/api';
import { MedicationForm, medicationSelectClass } from './MedicationForm';
import {
  emptyMedicationDraft,
  sourceMedicationDraft,
  recordedMedicationDraft,
  medicationDraftFields,
} from './draft';
export type MedicationEditorTarget =
  { kind: 'create' } | { kind: 'edit'; id: string; reviewSource?: boolean };
const sourceKey = (b: MedicationSourceBinding) =>
  JSON.stringify([
    b.documentId,
    b.candidateId,
    b.sourceRevision,
    b.sourceSha256,
    b.lifecycleVersion,
    b.reviewRevision,
  ]);
export function OwnerMedicationDialog({
  patient,
  enabled,
  target,
  onClose,
  onSaved,
  onDenied,
  onRestoreFocus,
}: {
  patient: PatientSummary;
  enabled: boolean;
  target: MedicationEditorTarget;
  onClose: (uncertain?: boolean) => void;
  onSaved: () => void;
  onDenied: () => void;
  onRestoreFocus: () => void;
}) {
  const base = `/api/patients/${encodeURIComponent(patient.id)}/medication-reconciliations`;
  const [selected, setSelected] = useState(''),
    [draft, setDraft] = useState(emptyMedicationDraft),
    [baseline, setBaseline] = useState<string | null>(null),
    [ack, setAck] = useState<string | null>(null),
    [validation, setValidation] = useState('');
  const [element, setElement] = useState<HTMLDivElement | null>(null),
    [height, setHeight] = useState(0);
  const [newId] = useState(() => crypto.randomUUID());
  const requestId = useRef<string | null>(null);
  const chooseSource = target.kind === 'create' || target.reviewSource === true;
  const choices = useManualResource(
    enabled && chooseSource ? `${base}/source-options` : null,
    (v): v is import('@fmv/contracts').MedicationSourceOptions =>
      isMedicationSourceOptions(v) && v.patientId === patient.id,
    onDenied,
  );
  const option = choices.value?.options.find(
    (o) => sourceKey(o.binding) === selected,
  );
  const medicationId =
    target.kind === 'edit'
      ? target.id
      : (option?.existingRecord?.medicationId ?? newId);
  const needsHistory = target.kind === 'edit' || !!option?.existingRecord;
  const history = useManualResource(
    enabled && needsHistory ? `${base}/${medicationId}` : null,
    (v): v is import('@fmv/contracts').MedicationReconciliationHistory =>
      isMedicationReconciliationHistory(v) &&
      v.current.entry.patientId === patient.id &&
      v.current.entry.medicationId === medicationId,
    onDenied,
  );
  const current = enabled && needsHistory ? history.value?.current : null;
  const visibleOptions =
    choices.value?.options.filter(
      (o) =>
        target.kind === 'create' ||
        o.binding.documentId === current?.entry.source.documentId,
    ) ?? [];
  const binding = chooseSource ? option?.binding : current?.entry.source;
  const canWrite =
    enabled &&
    (target.kind === 'edit'
      ? !!history.value?.canWrite
      : !!choices.value?.canWrite &&
        (!needsHistory || !!history.value?.canWrite));
  const sourceReady = chooseSource
    ? !!option &&
      (target.kind === 'create' ||
        (option.binding.documentId === current?.entry.source.documentId &&
          (!option.existingRecord ||
            option.existingRecord.medicationId === target.id)))
    : current?.sourceState === 'current-source';
  const pointerChanged = !!(
    option?.existingRecord &&
    current &&
    option.existingRecord.revision !== current.entry.revision
  );
  const ready = !!(
    canWrite &&
    sourceReady &&
    binding &&
    (!needsHistory || current) &&
    !pointerChanged
  );
  const expectedRevision = current?.entry.revision ?? 0;
  const stamp = JSON.stringify([
    medicationId,
    expectedRevision,
    binding && sourceKey(binding),
  ]);
  useEffect(() => {
    if (!ready || baseline !== null) return;
    setDraft(
      current
        ? recordedMedicationDraft(current.entry)
        : sourceMedicationDraft(option!.source),
    );
    setBaseline(stamp);
    setAck(null);
  }, [ready, baseline, stamp, current, option]);
  useEffect(() => {
    if (!ready || !element) return;
    const observer = new ResizeObserver(() =>
      setHeight((previous) =>
        Math.max(previous, Math.ceil(element.getBoundingClientRect().height)),
      ),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready, element]);
  const stale = baseline !== null && baseline !== stamp;
  const write = useManualWrite(ready && !stale, onSaved, onDenied);
  const locked = ['pending', 'uncertain', 'conflict'].includes(write.phase);
  const ackKey = JSON.stringify([stamp, draft]),
    acknowledged = ack === ackKey;
  const close = () => {
    if (write.phase === 'pending') return;
    onClose(write.phase === 'uncertain');
  };
  const refreshContext = () => {
    if (chooseSource) choices.reload();
    if (needsHistory) history.reload();
  };
  const reload = () => {
    write.reset();
    requestId.current = null;
    setBaseline(null);
    setDraft(emptyMedicationDraft());
    setAck(null);
    setValidation('');
    if (chooseSource) choices.reload();
    if (needsHistory) history.reload();
  };
  const submit = () => {
    if (
      !ready ||
      !binding ||
      stale ||
      !acknowledged ||
      baseline === null ||
      write.phase === 'pending'
    )
      return;
    const fields = medicationDraftFields(draft);
    if (!fields || !draft.status) {
      setValidation(
        'Choose a recorded status and enter a medication name. Optional fields may be empty; entered text must fit 120 characters without control characters.',
      );
      return;
    }
    requestId.current ??= crypto.randomUUID();
    void write.submit({
      url: `${base}/${medicationId}`,
      method: 'PUT',
      revision: expectedRevision,
      body: JSON.stringify({
        requestId: requestId.current,
        expectedRevision,
        confirmed: true,
        meaning: 'owner-recorded-medication-context',
        source: binding,
        recordedStatus: draft.status,
        fields,
      }),
    });
  };
  const failed =
    (chooseSource && choices.phase === 'failed') ||
    (needsHistory && history.phase === 'failed');
  const waiting =
    !enabled || (chooseSource && !choices.value) || (needsHistory && !current);
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
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
        onEscapeKeyDown={(event) => {
          if (write.phase === 'pending') event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (write.phase === 'pending') event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {target.kind === 'edit'
              ? 'Update recorded medication'
              : 'Record medication'}
          </DialogTitle>
          <DialogDescription>
            Patient: {patient.displayName}. Review the source and confirm your
            recorded context.
          </DialogDescription>
        </DialogHeader>
        {!enabled ? (
          <p role="status">Checking recording permission…</p>
        ) : failed ? (
          <div className="space-y-3">
            <p role="alert">
              Prescription choices or the current record could not be loaded.
            </p>
            <Button variant="outline" onClick={refreshContext}>
              Try loading again
            </Button>
          </div>
        ) : (
          <>
            {chooseSource && choices.value && (!needsHistory || current) && (
              <div className="min-w-0 space-y-3">
                <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
                  Reviewed prescription source
                  <select
                    className={medicationSelectClass}
                    value={selected}
                    disabled={locked}
                    onChange={(event) => {
                      setSelected(event.target.value);
                      setBaseline(null);
                      setDraft(emptyMedicationDraft());
                      setAck(null);
                      setValidation('');
                      write.reset();
                      requestId.current = null;
                    }}
                  >
                    <option value="">Choose a reviewed source block</option>
                    {visibleOptions.map((o) => (
                      <option
                        key={sourceKey(o.binding)}
                        value={sourceKey(o.binding)}
                        disabled={
                          target.kind === 'edit' &&
                          !!o.existingRecord &&
                          o.existingRecord.medicationId !== target.id
                        }
                      >
                        {o.title} · Page {o.source.page} ·{' '}
                        {o.source.fields.medication.value}
                        {o.existingRecord ? ' · Update existing record' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {visibleOptions.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No current owner-reviewed prescription blocks are available.
                    Review the prescription source in Documents first; an upload
                    alone does not create a medication record.
                  </p>
                )}
                {choices.value.limited && (
                  <p className="text-sm text-muted-foreground">
                    Showing up to 50 source blocks from 25 recently reviewed
                    documents. Other prescriptions remain available in
                    Documents.
                  </p>
                )}
                {!visibleOptions.length && (
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
                {selected && !option && (
                  <p role="alert">
                    The selected source changed or is no longer eligible. Choose
                    a current source after reviewing it again.
                  </p>
                )}
              </div>
            )}
            {waiting ? (
              <p role="status">Loading reviewed context…</p>
            ) : pointerChanged || stale ? (
              <div className="space-y-3">
                <p role="alert">
                  The source or recorded version changed. Your draft has not
                  been saved.
                </p>
                <Button
                  variant="outline"
                  disabled={write.phase === 'pending'}
                  onClick={reload}
                >
                  Discard draft and load latest
                </Button>
              </div>
            ) : needsHistory && history.value && !history.value.canWrite ? (
              <div className="space-y-3">
                <p role="alert">
                  Recording permission is no longer available. No changes have
                  been saved.
                </p>
                <Button variant="outline" onClick={onDenied}>
                  Recheck permission
                </Button>
              </div>
            ) : target.kind === 'edit' &&
              !chooseSource &&
              current?.sourceState !== 'current-source' ? (
              <div className="space-y-3">
                <p role="alert">
                  Review the prescription source again before updating this
                  record. Its recorded status has not changed.
                </p>
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
              </div>
            ) : ready && baseline !== null ? (
              <form
                className="min-w-0 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                {option && (
                  <div className="min-w-0 rounded-xl border border-border bg-muted p-3 text-sm [overflow-wrap:anywhere]">
                    <p className="font-medium">
                      {option.title} · Page {option.source.page}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {option.existingRecord || target.kind === 'edit'
                        ? `Existing record · revision ${expectedRevision}. History is preserved.`
                        : 'New record · explicit confirmation required.'}
                    </p>
                    <details className="mt-2">
                      <summary className="min-h-11 cursor-pointer content-center rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
                        Reviewed source fields
                      </summary>
                      <blockquote className="space-y-2 whitespace-pre-wrap">
                        {Object.entries(option.source.fields).map(
                          ([key, value]) =>
                            value ? <p key={key}>{value.excerpt}</p> : null,
                        )}
                      </blockquote>
                    </details>
                  </div>
                )}
                {target.kind === 'edit' && current && (
                  <p className="text-sm text-muted-foreground">
                    Updating revision {expectedRevision}. Source:{' '}
                    {current.entry.source.documentId}. Prior versions are
                    preserved.
                  </p>
                )}
                <MedicationForm
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
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-primary"
                    checked={acknowledged}
                    disabled={locked}
                    onChange={(event) =>
                      setAck(event.target.checked ? ackKey : null)
                    }
                  />
                  <span>
                    I reviewed these details and explicitly confirm their
                    recorded current or historical status. This does not
                    prescribe treatment.
                  </span>
                </label>
                {validation && (
                  <p role="alert" className="text-sm text-destructive">
                    {validation}
                  </p>
                )}
                {write.phase === 'invalid' && (
                  <p role="alert" className="text-sm text-destructive">
                    The record was not accepted. Check the fields and confirm
                    them again.
                  </p>
                )}
                {write.phase === 'conflict' && (
                  <div className="space-y-3">
                    <p role="alert">
                      The record or source changed, or this source already has a
                      record. Reload the latest context instead of creating a
                      duplicate.
                    </p>
                    <Button variant="outline" onClick={reload}>
                      Discard draft and load latest
                    </Button>
                  </div>
                )}
                {write.phase === 'uncertain' && (
                  <div className="space-y-3">
                    <p role="alert">
                      The save was not confirmed. Retry the exact request, or
                      reload to check the recorded version.
                    </p>
                    <Button variant="outline" onClick={refreshContext}>
                      Check latest recorded version
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
                    disabled={
                      !acknowledged ||
                      write.phase === 'pending' ||
                      write.phase === 'conflict'
                    }
                  >
                    {write.phase === 'pending'
                      ? 'Saving medication…'
                      : write.phase === 'uncertain'
                        ? 'Retry exact save'
                        : needsHistory
                          ? 'Save medication update'
                          : 'Confirm medication record'}
                  </Button>
                </div>
              </form>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
