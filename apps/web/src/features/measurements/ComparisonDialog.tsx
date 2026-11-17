import { useEffect, useRef, useState } from 'react';
import type {
  MeasurementWorkspace,
  MeasurementComparisonResult,
} from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { MeasurementDetails } from './MeasurementDetails';
import { ConfirmedTrend } from './ConfirmedTrend';
import type { useComparisonAction } from './useComparisonAction';
type Manager = ReturnType<typeof useComparisonAction>;
export function ComparisonDialog({
  manager,
  workspace,
  enabled,
  onDenied,
  onReload,
  onReconfirm,
  restoreFocus,
}: {
  manager: Manager;
  workspace: MeasurementWorkspace | null;
  enabled: boolean;
  onDenied: () => void;
  onReload: () => void;
  onReconfirm: (value: MeasurementComparisonResult) => void;
  restoreFocus: () => void;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null),
    [withdrawing, setWithdrawing] = useState(false);
  const action = manager.action;
  const key = action?.setId + ':' + action?.kind;
  useEffect(() => {
    setAcknowledgement(null);
    setWithdrawing(false);
  }, [key]);
  const result =
    enabled && typeof manager.read === 'object' ? manager.read : null;
  const create = action?.kind === 'confirm';
  const ackContext =
    action?.kind === 'confirm'
      ? JSON.stringify([
          action.setId,
          action.expectedRevision,
          action.options.map((o) => o.member),
        ])
      : result
        ? `${result.setId}:${result.revision}`
        : null;
  const acknowledged =
    acknowledgement !== null && acknowledgement === ackContext;
  const ready = enabled && manager.validContext && (create || !!result);
  const pending = manager.phase === 'pending';
  const actionable =
    ready &&
    (create ||
      (!!result?.canConfirm &&
        result.status !== 'withdrawn' &&
        result.status !== 'missing' &&
        withdrawing));
  const values =
    create && action
      ? action.options.map((o) => ({
          measurement: o.measurement,
          title: o.title,
        }))
      : result?.status === 'current'
        ? result.measurements.map((m) => ({
            measurement: m,
            title:
              workspace?.sources.find(
                (s) => s.documentId === m.provenance.documentId,
              )?.title ?? 'Source document',
          }))
        : [];
  return (
    <Dialog
      open={!!action}
      onOpenChange={(open) => {
        if (!open) manager.close();
      }}
    >
      <DialogContent
        closeDisabled={pending}
        className="max-w-3xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          title.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          restoreFocus();
        }}
        onEscapeKeyDown={(e) => {
          if (pending) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle ref={title} tabIndex={-1}>
            {create ? 'Review comparability' : 'Comparison confirmation'}
          </DialogTitle>
          <DialogDescription>
            Compare source fields before making a decision. Original reports and
            their source confirmations are kept.
          </DialogDescription>
        </DialogHeader>
        {!enabled ? (
          <p role="status">Checking patient access…</p>
        ) : !manager.validContext ? (
          <p role="alert">
            Selected results changed or owner access is unavailable. Close this
            review and select current results.
          </p>
        ) : !create && manager.read === 'loading' ? (
          <p role="status">Loading comparison…</p>
        ) : !create && manager.read === 'failed' ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert">The comparison could not be loaded.</p>
            <Button variant="outline" onClick={manager.reloadRead}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            {!create && result?.status === 'current' && (
              <ConfirmedTrend
                key={result.setId + ':' + result.revision}
                result={result}
                sources={workspace?.sources ?? []}
                onDenied={onDenied}
                onReload={onReload}
              />
            )}
            {values.length > 0 && (create || result?.status !== 'current') && (
              <div className="flex flex-col gap-3">
                {values.map(({ measurement: m, title: sourceTitle }) => (
                  <article
                    key={m.provenance.documentId + ':' + m.source.id}
                    className="min-w-0 rounded-xl border border-border p-4"
                  >
                    <p className="text-sm font-medium [overflow-wrap:anywhere]">
                      {m.fields.analyte}
                    </p>
                    <p className="mt-1 text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">
                      {m.fields.result}{' '}
                      <span className="text-sm font-normal text-muted-foreground">
                        {m.fields.unit ?? 'Unit unknown'}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      {sourceTitle}
                    </p>
                    <p className="mt-2 text-sm [overflow-wrap:anywhere]">
                      Specimen: {m.fields.specimen ?? 'Unknown'} · Method:{' '}
                      {m.fields.method ?? 'Unknown'}
                    </p>
                    <details className="mt-2">
                      <summary className="min-h-11 cursor-pointer content-center rounded-sm text-sm text-primary focus-visible:outline-2 focus-visible:outline-ring">
                        Source details
                      </summary>
                      <MeasurementDetails
                        measurement={m}
                        source={
                          workspace?.sources.find(
                            (s) => s.documentId === m.provenance.documentId,
                          ) ??
                          (action?.kind === 'read'
                            ? action.sources.find(
                                (s) => s.documentId === m.provenance.documentId,
                              )
                            : undefined)
                        }
                        enabled={ready}
                        onDenied={onDenied}
                        onReload={onReload}
                      />
                    </details>
                  </article>
                ))}
              </div>
            )}
            {result?.status === 'invalid' && (
              <p role="status">
                A source or confirmation changed. This set cannot supply
                comparable results until the owner reviews current sources
                again.
              </p>
            )}
            {result?.status === 'withdrawn' && (
              <p role="status">
                Comparability confirmation is withdrawn. Source confirmations
                and originals are unchanged.
              </p>
            )}
            {result?.status === 'missing' && (
              <p role="status">This comparison is no longer available.</p>
            )}
            {create &&
              values.some(
                (v) =>
                  v.measurement.fields.method === null ||
                  v.measurement.fields.specimen === null,
              ) && (
                <p className="text-sm text-muted-foreground">
                  Some source fields are unknown. Confirm only if you can
                  establish that these reports are comparable.
                </p>
              )}
            {withdrawing && (
              <p className="text-sm">
                These results will no longer be treated as comparable. Their
                original reports and verification history remain available.
              </p>
            )}
            {actionable && (
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0 accent-primary"
                  checked={acknowledged}
                  disabled={pending}
                  onChange={(e) =>
                    setAcknowledgement(e.target.checked ? ackContext : null)
                  }
                />
                <span>
                  {create
                    ? 'I confirm that these reports are comparable using the shown test, unit, specimen and method.'
                    : 'I want to withdraw this comparability confirmation.'}
                </span>
              </label>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              {!create &&
                result?.canConfirm &&
                result.status === 'invalid' &&
                !withdrawing && (
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => onReconfirm(result)}
                  >
                    Select current results
                  </Button>
                )}
              {!create &&
                result?.canConfirm &&
                ['current', 'invalid'].includes(result.status) &&
                !withdrawing && (
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setAcknowledgement(null);
                      setWithdrawing(true);
                    }}
                  >
                    Withdraw confirmation
                  </Button>
                )}
              {actionable && (
                <Button
                  variant={create ? 'default' : 'outline'}
                  className={
                    create
                      ? undefined
                      : 'border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive'
                  }
                  disabled={
                    !acknowledged || pending || manager.phase === 'conflict'
                  }
                  onClick={() =>
                    void manager.submit(manager.phase === 'uncertain')
                  }
                >
                  {pending
                    ? 'Saving…'
                    : manager.phase === 'uncertain'
                      ? 'Retry safely'
                      : create
                        ? 'Confirm comparability'
                        : 'Confirm withdrawal'}
                </Button>
              )}
            </div>
          </>
        )}
        {manager.phase === 'uncertain' && (
          <p role="alert" className="text-sm">
            The save could not be confirmed. Revalidate access, then retry
            safely using the same request. Check saved comparisons before
            starting another set.
          </p>
        )}
        {manager.phase === 'conflict' && (
          <p role="alert" className="text-sm">
            The source or comparison changed. Close this review, refresh results
            and review the latest information.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
