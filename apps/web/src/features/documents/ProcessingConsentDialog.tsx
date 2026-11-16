import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  consentStatus,
  ConsentSnapshot,
  ConsentSource,
} from './ProcessingConsentDetails';
import { ProcessingConsentHistory } from './ProcessingConsentHistory';
import {
  processingConsentPath,
  consentContextKey,
  useProcessingConsent,
} from './useProcessingConsent';

export type ProcessingConsentSource = {
  patientId: string;
  documentId: string;
  patientName: string;
  title: string;
};

export function ProcessingConsentDialog({
  source,
  enabled,
  canManage,
  onClose,
  restoreFocus,
}: {
  source: ProcessingConsentSource;
  enabled: boolean;
  canManage: boolean;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  const title = useRef<HTMLHeadingElement | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const success = useRef<HTMLParagraphElement | null>(null);
  const consent = useProcessingConsent(
    source.patientId,
    source.documentId,
    enabled && canManage,
  );
  const { result, phase, writeState } = consent;
  useEffect(() => {
    if (writeState === 'saved') success.current?.focus();
  }, [writeState]);
  const ready = enabled && canManage && phase === 'ready' && result !== null;
  const reload = () => {
    setConfirmKey(null);
    title.current?.focus();
    consent.reload();
  };
  const confirmed =
    ready &&
    confirmKey !== null &&
    confirmKey ===
      consentContextKey(
        processingConsentPath(source.patientId, source.documentId),
        result.context,
      );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-w-2xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          title.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle ref={title} tabIndex={-1}>
            Processing consent
          </DialogTitle>
          <DialogDescription className="break-words [overflow-wrap:anywhere]">
            Patient: {source.patientName}. Document: {source.title}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted p-4">
          <ShieldCheck
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-primary"
          />
          <p className="text-pretty text-sm leading-6">
            External processing is disabled. PDF text extraction and OCR run in
            your browser.
          </p>
        </div>
        {!canManage || phase === 'denied' ? (
          <p role="status" className="text-sm">
            Processing consent is unavailable for your current access. Only the
            patient owner with document view access can read or withdraw it.
            Original document access is checked separately.
          </p>
        ) : !enabled ? (
          <p role="status" className="text-sm text-muted-foreground">
            Checking patient and document access…
          </p>
        ) : phase === 'loading' ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading processing consent…
          </p>
        ) : phase === 'failed' ? (
          <div className="flex flex-col items-start gap-3">
            <p role="status" className="text-sm">
              Processing consent could not be loaded. The original remains
              available independently.
            </p>
            <Button variant="outline" onClick={consent.retryRead}>
              Retry consent
            </Button>
          </div>
        ) : null}
        {writeState === 'saved' && (
          <p ref={success} tabIndex={-1} role="status" className="text-sm">
            Consent withdrawn. The original, saved text and consent history are
            preserved.
          </p>
        )}
        {ready && (
          <div className="flex min-w-0 flex-col gap-4">
            <section
              aria-label="Current consent"
              className="flex min-w-0 flex-col gap-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-semibold">
                  Latest consent record
                </h3>
                <p className="text-sm font-medium">{consentStatus(result)}</p>
              </div>
              {result.policies.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No approved provider is available. New consent cannot be
                  granted.
                </p>
              )}
              {result.snapshot ? (
                <ConsentSnapshot snapshot={result.snapshot} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No grant or withdrawal has been recorded for this document.
                </p>
              )}
              {result.snapshot?.action === 'grant' && !result.effective && (
                <p className="text-sm text-muted-foreground">
                  This grant is not effective for the current source, expiry or
                  approved provider policy. You can still withdraw the recorded
                  grant.
                </p>
              )}
              <details className="min-w-0 text-sm">
                <summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-ring">
                  Current document source binding
                </summary>
                <ConsentSource context={result.context} />
              </details>
            </section>
            {writeState === 'uncertain' ? (
              <div className="flex flex-col items-start gap-3">
                <p role="status" className="text-sm">
                  The withdrawal result could not be confirmed. Retry the same
                  withdrawal to check its result safely.
                </p>
                <Button
                  variant="outline"
                  onClick={() => void consent.withdraw()}
                >
                  Retry withdrawal
                </Button>
              </div>
            ) : writeState === 'conflict' || writeState === 'failed' ? (
              <div className="flex flex-col items-start gap-3">
                <p role="status" className="text-sm">
                  {writeState === 'conflict'
                    ? 'Consent changed before this withdrawal. Reload consent and review the latest record before trying again.'
                    : 'The withdrawal was not accepted. Reload consent before trying again.'}
                </p>
                <Button variant="outline" onClick={reload}>
                  Reload consent
                </Button>
              </div>
            ) : result.snapshot?.action === 'grant' &&
              writeState !== 'saved' ? (
              confirmed || writeState === 'pending' ? (
                <section
                  aria-label="Confirm consent withdrawal"
                  className="flex flex-col gap-3 rounded-xl border border-border p-4"
                >
                  <h3 className="text-base font-semibold">
                    Withdraw this consent?
                  </h3>
                  <p className="break-words text-sm [overflow-wrap:anywhere]">
                    Patient: {source.patientName}. Document: {source.title}.
                    Withdraw the latest recorded grant. The original, saved text
                    and consent history remain available. This does not erase
                    processing that may have occurred previously.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={writeState === 'pending'}
                      onClick={() => {
                        setConfirmKey(null);
                        title.current?.focus();
                      }}
                    >
                      Cancel withdrawal
                    </Button>
                    <Button
                      disabled={writeState === 'pending'}
                      onClick={() => void consent.withdraw()}
                    >
                      {writeState === 'pending'
                        ? 'Withdrawing…'
                        : 'Confirm withdrawal'}
                    </Button>
                  </div>
                </section>
              ) : (
                <Button
                  variant="outline"
                  className="self-start"
                  onClick={() =>
                    setConfirmKey(
                      consentContextKey(
                        processingConsentPath(
                          source.patientId,
                          source.documentId,
                        ),
                        result.context,
                      ),
                    )
                  }
                >
                  Withdraw consent
                </Button>
              )
            ) : null}
          </div>
        )}
        {result && canManage && phase !== 'denied' && (
          <ProcessingConsentHistory
            key={`${result.context.revision}:${result.context.sourceRevision}:${result.context.lifecycleVersion}:${result.context.sourceSha256}`}
            path={processingConsentPath(source.patientId, source.documentId)}
            context={result.context}
            enabled={ready}
            onDenied={consent.deny}
            onReload={reload}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
