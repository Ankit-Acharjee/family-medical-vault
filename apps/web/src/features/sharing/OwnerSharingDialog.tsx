import { OwnerLinkActivity } from './OwnerLinkActivity';
import { useStableDialogHeight } from '../../components/ui/use-stable-dialog-height';
import { useEffect, useId, useRef, useState } from 'react';
import { Copy, Link as LinkIcon } from 'lucide-react';
import {
  isOriginalExportPreview,
  isTemporaryLinkCreated,
  isTemporaryLinksList,
  maximumOriginalExportContentBytes,
} from '@fmv/contracts';
import type {
  CreateTemporaryLink,
  DocumentSummary,
  OriginalExportPreview,
  TemporaryLinkCreated,
  TemporaryLinksList,
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
import {
  OriginalSelection,
  formatFileSize,
} from '../documents/OriginalSelection';
import { ManualApiError, useManualResource } from '../manual-readings/api';
import { sharingJson } from './api';
import { temporaryShareUrl } from './incoming-share';
export function OwnerSharingDialog({
  patientId,
  patientName,
  documents,
  enabled,
  onClose,
  onRestoreFocus,
}: {
  patientId: string;
  patientName: string;
  documents: DocumentSummary[];
  enabled: boolean;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [hours, setHours] = useState(''),
    [preview, setPreview] = useState<OriginalExportPreview | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [created, setCreated] = useState<TemporaryLinkCreated | null>(null),
    [revokeId, setRevokeId] = useState<string | null>(null),
    [notice, setNotice] = useState(''),
    [denied, setDenied] = useState(false),
    [phase, setPhase] = useState<
      'idle' | 'prepare' | 'create' | 'uncertain' | 'revoke'
    >('idle');
  const stableDialog = useStableDialogHeight(enabled && !denied);
  const resultHeading = useRef<HTMLHeadingElement | null>(null);
  const createdId = created?.link.id;
  useEffect(() => {
    if (createdId) resultHeading.current?.focus();
  }, [createdId]);
  const controller = useRef<AbortController | null>(null),
    operation = useRef<CreateTemporaryLink | null>(null),
    id = useId(),
    expiryId = useId();
  const choices = documents.filter((d) => d.canExport),
    signature = choices.map((d) => `${d.id}:${d.title}:${d.bytes}`).join('|'),
    [previous, setPrevious] = useState(signature);
  if (previous !== signature) {
    setPrevious(signature);
    setSelected((ids) => ids.filter((id) => choices.some((d) => d.id === id)));
    setPreview(null);
    setConfirmed(false);
  }
  const context = useRef({ enabled, signature });
  context.current = { enabled, signature };
  const loseAccess = () => {
    controller.current?.abort();
    controller.current = null;
    operation.current = null;
    setCreated(null);
    setSelected([]);
    setPreview(null);
    setConfirmed(false);
    setDenied(true);
  };
  const base = `/api/patients/${encodeURIComponent(patientId)}/sharing-links`;
  const history = useManualResource<TemporaryLinksList>(
    enabled && !denied ? base : null,
    (v): v is TemporaryLinksList =>
      isTemporaryLinksList(v) && v.patientId === patientId,
    loseAccess,
  );
  useEffect(() => {
    if (!enabled) {
      controller.current?.abort();
      controller.current = null;
      setPreview(null);
      setConfirmed(false);
      setPhase(operation.current ? 'uncertain' : 'idle');
    }
  }, [enabled]);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
      operation.current = null;
    },
    [],
  );
  const busy = ['prepare', 'create', 'revoke', 'uncertain'].includes(phase),
    total = choices
      .filter((d) => selected.includes(d.id))
      .reduce((n, d) => n + d.bytes, 0),
    validHours =
      /^\d{1,3}$/.test(hours) && Number(hours) >= 1 && Number(hours) <= 168;
  const liveCreated =
      created &&
      history.value?.links.find((link) => link.id === created.link.id),
    secret =
      created?.token && liveCreated?.state === 'active'
        ? temporaryShareUrl(window.location.href, created.token)
        : null;
  async function run(kind: 'prepare' | 'create' | 'revoke') {
    if (!enabled || denied || controller.current) return;
    if (
      kind === 'prepare' &&
      (!selected.length ||
        !validHours ||
        total > maximumOriginalExportContentBytes)
    )
      return;
    if (kind === 'create' && (!confirmed || (!operation.current && !preview)))
      return;
    if (kind === 'revoke' && !revokeId) return;
    const abort = new AbortController(),
      version = signature;
    controller.current = abort;
    setPhase(kind);
    setNotice('');
    const timer = window.setTimeout(() => abort.abort(), 25000);
    try {
      let result: unknown;
      if (kind === 'create') {
        operation.current ??= {
          requestId: crypto.randomUUID(),
          documentIds: preview!.files.map((d) => d.id),
          selectionSha256: preview!.snapshotSha256,
          expiresInHours: Number(hours),
          confirmed: true,
        };
        result = await sharingJson(base, operation.current, abort.signal);
      } else
        result = await sharingJson(
          kind === 'prepare'
            ? base + '/prepare'
            : `${base}/${encodeURIComponent(revokeId!)}/revoke`,
          kind === 'prepare' ? { documentIds: selected } : {},
          abort.signal,
        );
      abort.signal.throwIfAborted();
      if (controller.current !== abort || !context.current.enabled) return;
      if (kind === 'prepare') {
        if (context.current.signature !== version) return;
        if (
          !isOriginalExportPreview(result) ||
          result.patientId !== patientId ||
          result.files.length !== selected.length ||
          result.files.some((f) => !selected.includes(f.id))
        )
          throw Error();
        setPreview(result);
        setConfirmed(false);
      }
      if (kind === 'create') {
        if (!isTemporaryLinkCreated(result)) throw Error();
        setCreated(result);
        operation.current = null;
        setPreview(null);
        setConfirmed(false);
        history.reload();
      }
      if (kind === 'revoke') {
        if (
          !result ||
          typeof result !== 'object' ||
          !('revoked' in result) ||
          result.revoked !== true ||
          !('protection' in result) ||
          result.protection !== 'pending'
        )
          throw Error();
        if (created?.link.id === revokeId)
          setCreated({
            ...created,
            token: null,
            link: { ...created.link, state: 'revoked' },
          });
        setRevokeId(null);
        setNotice(
          'Access blocked. Restore protection pending. Previously downloaded copies cannot be recalled.',
        );
        history.reload();
      }
      setPhase('idle');
    } catch (error) {
      if (controller.current !== abort) return;
      setConfirmed(false);
      if (
        error instanceof ManualApiError &&
        [401, 403, 404].includes(error.status)
      ) {
        loseAccess();
        return;
      }
      if (
        kind === 'create' &&
        !(error instanceof ManualApiError && [400, 409].includes(error.status))
      ) {
        setPhase('uncertain');
        setNotice(
          'Creation could not be confirmed. Retry the same request; do not create a second link. If you leave, check outstanding links before creating another.',
        );
      } else {
        if (kind === 'create') operation.current = null;
        if (kind === 'revoke') history.reload();
        setPhase('idle');
        setPreview(null);
        setNotice(
          error instanceof ManualApiError && error.status === 409
            ? 'The selection changed or the outstanding-link limit was reached. Review sources and existing links before retrying.'
            : kind === 'revoke'
              ? 'Revocation could not be confirmed. Check current status and retry.'
              : 'Shared access could not be prepared. Try again.',
        );
      }
    } finally {
      window.clearTimeout(timer);
      if (controller.current === abort) {
        controller.current = null;
        if (kind === 'prepare' && context.current.signature !== version)
          setPhase('idle');
      }
    }
  }
  async function copy() {
    if (!secret || !liveCreated) return;
    if (Date.parse(liveCreated.expiresAt) <= Date.now()) {
      history.reload();
      setNotice('This link has expired. Create a new one if needed.');
      return;
    }
    try {
      await navigator.clipboard.writeText(secret);
      setNotice(
        'Secret link copied. Share it only with the intended recipient.',
      );
    } catch {
      setNotice(
        'Copy is unavailable. Select the secret link below and copy it manually.',
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
        {...stableDialog}
        className="max-w-2xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Share original documents</DialogTitle>
          <DialogDescription>
            Patient: {patientName}. Only the profile owner can issue or revoke
            temporary links.
          </DialogDescription>
        </DialogHeader>
        {!enabled ? (
          <p role="status">Checking owner access…</p>
        ) : denied ? (
          <p role="alert">
            Owner sharing access is no longer available. No private sharing
            details are displayed.
          </p>
        ) : (
          <>
            {notice && (
              <p role="status" className="text-sm">
                {notice}
              </p>
            )}
            {created ? (
              <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
                <h3 ref={resultHeading} tabIndex={-1} className="font-medium">
                  {created.created
                    ? 'Temporary link created'
                    : 'Creation already completed'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  The secret is shown only in this session. Anyone holding it
                  can access the selected originals until expiry, revocation or
                  source invalidation.
                </p>
                <p className="text-sm text-muted-foreground">
                  Expires {new Date(created.link.expiresAt).toLocaleString()}.
                </p>
                {secret ? (
                  <>
                    <label className="text-sm font-medium" htmlFor={id}>
                      Secret sharing link — copy now
                    </label>
                    <Input
                      id={id}
                      value={secret}
                      readOnly
                      onFocus={(e) => e.target.select()}
                    />
                    <Button
                      variant="outline"
                      data-focus-key="share-copy"
                      disabled={busy}
                      onClick={() => void copy()}
                    >
                      <Copy size={16} aria-hidden="true" />
                      Copy secret link
                    </Button>
                  </>
                ) : history.phase === 'loading' ? (
                  <p role="status">Checking current link status…</p>
                ) : (
                  <p className="text-sm">
                    This secret cannot be recovered or is no longer active.
                    Revoke the link and create a new one if needed.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busy || liveCreated?.state === 'revoked'}
                    onClick={() => setRevokeId(created.link.id)}
                  >
                    Revoke this link
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setCreated(null);
                      setSelected([]);
                      setHours('');
                      setNotice('');
                    }}
                  >
                    Prepare another selection
                  </Button>
                </div>
              </div>
            ) : phase === 'uncertain' ? (
              <div className="space-y-3 rounded-xl border border-border p-4">
                <h3 className="font-medium">Resolve the previous creation</h3>
                <div className="flex items-start gap-3">
                  <input
                    id={id}
                    type="checkbox"
                    className="mt-1 size-5 shrink-0 accent-primary"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  <label htmlFor={id} className="min-h-11 text-sm">
                    Retry the same selected scope and expiry. If it already
                    exists, the secret will not be returned again.
                  </label>
                </div>
                <Button
                  disabled={!confirmed}
                  onClick={() => void run('create')}
                >
                  Retry same creation
                </Button>
                <Button variant="outline" onClick={history.reload}>
                  Refresh outstanding links
                </Button>
              </div>
            ) : preview ? (
              <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
                <h3 className="font-medium">
                  Review link for {preview.patientName}
                </h3>
                <p className="text-sm">
                  {preview.files.length} selected original
                  {preview.files.length === 1 ? '' : 's'} ·{' '}
                  {formatFileSize(total)} · expires in {hours} hours.
                </p>
                <ul className="space-y-1 text-sm">
                  {preview.files.map((f) => (
                    <li key={f.id} className="break-words">
                      {f.title}
                    </li>
                  ))}
                </ul>
                <div className="flex items-start gap-3">
                  <input
                    id={id}
                    type="checkbox"
                    className="mt-1 size-5 shrink-0 accent-primary"
                    checked={confirmed}
                    disabled={busy}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  <label htmlFor={id} className="min-h-11 text-sm">
                    Anyone holding the secret link may download only these
                    originals without an account. Revocation cannot recall
                    downloaded copies.
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={!confirmed || busy}
                    onClick={() => void run('create')}
                  >
                    <LinkIcon size={16} aria-hidden="true" />
                    {phase === 'create'
                      ? 'Creating private link…'
                      : 'Create temporary link'}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setPreview(null);
                      setConfirmed(false);
                    }}
                  >
                    Change selection
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Select up to 20 originals, 32 MiB combined. No document is
                  selected automatically. Changes or Trash/Restore invalidate
                  the link.
                </p>
                <OriginalSelection
                  documents={choices}
                  selected={selected}
                  disabled={busy}
                  onChange={setSelected}
                  legend="Originals to share"
                />
                {!choices.length && (
                  <p className="text-sm">
                    No originals are available to share. Existing links can
                    still be managed below.
                  </p>
                )}
                <p role="status" className="text-sm">
                  {selected.length} selected · {formatFileSize(total)} / 32 MiB
                </p>
                <label htmlFor={expiryId} className="block text-sm font-medium">
                  Expiry in hours (1–168)
                </label>
                <Input
                  id={expiryId}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={168}
                  step={1}
                  required
                  aria-invalid={hours !== '' && !validHours}
                  value={hours}
                  disabled={busy}
                  onChange={(e) => setHours(e.target.value)}
                />
                <Button
                  disabled={
                    busy ||
                    !selected.length ||
                    !validHours ||
                    total > maximumOriginalExportContentBytes
                  }
                  onClick={() => void run('prepare')}
                >
                  {phase === 'prepare'
                    ? 'Checking selected sources…'
                    : 'Review temporary link'}
                </Button>
              </div>
            )}
            <details className="rounded-xl border border-border p-3">
              <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">
                Outstanding and recent links
              </summary>
              <div className="mt-3 space-y-3">
                {history.phase === 'failed' ? (
                  <p role="alert" className="text-sm">
                    Link history is unavailable. Refresh before creating another
                    link after an uncertain result.
                  </p>
                ) : !history.value ? (
                  <p role="status">Loading owner link history…</p>
                ) : (
                  <>
                    <ul className="space-y-3">
                      {history.value.links.map((link) => (
                        <li
                          key={link.id}
                          className="space-y-2 rounded-lg border border-border p-3 text-sm"
                        >
                          <p className="font-medium">
                            {link.documentIds.length} original
                            {link.documentIds.length === 1 ? '' : 's'} ·{' '}
                            {link.state.replace('-', ' ')}
                          </p>
                          {link.state === 'revoked' && (
                            <p className="text-muted-foreground">
                              Access blocked. Restore protection pending.
                            </p>
                          )}
                          <p className="text-muted-foreground">
                            Expires {new Date(link.expiresAt).toLocaleString()}
                          </p>
                          <OwnerLinkActivity
                            patientId={patientId}
                            linkId={link.id}
                            enabled={enabled && !denied}
                            onDenied={loseAccess}
                          />
                          {link.state !== 'revoked' && (
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() => setRevokeId(link.id)}
                            >
                              Revoke link {link.id.slice(-8)}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {!history.value.links.length && (
                      <p className="text-sm">
                        No links have been created for this patient.
                      </p>
                    )}
                    {history.value.limited && (
                      <p className="text-xs text-muted-foreground">
                        Older link history is limited; outstanding links are
                        listed first.
                      </p>
                    )}
                  </>
                )}
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={history.reload}
                >
                  Refresh link history
                </Button>
              </div>
            </details>
            {revokeId && (
              <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
                <p className="text-sm">
                  Revoke this link for {patientName}? Future access stops;
                  downloaded copies remain outside the vault.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => void run('revoke')}>
                    {phase === 'revoke' ? 'Revoking…' : 'Confirm revocation'}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setRevokeId(null)}
                  >
                    Keep link
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
        <Button variant="ghost" onClick={onClose}>
          {busy ? 'Close sharing — operation may finish' : 'Close sharing'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
