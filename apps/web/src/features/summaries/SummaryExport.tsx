import { useEffect, useId, useRef, useState } from 'react';
import { Download, ShieldCheck } from 'lucide-react';
import type { GroundedSummary } from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import { ManualApiError } from '../manual-readings/api';
import { downloadSummary } from './summary-export';
export function SummaryExport({
  value,
  patientName,
  onReload,
}: {
  value: GroundedSummary;
  patientName: string;
  onReload: () => void;
}) {
  const [open, setOpen] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [phase, setPhase] = useState<
      'idle' | 'pending' | 'success' | 'failed' | 'denied' | 'conflict'
    >('idle');
  const id = useId(),
    controller = useRef<AbortController | null>(null),
    trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    setOpen(false);
    setConfirmed(false);
    setPhase('idle');
    trigger.current?.focus();
  };
  async function submit() {
    if (!confirmed || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setPhase('pending');
    const timer = window.setTimeout(() => abort.abort(), 35000);
    try {
      const blob = await downloadSummary(value, abort.signal);
      if (controller.current !== abort || abort.signal.aborted) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = 'family-medical-vault-summary.zip';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setPhase('success');
      setConfirmed(false);
    } catch (error) {
      if (controller.current !== abort) return;
      setConfirmed(false);
      setPhase(
        error instanceof ManualApiError &&
          [401, 403, 404].includes(error.status)
          ? 'denied'
          : error instanceof ManualApiError && error.status === 409
            ? 'conflict'
            : 'failed',
      );
    } finally {
      window.clearTimeout(timer);
      if (controller.current === abort) controller.current = null;
    }
  }
  return (
    <section className="min-w-0 space-y-3" aria-label="Summary export">
      <Button
        variant="outline"
        aria-expanded={open}
        onClick={(event) => {
          trigger.current = event.currentTarget;
          if (open) cancel();
          else setOpen(true);
        }}
      >
        <Download size={16} aria-hidden="true" />
        Export summary
      </Button>
      {open && (
        <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
          <div className="flex items-start gap-2">
            <ShieldCheck
              size={18}
              className="mt-0.5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">
                Export for {patientName}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                ZIP with a readable offline report and structured JSON. Original
                files are not included.
              </p>
            </div>
          </div>
          <p className="text-sm">
            Scope:{' '}
            {value.scope === 'patient'
              ? 'Patient overview'
              : value.scope === 'laboratory'
                ? 'Laboratory results'
                : value.scope === 'manual'
                  ? 'User-reported readings'
                  : 'Medication snapshot'}
            .{' '}
            {value.period
              ? `Reported dates ${value.period.fromDate} through ${value.period.toDate}.`
              : 'No reported-date filter.'}{' '}
            This bounded snapshot may omit older records.
          </p>
          {phase === 'success' ? (
            <p role="status" className="text-sm">
              Download started. Check your browser’s downloads; delivery to disk
              cannot be confirmed here.
            </p>
          ) : phase === 'conflict' ? (
            <div className="space-y-2">
              <p role="alert" className="text-sm">
                Records changed. Reload and review the current summary before
                exporting.
              </p>
              <Button variant="outline" onClick={onReload}>
                Reload summary before export
              </Button>
            </div>
          ) : phase === 'denied' ? (
            <p role="alert" className="text-sm">
              Export is not currently authorized for this summary or one of its
              sources. Viewing permission is separate; no archive was
              downloaded.
            </p>
          ) : (
            <>
              {phase === 'failed' && (
                <p role="alert" className="text-sm">
                  Export could not be completed. Check browser downloads before
                  retrying; a retry generates a fresh authorized snapshot.
                </p>
              )}
              <div className="flex items-start gap-3">
                <input
                  id={id}
                  type="checkbox"
                  className="mt-0.5 size-5 shrink-0 accent-primary"
                  checked={confirmed}
                  disabled={phase === 'pending'}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <label htmlFor={id} className="min-h-11 cursor-pointer text-sm">
                  I understand this contains private medical information and
                  downloaded copies cannot be revoked.
                </label>
              </div>
              <Button
                disabled={!confirmed || phase === 'pending'}
                onClick={() => void submit()}
              >
                <Download size={16} aria-hidden="true" />
                {phase === 'pending'
                  ? 'Preparing private export…'
                  : 'Download summary ZIP'}
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={cancel}>
            {phase === 'pending' ? 'Cancel export' : 'Close export options'}
          </Button>
        </div>
      )}
    </section>
  );
}
