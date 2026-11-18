import { useStableDialogHeight } from '../../components/ui/use-stable-dialog-height';
import {
  OriginalSelection,
  formatFileSize as formatSize,
} from './OriginalSelection';
import { useEffect, useId, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import {
  isOriginalExportPreview,
  maximumOriginalExportFiles,
  maximumOriginalExportContentBytes,
} from '@fmv/contracts';
import type { DocumentSummary, OriginalExportPreview } from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { ManualApiError } from '../manual-readings/api';
import { originalExportRequest } from './original-export-api';
export function OriginalExportDialog({
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
    [preview, setPreview] = useState<OriginalExportPreview | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [phase, setPhase] = useState<
      'idle' | 'pending' | 'success' | 'failed' | 'conflict' | 'denied'
    >('idle');
  const stableDialog = useStableDialogHeight(enabled);
  const controller = useRef<AbortController | null>(null),
    id = useId();
  const choices = documents.filter((d) => d.canExport),
    signature = choices.map((d) => `${d.id}:${d.title}:${d.bytes}`).join('|');
  const [previous, setPrevious] = useState(signature);
  if (previous !== signature) {
    setPrevious(signature);
    setSelected((ids) => ids.filter((id) => choices.some((d) => d.id === id)));
    setPreview(null);
    setConfirmed(false);
  }
  const current = useRef({ enabled, signature });
  current.current = { enabled, signature };
  useEffect(() => {
    if (!enabled) {
      controller.current?.abort();
      controller.current = null;
      setPreview(null);
      setConfirmed(false);
      setPhase('idle');
    }
  }, [enabled]);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );
  const total = choices
      .filter((d) => selected.includes(d.id))
      .reduce((n, d) => n + d.bytes, 0),
    busy = phase === 'pending';
  async function run(download: boolean) {
    if (
      !enabled ||
      controller.current ||
      !selected.length ||
      total > maximumOriginalExportContentBytes ||
      (download && (!preview || !confirmed))
    )
      return;
    const abort = new AbortController(),
      context = signature;
    controller.current = abort;
    setPhase('pending');
    const timer = window.setTimeout(() => abort.abort(), 65000);
    try {
      const result = await originalExportRequest(
        patientId,
        download
          ? {
              documentIds: selected,
              requestId: crypto.randomUUID(),
              confirmed: true,
              format: 'zip',
              snapshotSha256: preview!.snapshotSha256,
            }
          : { documentIds: selected },
        !download,
        abort.signal,
      );
      abort.signal.throwIfAborted();
      if (
        controller.current !== abort ||
        !current.current.enabled ||
        current.current.signature !== context
      )
        return;
      if (download) {
        if (!(result instanceof Blob)) throw Error();
        const url = URL.createObjectURL(result),
          link = document.createElement('a');
        link.href = url;
        link.download = 'family-medical-vault-originals.zip';
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
        setPhase('success');
        setConfirmed(false);
      } else {
        if (
          !isOriginalExportPreview(result) ||
          result.patientId !== patientId ||
          result.files.length !== selected.length ||
          result.files.some((f) => !selected.includes(f.id))
        )
          throw Error();
        setPreview(result);
        setConfirmed(false);
        setPhase('idle');
      }
    } catch (error) {
      if (controller.current !== abort) return;
      setPreview(null);
      setConfirmed(false);
      if (
        error instanceof ManualApiError &&
        [401, 403, 404].includes(error.status)
      ) {
        setSelected([]);
        setPhase('denied');
      } else
        setPhase(
          error instanceof ManualApiError && error.status === 409
            ? 'conflict'
            : 'failed',
        );
    } finally {
      window.clearTimeout(timer);
      if (controller.current === abort) {
        controller.current = null;
        if (current.current.signature !== context) setPhase('idle');
      }
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
          <DialogTitle>Export original documents</DialogTitle>
          <DialogDescription>
            Patient: {patientName}. Choose only the originals you want to
            download.
          </DialogDescription>
        </DialogHeader>
        {!enabled ? (
          <p role="status">Checking document access…</p>
        ) : (
          <>
            {phase === 'success' ? (
              <div className="space-y-3">
                <p role="status">
                  Download started. Check your browser’s downloads; delivery to
                  disk cannot be confirmed here.
                </p>
                <Button onClick={onClose}>Done</Button>
              </div>
            ) : (
              <>
                {phase === 'denied' ? (
                  <p role="alert">
                    One or more selected originals are no longer available for
                    export. No archive was downloaded. Close and refresh your
                    documents.
                  </p>
                ) : (
                  <>
                    {phase === 'failed' && (
                      <p role="alert" className="text-sm">
                        Export could not be completed. Check browser downloads,
                        then review the selection again before retrying.
                      </p>
                    )}
                    {phase === 'conflict' && (
                      <p role="alert" className="text-sm">
                        The selection changed. Review the current originals and
                        confirm again.
                      </p>
                    )}
                    {preview ? (
                      <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
                        <h3 className="font-medium">
                          Review export for {preview.patientName}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {preview.files.length}{' '}
                          {preview.files.length === 1
                            ? 'original'
                            : 'originals'}{' '}
                          ·{' '}
                          {formatSize(
                            preview.files.reduce((n, d) => n + d.bytes, 0),
                          )}
                          . ZIP includes unchanged original bytes and a
                          filename/fingerprint manifest. No extracted text or
                          summary is included.
                        </p>
                        <ul className="space-y-2 text-sm">
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
                            I understand these contain private medical
                            information and downloaded copies cannot be revoked.
                          </label>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            disabled={!confirmed || busy}
                            onClick={() => void run(true)}
                          >
                            <Download size={16} aria-hidden="true" />
                            {busy
                              ? 'Preparing private archive…'
                              : 'Download originals ZIP'}
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              setPreview(null);
                              setConfirmed(false);
                              setPhase('idle');
                            }}
                          >
                            Change selection
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">
                          Choose up to {maximumOriginalExportFiles} files, 32
                          MiB combined. No documents are selected automatically.
                        </p>
                        <OriginalSelection
                          documents={choices}
                          selected={selected}
                          disabled={busy}
                          onChange={(ids) => {
                            setPhase('idle');
                            setSelected(ids);
                          }}
                        />
                        {!choices.length && (
                          <p>
                            No originals are currently available for export.
                          </p>
                        )}
                        <p role="status" className="text-sm">
                          {selected.length} selected · {formatSize(total)} / 32
                          MiB
                        </p>
                        {total > maximumOriginalExportContentBytes && (
                          <p role="alert" className="text-sm">
                            Remove files to keep this archive within 32 MiB.
                          </p>
                        )}
                        <Button
                          disabled={
                            busy ||
                            !selected.length ||
                            total > maximumOriginalExportContentBytes
                          }
                          onClick={() => void run(false)}
                        >
                          {busy
                            ? 'Checking selected originals…'
                            : 'Review selected originals'}
                        </Button>
                      </>
                    )}
                  </>
                )}
                <Button variant="ghost" onClick={onClose}>
                  {busy ? 'Cancel export' : 'Cancel'}
                </Button>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
