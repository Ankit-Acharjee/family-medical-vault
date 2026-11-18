import { useEffect, useId, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { isEmergencyProfile, isSaveEmergencyProfile } from '@fmv/contracts';
import type { EmergencyProfile, EmergencyProfileFields } from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { useStableDialogHeight } from '../../components/ui/use-stable-dialog-height';
import { useManualResource, useManualWrite } from '../manual-readings/api';
const empty: EmergencyProfileFields = {
  contactName: null,
  contactRelationship: null,
  contactPhone: null,
  note: null,
};
const labels = {
  contactName: 'Emergency contact name',
  contactRelationship: 'Relationship',
  contactPhone: 'Contact phone',
  note: 'Emergency note',
};
const limits = {
  contactName: 80,
  contactRelationship: 60,
  contactPhone: 64,
  note: 1000,
};
export function EmergencyProfileDialog({
  patientId,
  patientName,
  enabled,
  onClose,
  onRestoreFocus,
}: {
  patientId: string;
  patientName: string;
  enabled: boolean;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  const [denied, setDenied] = useState(false),
    [draft, setDraft] = useState<EmergencyProfileFields | null>(null),
    [base, setBase] = useState(0),
    [confirmed, setConfirmed] = useState(false),
    [notice, setNotice] = useState(''),
    [validation, setValidation] = useState(''),
    id = useId();
  const path = `/api/patients/${encodeURIComponent(patientId)}/emergency-profile`;
  const deny = () => {
    setDenied(true);
    setDraft(null);
    setConfirmed(false);
    setNotice('');
  };
  const resource = useManualResource<EmergencyProfile>(
    enabled && !denied ? path : null,
    (v): v is EmergencyProfile =>
      isEmergencyProfile(v) && v.patientId === patientId,
    deny,
  );
  const write = useManualWrite(
    enabled && !denied,
    () => {
      setDraft(null);
      setConfirmed(false);
      setNotice('Private emergency profile saved.');
      resource.reload();
    },
    deny,
  );
  const current = resource.value,
    canWrite = !!current?.canWrite,
    locked = write.phase === 'pending' || write.phase === 'uncertain',
    stable = useStableDialogHeight(enabled && !denied && !!current, false);
  useEffect(() => {
    if (!enabled) setConfirmed(false);
  }, [enabled]);
  function save() {
    if (!draft || !confirmed) return;
    const body = {
      requestId: crypto.randomUUID(),
      expectedRevision: base,
      fields: Object.fromEntries(
        Object.entries(draft).map(([k, v]) => [k, v?.trim() || null]),
      ),
      confirmed: true,
    };
    if (!isSaveEmergencyProfile(body)) {
      setValidation(
        'Check field lengths and remove unsupported control characters.',
      );
      return;
    }
    setValidation('');
    void write.submit({
      url: path,
      method: 'PUT',
      body: JSON.stringify(body),
      revision: base,
    });
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        {...stable}
        className="content-start"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Private emergency profile</DialogTitle>
          <DialogDescription>
            Patient: {patientName}. Owner-reported information; public QR access
            is off.
          </DialogDescription>
        </DialogHeader>
        {denied ? (
          <p role="alert">
            This emergency profile is unavailable for your current access.
          </p>
        ) : !enabled || resource.phase === 'loading' ? (
          <p role="status">Checking private profile access…</p>
        ) : resource.phase === 'failed' ? (
          <div className="space-y-3">
            <p role="alert">The private profile could not be loaded.</p>
            <Button variant="outline" onClick={resource.reload}>
              Try profile again
            </Button>
          </div>
        ) : current ? (
          <div className="space-y-5">
            <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3 text-sm">
              <ShieldCheck
                size={20}
                className="shrink-0 text-primary"
                aria-hidden="true"
              />
              Private to authorized patient-wide viewers. Blank fields mean not
              provided, never “none known.” These notes are not verified
              clinical facts.
            </p>
            {notice && (
              <p role="status" className="text-sm">
                {notice}
              </p>
            )}
            {draft && canWrite ? (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  save();
                }}
              >
                {Object.entries(labels).map(([key, label]) => {
                  const k = key as keyof EmergencyProfileFields;
                  return (
                    <div key={k} className="space-y-1">
                      <label
                        className="block text-sm font-medium"
                        htmlFor={`${id}-${k}`}
                      >
                        {label}{' '}
                        <span className="font-normal text-muted-foreground">
                          (optional)
                        </span>
                      </label>
                      {k === 'note' ? (
                        <textarea
                          id={`${id}-${k}`}
                          rows={4}
                          maxLength={limits[k]}
                          value={draft[k] ?? ''}
                          disabled={locked}
                          onChange={(e) => {
                            setDraft({ ...draft, [k]: e.target.value });
                            setConfirmed(false);
                          }}
                          className="min-h-24 w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-70"
                        />
                      ) : (
                        <Input
                          id={`${id}-${k}`}
                          type={k === 'contactPhone' ? 'tel' : 'text'}
                          maxLength={limits[k]}
                          value={draft[k] ?? ''}
                          disabled={locked}
                          onChange={(e) => {
                            setDraft({ ...draft, [k]: e.target.value });
                            setConfirmed(false);
                          }}
                        />
                      )}
                      <p className="text-xs text-muted-foreground">
                        Up to {limits[k]} characters.
                      </p>
                    </div>
                  );
                })}
                <label className="flex min-h-11 items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-5 shrink-0 accent-primary"
                    checked={confirmed}
                    disabled={write.phase === 'pending'}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I reviewed this owner-reported information. Saving replaces
                  the private display and preserves correction history; it
                  enables no public QR.
                </label>
                {write.phase === 'conflict' && (
                  <div className="space-y-2" role="alert">
                    <p>
                      The profile changed elsewhere. Your draft is retained.
                      Load and review the current profile before trying again.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        resource.reload();
                        setConfirmed(false);
                      }}
                    >
                      Load latest private profile
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setBase(current.profile?.revision ?? 0);
                        write.reset();
                        setConfirmed(false);
                      }}
                    >
                      Use displayed revision {current.profile?.revision ?? 0}{' '}
                      for this draft
                    </Button>
                  </div>
                )}
                {write.phase === 'uncertain' && (
                  <p role="alert" className="text-sm">
                    The save may have completed. Retry the same save to resolve
                    it; no duplicate revision will be created.
                  </p>
                )}
                {validation && <p role="alert">{validation}</p>}
                {write.phase === 'invalid' && (
                  <p role="alert">
                    Check field lengths and remove control characters before
                    retrying.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    disabled={
                      !confirmed ||
                      write.phase === 'pending' ||
                      write.phase === 'conflict'
                    }
                  >
                    {write.phase === 'pending'
                      ? 'Saving private profile…'
                      : write.phase === 'uncertain'
                        ? 'Retry same save'
                        : 'Save private profile'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={locked}
                    onClick={() => {
                      setDraft(null);
                      setConfirmed(false);
                      write.reset();
                    }}
                  >
                    Cancel editing
                  </Button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                {!current.profile ? (
                  <p>No private emergency information has been provided.</p>
                ) : (
                  <>
                    <dl className="space-y-3">
                      {Object.entries(labels).map(([key, label]) => (
                        <div key={key}>
                          <dt className="text-sm text-muted-foreground">
                            {label}
                          </dt>
                          <dd className="whitespace-pre-wrap break-words text-sm">
                            {current.profile!.fields[
                              key as keyof EmergencyProfileFields
                            ] ?? 'Not provided'}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p className="text-xs text-muted-foreground">
                      Owner-reported · revision {current.profile.revision} ·
                      saved{' '}
                      {new Date(current.profile.recordedAt).toLocaleString()}
                    </p>
                  </>
                )}
                {canWrite ? (
                  <Button
                    onClick={() => {
                      setDraft(current.profile?.fields ?? { ...empty });
                      setBase(current.profile?.revision ?? 0);
                      setNotice('');
                      write.reset();
                    }}
                  >
                    Edit private emergency profile
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Only the profile owner can edit this information.
                  </p>
                )}
              </div>
            )}
            {draft && current.profile && (
              <details className="rounded-xl border border-border p-3 text-sm">
                <summary className="min-h-11 cursor-pointer content-center">
                  Current saved revision {current.profile.revision}
                </summary>
                <dl className="space-y-2">
                  {Object.entries(labels).map(([key, label]) => (
                    <div key={key}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="whitespace-pre-wrap break-words">
                        {current.profile!.fields[
                          key as keyof EmergencyProfileFields
                        ] ?? 'Not provided'}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </div>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Close emergency profile
        </Button>
      </DialogContent>
    </Dialog>
  );
}
