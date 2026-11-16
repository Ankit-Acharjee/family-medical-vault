import { useEffect, useRef, useState } from 'react';
import { isRelatedDocumentsResult } from '@fmv/contracts';
import type {
  MetadataSuggestion,
  RelatedDocumentsResult,
} from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';

type Source = {
  patientId: string;
  documentId: string;
  title: string;
  patientName: string;
};
type State =
  | { phase: 'loading' | 'failed' | 'denied' }
  | { phase: 'ready'; result: RelatedDocumentsResult };

function Hint({ label, hint }: { label: string; hint: MetadataSuggestion }) {
  return (
    <div className="min-w-0">
      <dt className="font-medium">
        {label} · page {hint.page}
      </dt>
      <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">
        {hint.excerpt}
      </dd>
    </div>
  );
}

export function RelatedDocumentsDialog({
  source,
  enabled,
  onClose,
  onDenied,
  restoreFocus,
  onView,
}: {
  source: Source;
  enabled: boolean;
  onClose: () => void;
  onDenied: () => void;
  restoreFocus: () => void;
  onView: (documentId: string) => void;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setState({ phase: 'loading' });
      return;
    }
    const controller = new AbortController();
    setState({ phase: 'loading' });
    const timeout = window.setTimeout(() => {
      controller.abort();
      setState({ phase: 'failed' });
    }, 15000);
    void fetch(
      `/api/patients/${encodeURIComponent(source.patientId)}/documents/${encodeURIComponent(source.documentId)}/related-documents`,
      {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if ([401, 403, 404].includes(response.status)) {
          if (!controller.signal.aborted) {
            setState({ phase: 'denied' });
            onDenied();
          }
          return;
        }
        if (!response.ok) throw new Error();
        const reader = response.body?.getReader();
        if (!reader) throw new Error();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (controller.signal.aborted) return;
            if (done) break;
            length += value.byteLength;
            if (length > 128 * 1024) {
              await reader.cancel();
              throw new Error();
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const result: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        );
        if (
          !isRelatedDocumentsResult(result) ||
          result.source.documentId !== source.documentId
        )
          throw new Error();
        if (!controller.signal.aborted) setState({ phase: 'ready', result });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ phase: 'failed' });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [source.patientId, source.documentId, enabled, revision, onDenied]);
  const result = enabled && state.phase === 'ready' ? state.result : null;
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
            Possible related documents
          </DialogTitle>
          <DialogDescription className="break-words [overflow-wrap:anywhere]">
            Patient: {source.patientName}. Document: {source.title}.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          These suggestions match unverified saved provider and date hints. They
          do not establish the same encounter. Each original remains
          independent.
        </p>
        {!enabled ? (
          <p role="status" className="text-sm">
            Checking patient and document access…
          </p>
        ) : state.phase === 'loading' ? (
          <p role="status" className="text-sm">
            Looking for possible related documents…
          </p>
        ) : state.phase === 'failed' ? (
          <div className="flex flex-col items-start gap-3">
            <p role="status" className="text-sm">
              Possible related documents could not be loaded.
            </p>
            <Button variant="outline" onClick={() => setRevision((n) => n + 1)}>
              Retry
            </Button>
          </div>
        ) : state.phase === 'denied' ? (
          <p role="status" className="text-sm">
            Document access is no longer available.
          </p>
        ) : null}
        {result?.status === 'insufficient-hints' && (
          <p role="status" className="text-sm">
            No eligible saved provider and report or collection date hints are
            available for this document. Saved hints come from extracted text
            and remain unverified.
          </p>
        )}
        {result?.status === 'ready' && result.matches.length === 0 && (
          <p role="status" className="text-sm">
            No matching saved hints were found.
          </p>
        )}
        {result?.limited && (
          <p role="status" className="text-sm">
            This list is limited and may not include every possible match.
          </p>
        )}
        {result && result.matches.length > 0 && (
          <ul className="grid gap-3">
            {result.matches.map((match) => (
              <li
                key={match.documentId}
                className="min-w-0 rounded-xl border border-border p-4"
              >
                <h3 className="font-semibold [overflow-wrap:anywhere]">
                  {match.title}
                </h3>
                <dl className="mt-3 grid gap-2 text-sm text-muted-foreground">
                  <Hint
                    label="This document: provider"
                    hint={match.evidence.sourceProvider}
                  />
                  <Hint
                    label="This document: date"
                    hint={match.evidence.sourceDate}
                  />
                  <Hint
                    label="Possible match: provider"
                    hint={match.evidence.candidateProvider}
                  />
                  <Hint
                    label="Possible match: date"
                    hint={match.evidence.candidateDate}
                  />
                </dl>
                <Button
                  className="mt-3"
                  variant="outline"
                  onClick={() => onView(match.documentId)}
                >
                  View original
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
