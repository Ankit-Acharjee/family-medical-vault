import { useEffect, useState } from 'react';
import { ArrowRight, FileText } from 'lucide-react';
import type { DocumentSummary, PatientSummary } from '@fmv/contracts';
import { Button } from '../ui/button';
import { usePatientContext } from '../../features/patients';
import { isDocumentsResult } from '../../features/documents/document-results';
import type { DocumentOpenRequest } from '../../features/documents/document-results';

type Result = {
  patient: PatientSummary;
  revision: number;
  retry: number;
  rows: DocumentSummary[];
  error: 'unavailable' | 'denied' | null;
};
class AccessDenied extends Error {}

export function RecentDocuments({
  refreshRevision,
  onOpen,
}: {
  refreshRevision: number;
  onOpen: (selection: DocumentOpenRequest) => void;
}) {
  const { selectedPatient, loading } = usePatientContext();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    if (!selectedPatient || loading) return;
    const patient = selectedPatient;
    const controller = new AbortController();
    let disposed = false;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    void fetch(`/api/patients/${encodeURIComponent(patient.id)}/documents`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if ([401, 403, 404].includes(response.status)) throw new AccessDenied();
        if (!response.ok) throw Error();
        const value: unknown = await response.json();
        if (!isDocumentsResult(value, patient.id)) throw Error();
        const rows = value.documents
          .filter((row) => row.canView || row.canExport)
          .sort(
            (a, b) =>
              Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
              a.id.localeCompare(b.id),
          )
          .slice(0, 5);
        if (!disposed && !controller.signal.aborted)
          setResult({
            patient,
            revision: refreshRevision,
            retry,
            rows,
            error: null,
          });
      })
      .catch((error: unknown) => {
        if (!disposed)
          setResult({
            patient,
            revision: refreshRevision,
            retry,
            rows: [],
            error: error instanceof AccessDenied ? 'denied' : 'unavailable',
          });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [selectedPatient, loading, refreshRevision, retry]);
  const current =
    !loading &&
    result?.patient === selectedPatient &&
    result.revision === refreshRevision &&
    result.retry === retry
      ? result
      : null;
  return (
    <section
      className="records-section recent-documents"
      aria-labelledby="records-title"
      aria-busy={!current}
    >
      <div className="section-heading">
        <div>
          <h2 id="records-title">Recent documents</h2>
          <p>Latest uploads for this patient.</p>
        </div>
        <a href="#documents" className="text-link">
          View all
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </div>
      {!current ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Loading recent documents…
        </p>
      ) : current.error ? (
        <div className="mt-4 space-y-2" role="alert">
          <p className="text-sm">
            {current.error === 'denied'
              ? 'Recent documents are unavailable for your current access.'
              : 'Recent documents could not be loaded.'}
          </p>
          <Button
            variant="outline"
            onClick={() => setRetry((value) => value + 1)}
          >
            Try again
          </Button>
        </div>
      ) : current.rows.length === 0 ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          No recent documents are available for this patient.
        </p>
      ) : (
        <ul
          className="mt-4 divide-y divide-border"
          aria-label="Recent documents"
        >
          {current.rows.map((row) => (
            <li
              key={row.id}
              className="flex min-w-0 items-start gap-3 py-3 first:pt-0 last:pb-0"
            >
              <FileText
                size={20}
                aria-hidden="true"
                className="mt-3 shrink-0 text-muted-foreground"
              />
              <div className="min-w-0 flex-1">
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start px-0 py-2 text-left whitespace-normal [overflow-wrap:anywhere]"
                  aria-label={`${row.canView ? 'Open' : 'View in Documents'} ${row.title}`}
                  onClick={() => {
                    if (!loading && selectedPatient === current.patient)
                      onOpen({
                        patientId: selectedPatient.id,
                        documentId: row.id,
                        intent: row.canView ? 'preview' : 'locate',
                      });
                  }}
                >
                  {row.title}
                </Button>
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  {row.categoryName ?? 'Unclassified'} · Uploaded{' '}
                  <time dateTime={row.createdAt}>
                    {new Date(row.createdAt).toLocaleDateString()}
                  </time>
                  {!row.canView ? ' · Export only' : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
