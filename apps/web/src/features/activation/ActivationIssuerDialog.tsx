import { useEffect, useId, useRef, useState } from 'react';
import { Copy, KeyRound } from 'lucide-react';
import {
  isProfileActivationList,
  isIssuedProfileActivation,
  isIssueProfileActivation,
  isApproveProfileActivation,
} from '@fmv/contracts';
import type {
  IssuedProfileActivation,
  ProfileActivationList,
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
import { useStableDialogHeight } from '../../components/ui/use-stable-dialog-height';
import { ManualApiError, useManualResource } from '../manual-readings/api';
import { sharingJson } from '../sharing/api';
import { activationUrl } from './incoming-activation';
type Operation = {
  kind: 'issue' | 'approve' | 'revoke';
  path: string;
  body: unknown;
};
export function ActivationIssuerDialog({
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
    [hours, setHours] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [issued, setIssued] = useState<IssuedProfileActivation | null>(null),
    [approvalId, setApprovalId] = useState<string | null>(null),
    [typed, setTyped] = useState(''),
    [approvalConfirmed, setApprovalConfirmed] = useState(false),
    [revokeId, setRevokeId] = useState<string | null>(null),
    [notice, setNotice] = useState(''),
    [phase, setPhase] = useState<'idle' | 'pending' | 'uncertain'>('idle'),
    id = useId();
  const request = useRef<AbortController | null>(null),
    operation = useRef<Operation | null>(null),
    busy = useRef(false),
    allowed = useRef(enabled);
  allowed.current = enabled;
  const path = `/api/patients/${encodeURIComponent(patientId)}/activations`;
  const deny = () => {
    request.current?.abort();
    operation.current = null;
    setDenied(true);
    setIssued(null);
    setTyped('');
    setHours('');
    setConfirmed(false);
    setApprovalConfirmed(false);
    setNotice('');
  };
  const resource = useManualResource<ProfileActivationList>(
    enabled && !denied ? path : null,
    (v): v is ProfileActivationList =>
      isProfileActivationList(v) && v.patientId === patientId,
    deny,
  );
  const rows = resource.value?.activations ?? [],
    target = rows.find((r) => r.id === approvalId),
    liveIssued = rows.find((r) => r.id === issued?.activation.id),
    secret =
      enabled &&
      !denied &&
      liveIssued?.state === 'pending' &&
      Date.parse(liveIssued.expiresAt) > Date.now() &&
      issued?.token
        ? activationUrl(window.location.href, issued.token)
        : null,
    locked = phase !== 'idle',
    stable = useStableDialogHeight(
      enabled && !denied && !!resource.value,
      false,
    );
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!enabled) {
      request.current?.abort();
      setConfirmed(false);
      setApprovalConfirmed(false);
      if (operation.current) setPhase('uncertain');
      busy.current = false;
    }
  }, [enabled]);
  async function run(next: Operation) {
    if (!allowed.current || denied || busy.current) return;
    operation.current ??= next;
    const op = operation.current,
      abort = new AbortController();
    request.current = abort;
    busy.current = true;
    setPhase('pending');
    setNotice('');
    const timer = window.setTimeout(() => abort.abort(), 15000);
    try {
      const value = await sharingJson(op.path, op.body, abort.signal);
      abort.signal.throwIfAborted();
      if (!allowed.current || request.current !== abort) return;
      if (op.kind === 'issue') {
        if (
          !isIssuedProfileActivation(value) ||
          value.activation.patientId !== patientId
        )
          throw Error();
        setIssued(value);
        setNotice(
          value.token
            ? 'Activation link issued. Copy it now; it cannot be recovered.'
            : 'The same activation already exists. Its secret cannot be recovered; revoke it before issuing a new link.',
        );
      } else if (op.kind === 'approve') {
        if (
          !value ||
          typeof value !== 'object' ||
          Object.keys(value).length !== 2 ||
          !('activated' in value) ||
          value.activated !== true ||
          !('patientId' in value) ||
          value.patientId !== patientId
        )
          throw Error();
        setNotice(
          'Activation approved. The existing Person and records are preserved; you remain a caregiver under your current grants.',
        );
        setApprovalId(null);
        setTyped('');
      } else {
        if (
          !value ||
          typeof value !== 'object' ||
          Object.keys(value).length !== 1 ||
          !('revoked' in value) ||
          value.revoked !== true
        )
          throw Error();
        setNotice(
          'Activation link revoked. It can no longer be claimed or approved.',
        );
        setRevokeId(null);
        setIssued(null);
      }
      operation.current = null;
      setPhase('idle');
      setConfirmed(false);
      setApprovalConfirmed(false);
      resource.reload();
    } catch (e) {
      if (request.current !== abort) return;
      if (e instanceof ManualApiError && [401, 403, 404].includes(e.status)) {
        deny();
      } else if (e instanceof ManualApiError && [400, 409].includes(e.status)) {
        operation.current = null;
        setPhase('idle');
        setConfirmed(false);
        setApprovalConfirmed(false);
        setNotice(
          'The activation or identity changed, or the request is invalid. Review the current state before trying again.',
        );
        resource.reload();
      } else {
        setPhase('uncertain');
        setNotice(
          'This operation may have completed. Retry the same operation to resolve it safely.',
        );
      }
    } finally {
      window.clearTimeout(timer);
      if (request.current === abort) {
        request.current = null;
        busy.current = false;
      }
    }
  }
  function issue() {
    const body = {
      requestId: crypto.randomUUID(),
      expiresInHours: Number(hours),
      confirmed: true,
    };
    if (!confirmed || !isIssueProfileActivation(body)) return;
    void run({ kind: 'issue', path, body });
  }
  function approve() {
    if (
      !target ||
      target.state !== 'claimed' ||
      !approvalConfirmed ||
      typed.trim().toLowerCase() !== target.claimantRef
    )
      return;
    const body = {
      requestId: crypto.randomUUID(),
      claimantRef: target.claimantRef,
      confirmed: true,
    };
    if (!isApproveProfileActivation(body)) return;
    void run({ kind: 'approve', path: `${path}/${target.id}/approve`, body });
  }
  async function copy() {
    if (!secret) return;
    if (!liveIssued || Date.parse(liveIssued.expiresAt) <= Date.now()) {
      setNotice('This activation link expired. Review the current status.');
      resource.reload();
      return;
    }
    try {
      await navigator.clipboard.writeText(secret);
      setNotice(
        'Activation link copied. Send it only to the intended claimant.',
      );
    } catch {
      setNotice(
        'Clipboard unavailable. Select and copy the displayed link manually.',
      );
    }
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
        className="content-start sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Managed-profile activation</DialogTitle>
          <DialogDescription>
            Patient: {patientName}. Only the original creator with current View
            and Manage may issue or approve activation.
          </DialogDescription>
        </DialogHeader>
        {denied ? (
          <p role="alert">
            Activation management is unavailable. Other delegates cannot
            transfer ownership, even with Manage access.
          </p>
        ) : !enabled || resource.phase === 'loading' ? (
          <p role="status">Checking activation authority…</p>
        ) : resource.phase === 'failed' ? (
          <div className="space-y-3">
            <p role="alert">Activation history could not be loaded.</p>
            <Button variant="outline" onClick={resource.reload}>
              Retry activation history
            </Button>
          </div>
        ) : resource.value ? (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              A secret link permits a verified claim only. You must separately
              approve the intended claimant reference through another trusted
              channel. Existing personal identities are deferred without merging
              records.
            </p>
            {notice && (
              <p
                role={phase === 'uncertain' ? 'alert' : 'status'}
                className="text-sm"
              >
                {notice}
              </p>
            )}
            {phase === 'uncertain' && operation.current ? (
              <Button onClick={() => void run(operation.current!)}>
                Retry same activation operation
              </Button>
            ) : null}
            {issued && (
              <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
                <h3 className="font-medium">Activation link result</h3>
                {secret ? (
                  <>
                    <label
                      className="block text-sm font-medium"
                      htmlFor={`${id}-secret`}
                    >
                      Secret activation link — copy now
                    </label>
                    <Input
                      id={`${id}-secret`}
                      readOnly
                      value={secret}
                      onFocus={(e) => e.target.select()}
                    />
                    <Button
                      variant="outline"
                      disabled={locked}
                      onClick={() => void copy()}
                    >
                      <Copy aria-hidden="true" size={16} />
                      Copy activation link
                    </Button>
                  </>
                ) : (
                  <p className="text-sm">
                    The secret is unavailable or no longer pending. A replay
                    never recovers it; revoke and issue another link if needed.
                  </p>
                )}
              </div>
            )}
            {!rows.some(
              (r) =>
                r.state === 'pending' ||
                r.state === 'claimed' ||
                r.state === 'accepted',
            ) && (
              <form
                className="space-y-3 rounded-xl border border-border p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  issue();
                }}
              >
                <h3 className="font-medium">Issue an activation link</h3>
                <label htmlFor={`${id}-hours`} className="block text-sm">
                  Expiry in hours (1–168)
                </label>
                <Input
                  id={`${id}-hours`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={168}
                  step={1}
                  required
                  disabled={locked}
                  value={hours}
                  onChange={(e) => {
                    setHours(e.target.value);
                    setConfirmed(false);
                  }}
                />
                <label className="flex min-h-11 items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-5 shrink-0 accent-primary"
                    checked={confirmed}
                    disabled={locked}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I will send this link only to the intended person and verify
                  their claimant reference separately before approving
                  ownership.
                </label>
                <Button
                  type="submit"
                  disabled={
                    locked ||
                    !confirmed ||
                    !Number.isInteger(Number(hours)) ||
                    Number(hours) < 1 ||
                    Number(hours) > 168
                  }
                >
                  <KeyRound aria-hidden="true" size={16} />
                  Issue activation link
                </Button>
              </form>
            )}
            <div className="space-y-3">
              <h3 className="font-medium">
                Outstanding and recent activations
              </h3>
              {!rows.length && (
                <p className="text-sm text-muted-foreground">
                  No activation links have been issued.
                </p>
              )}
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="space-y-3 rounded-xl border border-border p-4 text-sm"
                >
                  <p className="font-medium">State: {row.state}</p>
                  <p className="text-muted-foreground">
                    Expires {new Date(row.expiresAt).toLocaleString()}
                  </p>
                  {row.claimantRef && (
                    <p className="break-words">
                      Claimant reference:{' '}
                      <span className="font-mono">{row.claimantRef}</span>
                    </p>
                  )}
                  {row.state === 'accepted' ? (
                    <p>
                      Ownership is activated. Revoking a link cannot undo this
                      approved identity linkage.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {row.state === 'claimed' && (
                        <Button
                          disabled={locked}
                          onClick={() => {
                            setApprovalId(row.id);
                            setTyped('');
                            setApprovalConfirmed(false);
                          }}
                        >
                          Review claimant approval
                        </Button>
                      )}
                      {row.state !== 'revoked' && (
                        <Button
                          variant="outline"
                          disabled={locked}
                          onClick={() => setRevokeId(row.id)}
                        >
                          Revoke activation link
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {resource.value.limited && (
                <p className="text-xs text-muted-foreground">
                  Showing the latest 20; older activation history is omitted.
                </p>
              )}
            </div>
            {target?.state === 'claimed' && (
              <form
                className="space-y-3 rounded-xl border border-border bg-muted/30 p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  approve();
                }}
              >
                <h3 className="font-semibold">Approve the intended claimant</h3>
                <p className="text-sm">
                  This links the verified claimant to the existing Person. No
                  documents move. Existing caregiver grants remain; this dialog
                  cannot undo ownership.
                </p>
                <label htmlFor={`${id}-reference`} className="block text-sm">
                  Type the claimant reference you verified separately
                </label>
                <Input
                  id={`${id}-reference`}
                  autoComplete="off"
                  value={typed}
                  disabled={locked}
                  onChange={(e) => {
                    setTyped(e.target.value);
                    setApprovalConfirmed(false);
                  }}
                />
                <label className="flex min-h-11 items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-5 shrink-0 accent-primary"
                    checked={approvalConfirmed}
                    disabled={locked}
                    onChange={(e) => setApprovalConfirmed(e.target.checked)}
                  />
                  I independently verified that this exact claimant is the
                  intended person and approve ownership of this profile.
                </label>
                <Button
                  type="submit"
                  disabled={
                    locked ||
                    !approvalConfirmed ||
                    typed.trim().toLowerCase() !== target.claimantRef
                  }
                >
                  Approve profile activation
                </Button>
              </form>
            )}
            {revokeId && (
              <div className="space-y-3 rounded-xl border border-border p-4">
                <h3 className="font-medium">Revoke this activation link?</h3>
                <p className="text-sm">
                  Pending claims can no longer be approved. This does not delete
                  the Person or records.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={locked}
                    onClick={() =>
                      void run({
                        kind: 'revoke',
                        path: `${path}/${revokeId}/revoke`,
                        body: {},
                      })
                    }
                  >
                    Confirm activation revocation
                  </Button>
                  <Button
                    variant="outline"
                    disabled={locked}
                    onClick={() => setRevokeId(null)}
                  >
                    Keep activation link
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Close activation management
        </Button>
      </DialogContent>
    </Dialog>
  );
}
