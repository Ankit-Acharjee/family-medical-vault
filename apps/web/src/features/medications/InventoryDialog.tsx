import { useEffect, useRef, useState } from 'react';
import {
  isMedicationInventoryFields,
  isMedicationInventoryHistory,
} from '@fmv/contracts';
import type {
  MedicationInventoryEntry,
  MedicationInventoryFields,
} from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { useManualResource, useManualWrite } from '../manual-readings/api';
const labels = {
  quantity: 'Quantity as reported',
  expiry: 'Expiry as reported',
  refill: 'Refill information',
};
const blank = () => ({ quantity: '', expiry: '', refill: '' });
function InventoryVersion({ entry }: { entry: MedicationInventoryEntry }) {
  return (
    <section className="min-w-0 space-y-2 rounded-xl border border-border p-3 text-sm [overflow-wrap:anywhere]">
      <p className="font-medium">
        Inventory revision {entry.revision} · Medication revision{' '}
        {entry.medicationRevision}
      </p>
      <p className="text-muted-foreground">
        Recorded {new Date(entry.recordedAt).toLocaleString()}
      </p>
      <dl className="space-y-2">
        {(Object.keys(labels) as (keyof MedicationInventoryFields)[]).map(
          (k) => (
            <div key={k}>
              <dt className="text-muted-foreground">{labels[k]}</dt>
              <dd className="whitespace-pre-wrap">
                {entry.fields[k] ?? 'Unknown'}
              </dd>
            </div>
          ),
        )}
      </dl>
    </section>
  );
}
export function InventoryDialog({
  patientId,
  patientName,
  medicationId,
  medicationName,
  enabled,
  onClose,
  onSaved,
  onDenied,
  onRestoreFocus,
}: {
  patientId: string;
  patientName: string;
  medicationId: string;
  medicationName: string | null;
  enabled: boolean;
  onClose: (uncertain?: boolean) => void;
  onSaved: () => void;
  onDenied: () => void;
  onRestoreFocus: () => void;
}) {
  const base = `/api/patients/${encodeURIComponent(patientId)}/medication-reconciliations/${encodeURIComponent(medicationId)}/inventory`;
  const [pages, setPages] = useState<(number | null)[]>([null]),
    [draft, setDraft] = useState(blank),
    [baseline, setBaseline] = useState<string | null>(null),
    [ack, setAck] = useState<string | null>(null),
    [validation, setValidation] = useState('');
  const [element, setElement] = useState<HTMLDivElement | null>(null),
    [height, setHeight] = useState(0);
  const requestId = useRef<string | null>(null),
    before = pages.at(-1);
  const resource = useManualResource(
    enabled ? base + (before ? `?beforeRevision=${before}` : '') : null,
    (v): v is import('@fmv/contracts').MedicationInventoryHistory =>
      isMedicationInventoryHistory(v) &&
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
    if (!data || !data.canWrite || baseline !== null) return;
    const fields = data.current?.fields;
    setDraft({
      quantity: fields?.quantity ?? '',
      expiry: fields?.expiry ?? '',
      refill: fields?.refill ?? '',
    });
    setBaseline(stamp);
  }, [data, baseline, stamp]);
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
  const stale = !!baseline && stamp !== null && stamp !== baseline,
    ready = !!data?.canWrite && data.sourceState === 'current-source' && !stale;
  const write = useManualWrite(ready, onSaved, onDenied),
    locked = ['pending', 'uncertain', 'conflict'].includes(write.phase),
    ackKey = JSON.stringify([baseline, draft]);
  const close = () => {
    if (write.phase !== 'pending') onClose(write.phase === 'uncertain');
  };
  const reset = () => {
    write.reset();
    requestId.current = null;
    setBaseline(null);
    setAck(null);
    setValidation('');
    setPages([null]);
    resource.reload();
  };
  const submit = () => {
    if (!data || !ready || ack !== ackKey || write.phase === 'pending') return;
    const fields = Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [k, v === '' ? null : v]),
    );
    if (!isMedicationInventoryFields(fields)) {
      setValidation(
        'Enter up to 120 characters per field without control characters, or leave the field empty.',
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
        meaning: 'owner-reported-inventory',
        fields,
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
          <DialogTitle>Medication inventory</DialogTitle>
          <DialogDescription>
            Patient: {patientName}. Optional owner-reported quantity, expiry and
            refill information.
          </DialogDescription>
        </DialogHeader>
        {!enabled ? (
          <p role="status">Checking inventory access…</p>
        ) : resource.phase === 'failed' ? (
          <div className="space-y-3">
            <p role="alert">Inventory could not be loaded.</p>
            <Button variant="outline" onClick={resource.reload}>
              Try again
            </Button>
          </div>
        ) : !data ? (
          <p role="status">Loading inventory…</p>
        ) : (
          <div className="min-w-0 space-y-4">
            {medicationName && (
              <p className="font-medium [overflow-wrap:anywhere]">
                Medication: {medicationName}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              No stock usage, expiry date or refill schedule is inferred. Leave
              unknown information empty.
            </p>
            {data.sourceState !== 'current-source' && (
              <p role="status" className="text-sm text-muted-foreground">
                The prescription source needs review. Inventory history remains
                recorded; it does not mean treatment stopped. Review the source
                and medication record before saving changes.
              </p>
            )}
            {data.current &&
              data.current.medicationRevision !== data.medicationRevision && (
                <p role="status" className="text-sm text-muted-foreground">
                  This inventory was reported for medication revision{' '}
                  {data.current.medicationRevision}. Review it before confirming
                  information for revision {data.medicationRevision}.
                </p>
              )}
            {data.current ? (
              <div className="space-y-2">
                <h2 className="font-semibold">Latest reported inventory</h2>
                <InventoryVersion entry={data.current} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No inventory information recorded. It is optional.
              </p>
            )}
            {data.canWrite && (stale || write.phase === 'conflict') ? (
              <div className="space-y-3">
                <p role="alert">
                  The medication, source or inventory version changed. Your
                  draft was not saved.
                </p>
                <Button
                  variant="outline"
                  disabled={write.phase === 'pending'}
                  onClick={reset}
                >
                  Discard draft and load latest
                </Button>
              </div>
            ) : ready && baseline !== null ? (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <h2 className="font-semibold">
                  {data.current
                    ? 'Update reported inventory'
                    : 'Record optional inventory'}
                </h2>
                {(
                  Object.keys(labels) as (keyof MedicationInventoryFields)[]
                ).map((k) => (
                  <label
                    key={k}
                    className="flex min-w-0 flex-col gap-2 text-sm font-medium"
                  >
                    {labels[k]}
                    <span className="sr-only"> (optional)</span>
                    <Input
                      value={draft[k]}
                      disabled={locked}
                      maxLength={120}
                      autoComplete="off"
                      placeholder="Unknown"
                      onChange={(e) => {
                        setDraft({ ...draft, [k]: e.target.value });
                        setAck(null);
                        setValidation('');
                        if (write.phase === 'invalid') {
                          write.reset();
                          requestId.current = null;
                        }
                      }}
                    />
                  </label>
                ))}
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-primary"
                    checked={ack === ackKey}
                    disabled={locked}
                    onChange={(e) => setAck(e.target.checked ? ackKey : null)}
                  />
                  <span>
                    I confirm this optional inventory information as reported.
                    Prior versions will be preserved.
                  </span>
                </label>
                {validation && (
                  <p role="alert" className="text-sm text-destructive">
                    {validation}
                  </p>
                )}
                {write.phase === 'invalid' && (
                  <p role="alert" className="text-sm text-destructive">
                    The information was not accepted. Check the fields and
                    confirm again.
                  </p>
                )}
                {write.phase === 'uncertain' && (
                  <div className="space-y-3">
                    <p role="alert">
                      The save was not confirmed. Retry the exact request or
                      check the latest version.
                    </p>
                    <Button variant="outline" onClick={resource.reload}>
                      Check latest inventory version
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
                      ? 'Saving inventory…'
                      : write.phase === 'uncertain'
                        ? 'Retry exact save'
                        : 'Save inventory'}
                  </Button>
                </div>
              </form>
            ) : null}
            {(data.history.some((e) => e.revision !== data.current?.revision) ||
              pages.length > 1 ||
              data.nextBeforeRevision !== null) && (
              <section className="space-y-3" aria-label="Inventory history">
                <h2 className="font-semibold">Preserved inventory versions</h2>
                {data.history
                  .filter((e) => e.revision !== data.current?.revision)
                  .map((e) => (
                    <InventoryVersion key={e.revision} entry={e} />
                  ))}
                <nav
                  aria-label="Inventory history pages"
                  className="flex flex-wrap gap-3"
                >
                  <Button
                    variant="outline"
                    disabled={pages.length === 1 || write.phase === 'pending'}
                    onClick={() => setPages((p) => p.slice(0, -1))}
                  >
                    Newer inventory versions
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
                    Older inventory versions
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
