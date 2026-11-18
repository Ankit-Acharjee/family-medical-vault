import { useEffect, useId, useState } from 'react';
import { isGroundedSummary, isGroundedSummaryRequest } from '@fmv/contracts';
import type { GroundedSummaryRequest } from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { useManualResource } from '../manual-readings/api';
import { GroundedSummaryContent } from './GroundedSummaryContent';
export function GroundedSummaryDialog({
  patientId,
  patientName,
  enabled,
  onClose,
  onDenied,
  onRestoreFocus,
}: {
  patientId: string;
  patientName: string;
  enabled: boolean;
  onClose: () => void;
  onDenied: () => void;
  onRestoreFocus: () => void;
}) {
  const [request, setRequest] = useState<GroundedSummaryRequest>({
    scope: 'patient',
    period: null,
  });
  const [arrangement, setArrangement] = useState<'sections' | 'reported-date'>(
    'sections',
  );
  const effectiveArrangement =
    request.scope === 'medication' ? 'sections' : arrangement;
  const [scope, setScope] = useState('patient'),
    [fromDate, setFromDate] = useState(''),
    [toDate, setToDate] = useState(''),
    [validation, setValidation] = useState('');
  const [element, setElement] = useState<HTMLDivElement | null>(null),
    [height, setHeight] = useState(0);
  const hint = useId(),
    scopeId = useId(),
    fromId = useId(),
    toId = useId();
  const query = new URLSearchParams({ scope: request.scope });
  if (request.period) {
    query.set('fromDate', request.period.fromDate);
    query.set('toDate', request.period.toDate);
  }
  const resource = useManualResource(
    enabled
      ? `/api/patients/${encodeURIComponent(patientId)}/summary?${query}`
      : null,
    (v): v is import('@fmv/contracts').GroundedSummary =>
      isGroundedSummary(v) &&
      v.patientId === patientId &&
      v.scope === request.scope &&
      v.period?.fromDate === request.period?.fromDate &&
      v.period?.toDate === request.period?.toDate,
    onDenied,
  );
  const value = enabled ? resource.value : null;
  useEffect(() => {
    if (!element || !value) return;
    const observer = new ResizeObserver(() =>
      setHeight((h) =>
        Math.max(h, Math.ceil(element.getBoundingClientRect().height)),
      ),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, value]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        ref={setElement}
        className="max-w-3xl"
        style={{
          minHeight: height
            ? `min(${height}px, calc(100dvh - 2rem))`
            : undefined,
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Patient summary</DialogTitle>
          <DialogDescription>
            Patient: {patientName}. Current source-linked records.
          </DialogDescription>
        </DialogHeader>
        <details className="min-w-0 rounded-xl border border-border p-3">
          <summary className="min-h-11 cursor-pointer content-center rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
            Summary scope and dates
          </summary>
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const next = {
                scope,
                period: fromDate || toDate ? { fromDate, toDate } : null,
              };
              if (!isGroundedSummaryRequest(next)) {
                setValidation(
                  'Choose a valid scope and both exact, ordered dates, or clear both dates.',
                );
                return;
              }
              setValidation('');
              if (JSON.stringify(next) === JSON.stringify(request))
                resource.reload();
              else setRequest(next);
            }}
          >
            <div className="grid min-w-0 gap-3 sm:grid-cols-3">
              <div className="min-w-0 space-y-1">
                <label htmlFor={scopeId} className="text-sm font-medium">
                  Summary scope
                </label>
                <select
                  id={scopeId}
                  className="min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                  value={scope}
                  disabled={!enabled}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="patient">Patient overview</option>
                  <option value="laboratory">Laboratory results</option>
                  <option value="manual">User-reported readings</option>
                  <option value="medication">Medication snapshot</option>
                </select>
              </div>
              <div className="min-w-0 space-y-1">
                <label htmlFor={fromId} className="text-sm font-medium">
                  From reported date
                </label>
                <Input
                  id={fromId}
                  type="date"
                  value={fromDate}
                  aria-describedby={hint}
                  disabled={!enabled}
                  onChange={(e) => setFromDate(e.target.value)}
                />
              </div>
              <div className="min-w-0 space-y-1">
                <label htmlFor={toId} className="text-sm font-medium">
                  To reported date
                </label>
                <Input
                  id={toId}
                  type="date"
                  value={toDate}
                  aria-describedby={hint}
                  disabled={!enabled}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </div>
            </div>
            <p id={hint} className="text-xs text-muted-foreground">
              Optional dates filter reported collection/observation days.
              Medication status remains a current snapshot. This bounded view
              may omit older records.
            </p>
            {validation && (
              <p role="alert" className="text-sm text-destructive">
                {validation}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={!enabled}>
                Apply summary scope
              </Button>
              <Button
                variant="outline"
                disabled={!enabled}
                onClick={() => {
                  setScope('patient');
                  setFromDate('');
                  setToDate('');
                  setValidation('');
                  if (request.scope === 'patient' && !request.period)
                    resource.reload();
                  else setRequest({ scope: 'patient', period: null });
                }}
              >
                Reset scope
              </Button>
            </div>
          </form>
        </details>
        <div
          role="group"
          aria-label="Summary arrangement"
          className="flex flex-wrap gap-2"
        >
          <Button
            variant={
              effectiveArrangement === 'sections' ? 'secondary' : 'outline'
            }
            aria-pressed={effectiveArrangement === 'sections'}
            disabled={!enabled}
            onClick={() => setArrangement('sections')}
          >
            By record type
          </Button>
          <Button
            variant={
              effectiveArrangement === 'reported-date' ? 'secondary' : 'outline'
            }
            aria-pressed={effectiveArrangement === 'reported-date'}
            disabled={!enabled || request.scope === 'medication'}
            onClick={() => setArrangement('reported-date')}
          >
            By reported date
          </Button>
        </div>
        {!enabled ? (
          <p role="status">Checking summary access…</p>
        ) : resource.phase === 'failed' ? (
          <div className="space-y-3">
            <p role="alert">
              Summary could not be loaded. Previously displayed records are
              hidden.
            </p>
            <Button variant="outline" onClick={resource.reload}>
              Try summary again
            </Button>
          </div>
        ) : !value ? (
          <p role="status">Loading current summary…</p>
        ) : (
          <GroundedSummaryContent
            value={value}
            arrangement={effectiveArrangement}
            enabled={enabled}
            onDenied={onDenied}
            onReload={resource.reload}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
