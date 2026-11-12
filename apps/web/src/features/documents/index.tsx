import { useEffect, useRef, useState } from 'react';
import { FileText, UploadCloud, UserRound } from 'lucide-react';
import './upload.css';
import { documentMimeTypes, maximumDocumentBytes } from '@fmv/contracts';
import type {
  AuthBootstrap,
  DocumentCategory,
  DocumentMimeType,
  DocumentsResult,
  DocumentSummary,
  UploadResult,
} from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { usePatientContext } from '../patients';

const base = (id: string) => `/api/patients/${encodeURIComponent(id)}`;
class RequestError extends Error {
  constructor(readonly status: number) {
    super('Request failed');
  }
}
async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
  });
  if (!response.ok) throw new RequestError(response.status);
  return response;
}
function message(error: unknown) {
  return error instanceof RequestError && [401, 403, 404].includes(error.status)
    ? 'This action is unavailable for your current access.'
    : 'The request could not be completed. Please try again.';
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function documents(
  value: unknown,
  patientId: string,
): value is DocumentsResult {
  return (
    object(value) &&
    typeof value.storageReady === 'boolean' &&
    Array.isArray(value.documents) &&
    value.documents.every(
      (d: unknown) =>
        object(d) &&
        typeof d.id === 'string' &&
        !!d.id &&
        d.patientId === patientId &&
        typeof d.title === 'string' &&
        !!d.title &&
        typeof d.mimeType === 'string' &&
        documentMimeTypes.includes(d.mimeType as DocumentMimeType) &&
        typeof d.bytes === 'number' &&
        Number.isSafeInteger(d.bytes) &&
        d.bytes > 0 &&
        typeof d.createdAt === 'string' &&
        !Number.isNaN(Date.parse(d.createdAt)) &&
        typeof d.categoryId === 'string' &&
        typeof d.canView === 'boolean' &&
        typeof d.canExport === 'boolean',
    )
  );
}
function uploadResult(value: unknown): value is UploadResult {
  return (
    object(value) &&
    typeof value.uploadId === 'string' &&
    !!value.uploadId &&
    typeof value.documentId === 'string' &&
    !!value.documentId &&
    (value.state === 'pending' ||
      value.state === 'ready' ||
      value.state === 'failed')
  );
}

export function DocumentsPanel({
  onRequestUpload,
}: {
  onRequestUpload?: () => void;
}) {
  const { selectedPatient } = usePatientContext();
  const patientId = selectedPatient?.id ?? null;
  const [list, setList] = useState<{
    id: string;
    value: DocumentsResult;
  } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [preview, setPreview] = useState<{
    id: string;
    title: string;
    url: string;
    mime: string;
  } | null>(null);
  const [actionError, setActionError] = useState('');
  const active = useRef(patientId);
  active.current = patientId;
  const action = useRef<AbortController | null>(null);
  useEffect(() => {
    setList(null);
    setError('');
    setActionError('');
    setPreview(null);
    action.current?.abort();
    if (!patientId) return;
    const controller = new AbortController();
    setBusy(true);
    void request(`${base(patientId)}/documents`, { signal: controller.signal })
      .then((r) => r.json() as Promise<unknown>)
      .then((result) => {
        if (!documents(result, patientId)) throw new Error();
        if (!controller.signal.aborted && active.current === patientId)
          setList({ id: patientId, value: result });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted && active.current === patientId)
          setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted && active.current === patientId)
          setBusy(false);
      });
    return () => {
      controller.abort();
      action.current?.abort();
    };
  }, [patientId, version]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  async function read(document: DocumentSummary, download: boolean) {
    if (!patientId) return;
    action.current?.abort();
    const controller = new AbortController();
    action.current = controller;
    setActionError('');
    try {
      const response = await request(
        `${base(patientId)}/documents/${encodeURIComponent(document.id)}/${download ? 'download' : 'preview'}`,
        { signal: controller.signal },
      );
      const blob = await response.blob();
      if (controller.signal.aborted || active.current !== patientId) return;
      const safeBlob = new Blob([blob], { type: document.mimeType });
      const url = URL.createObjectURL(safeBlob);
      if (download) {
        const link = window.document.createElement('a');
        link.href = url;
        link.download = document.title;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      } else
        setPreview({
          id: patientId,
          title: document.title,
          url,
          mime: document.mimeType,
        });
    } catch (e) {
      if (!controller.signal.aborted && active.current === patientId) {
        if (e instanceof RequestError && [401, 403, 404].includes(e.status)) {
          setList(null);
          setPreview(null);
          setError(message(e));
        } else setActionError(message(e));
      }
    }
  }
  if (!selectedPatient) return <p>Select a patient to view documents.</p>;
  const current = list?.id === patientId ? list.value : null;
  return (
    <section aria-label={`Documents for ${selectedPatient.displayName}`}>
      <p>Patient: {selectedPatient.displayName}</p>
      {busy && <p role="status">Loading documents…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <Button onClick={() => setVersion((n) => n + 1)}>Try again</Button>
        </div>
      )}
      {current && (
        <>
          {!current.storageReady && (
            <p>
              Document storage is unavailable. Uploads are not available yet.
            </p>
          )}
          {onRequestUpload && (
            <Button
              disabled={
                !current.storageReady ||
                !selectedPatient.capabilities.some(
                  (capability) => capability.action === 'upload',
                )
              }
              onClick={onRequestUpload}
            >
              Upload documents
            </Button>
          )}
          {current.documents.length ? (
            <ul>
              {current.documents.map((doc) => (
                <li key={doc.id} className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="block">{doc.title}</span>{' '}
                  {doc.canView && (
                    <Button
                      variant="ghost"
                      aria-label={`Preview ${doc.title}`}
                      onClick={() => void read(doc, false)}
                    >
                      Preview
                    </Button>
                  )}{' '}
                  {doc.canExport && (
                    <Button
                      variant="ghost"
                      aria-label={`Download ${doc.title}`}
                      onClick={() => void read(doc, true)}
                    >
                      Download
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No documents are available for this patient.</p>
          )}
        </>
      )}
      {actionError && <p role="alert">{actionError}</p>}
      <Dialog
        open={!!preview && preview.id === patientId}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Document preview</DialogTitle>
            <DialogDescription>{preview?.title}</DialogDescription>
          </DialogHeader>
          {preview &&
            preview.id === patientId &&
            (preview.mime === 'application/pdf' ? (
              <iframe
                title={`Preview ${preview.title}`}
                sandbox=""
                src={preview.url}
              />
            ) : (
              <img src={preview.url} alt={`Preview ${preview.title}`} />
            ))}
        </DialogContent>
      </Dialog>
    </section>
  );
}

type QueueItem = {
  key: string;
  file: File;
  state: 'waiting' | 'uploading' | 'ready' | 'error';
  error?: string;
};
export function DocumentUploadForm({
  onComplete,
}: {
  onComplete?: (allStored: boolean) => void;
}) {
  const { selectedPatient, loading: patientsLoading } = usePatientContext();
  const patientId = selectedPatient?.id ?? null;
  const [availability, setAvailability] = useState<{
    id: string;
    ready: boolean;
    categories: DocumentCategory[];
  } | null>(null);
  const [checkingStorage, setCheckingStorage] = useState(true);
  const [category, setCategory] = useState('');
  const [items, setItems] = useState<QueueItem[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const active = useRef(patientId);
  active.current = patientId;
  const controller = useRef<AbortController | null>(null);
  const inProgress = useRef(false);
  const queuePatient = useRef(patientId);
  const retainedPatient = useRef(selectedPatient);
  if (selectedPatient) retainedPatient.current = selectedPatient;
  const formPatient =
    selectedPatient ?? (patientsLoading ? retainedPatient.current : null);
  useEffect(() => {
    controller.current?.abort();
    inProgress.current = false;
    setBusy(false);
    setCheckingStorage(true);
    // A native file picker can trigger focus revalidation. Keep its queue in
    // memory and preserve layout; disable actions until access is confirmed.
    if (!patientId && patientsLoading) return;
    setAvailability((previous) =>
      previous?.id === patientId ? previous : null,
    );
    setError('');
    if (queuePatient.current !== patientId) {
      queuePatient.current = patientId;
      setItems([]);
      setCategory('');
    }
    if (!patientId) return;
    const abort = new AbortController();
    controller.current = abort;
    void Promise.all([
      request(`${base(patientId)}/documents`, { signal: abort.signal }).then(
        (r) => r.json() as Promise<unknown>,
      ),
      request(`${base(patientId)}/categories`, { signal: abort.signal }).then(
        (r) => r.json() as Promise<unknown>,
      ),
    ])
      .then(([result, categories]) => {
        if (
          !documents(result, patientId) ||
          !object(categories) ||
          !Array.isArray(categories.categories) ||
          !categories.categories.every(
            (c: unknown) =>
              object(c) &&
              typeof c.id === 'string' &&
              !!c.id &&
              typeof c.name === 'string' &&
              !!c.name,
          )
        )
          throw new Error();
        if (!abort.signal.aborted && active.current === patientId)
          setAvailability({
            id: patientId,
            ready: result.storageReady,
            categories: categories.categories as DocumentCategory[],
          });
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted && active.current === patientId) {
          setAvailability(null);
          setError(message(e));
        }
      })
      .finally(() => {
        if (!abort.signal.aborted && active.current === patientId)
          setCheckingStorage(false);
      });
    return () => abort.abort();
  }, [patientId, patientsLoading, version]);
  async function start() {
    if (!patientId || !availability?.ready || inProgress.current) return;
    const pending = items.filter((item) => item.state !== 'ready');
    if (!pending.length) return;
    inProgress.current = true;
    setBusy(true);
    setError('');
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const update = (key: string, patch: Partial<QueueItem>) => {
      if (!abort.signal.aborted && active.current === patientId)
        setItems((previous) =>
          previous.map((item) =>
            item.key === key ? { ...item, ...patch } : item,
          ),
        );
    };
    try {
      const boot: unknown = await (
        await request('/api/auth/bootstrap', { signal: abort.signal })
      ).json();
      if (
        !object(boot) ||
        boot.enabled !== true ||
        typeof boot.csrf !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(boot.csrf)
      )
        throw new Error();
      const csrf = (boot as AuthBootstrap).csrf!;
      let storedAny = false;
      let storedCount = 0;
      for (const item of pending) {
        if (abort.signal.aborted || active.current !== patientId) break;
        update(item.key, { state: 'uploading', error: '' });
        try {
          const bytes = await item.file.arrayBuffer();
          const digest = Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
            (v) => v.toString(16).padStart(2, '0'),
          ).join('');
          if (abort.signal.aborted || active.current !== patientId) break;
          const headers = {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
          };
          const parsed = async (response: Response) => {
            const result: unknown = await response.json();
            if (!uploadResult(result)) throw new Error();
            return result;
          };
          let result = await parsed(
            await request(`${base(patientId)}/uploads`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                title: item.file.name.trim(),
                mimeType: item.file.type,
                bytes: item.file.size,
                sha256: digest,
                idempotencyKey: item.key,
                ...(category ? { categoryId: category } : {}),
              }),
              signal: abort.signal,
            }),
          );
          if (abort.signal.aborted || active.current !== patientId) break;
          if (result.state !== 'ready') {
            result = await parsed(
              await request(
                `${base(patientId)}/uploads/${encodeURIComponent(result.uploadId)}/content`,
                {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-CSRF-Token': csrf,
                  },
                  body: bytes,
                  signal: abort.signal,
                },
              ),
            );
            if (abort.signal.aborted || active.current !== patientId) break;
            result = await parsed(
              await request(
                `${base(patientId)}/uploads/${encodeURIComponent(result.uploadId)}/finalize`,
                { method: 'POST', headers, body: '{}', signal: abort.signal },
              ),
            );
          }
          if (result.state !== 'ready') throw new Error();
          update(item.key, { state: 'ready' });
          storedAny = true;
          storedCount += 1;
        } catch (e) {
          if (!abort.signal.aborted && active.current === patientId)
            update(item.key, { state: 'error', error: message(e) });
        }
      }
      if (storedAny && !abort.signal.aborted && active.current === patientId)
        onComplete?.(storedCount === pending.length);
    } catch (e) {
      if (!abort.signal.aborted && active.current === patientId)
        setError(message(e));
    } finally {
      if (!abort.signal.aborted && active.current === patientId) {
        inProgress.current = false;
        setBusy(false);
      }
    }
  }
  if (!formPatient || (selectedPatient && queuePatient.current !== patientId))
    return (
      <p role="status">
        {patientsLoading || selectedPatient
          ? 'Checking patient access…'
          : 'Select a patient before uploading.'}
      </p>
    );
  const ready =
    availability?.id === patientId &&
    availability.ready &&
    !patientsLoading &&
    !checkingStorage;
  return (
    <>
      <section
        className="document-upload"
        aria-busy={patientsLoading || checkingStorage}
        aria-label={`Upload documents for ${formPatient.displayName}`}
      >
        <div className="document-upload__patient">
          <span className="document-upload__patient-icon" aria-hidden="true">
            <UserRound size={19} />
          </span>
          <div>
            <span className="document-upload__eyebrow">Uploading for</span>
            <strong>{formPatient.displayName}</strong>
          </div>
          <span className="document-upload__recheck" role="status">
            {availability && (patientsLoading || checkingStorage)
              ? 'Rechecking access…'
              : ''}
          </span>
        </div>
        {!availability && !error && (
          <p className="document-upload__notice" role="status">
            Checking document storage…
          </p>
        )}
        {error && (
          <div
            className="document-upload__notice document-upload__notice--error"
            role="alert"
          >
            <p>{error}</p>
            {!availability && (
              <Button onClick={() => setVersion((n) => n + 1)}>
                Try again
              </Button>
            )}
          </div>
        )}
        {availability && !availability.ready && (
          <p className="document-upload__notice">
            Document storage is unavailable. Please try again later.
          </p>
        )}
        {availability && (
          <>
            <div className="document-upload__field">
              <label htmlFor="upload-category">
                Category <span>(optional)</span>
              </label>
              <select
                className="document-upload__select"
                id="upload-category"
                value={category}
                disabled={busy || !ready || items.length > 0}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">Default</option>
                {availability.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="document-upload__field">
              <span className="document-upload__label">Files</span>
              <label className="document-upload__picker" htmlFor="upload-files">
                <UploadCloud size={22} aria-hidden="true" />
                <strong>Choose files</strong>
                <span>PDF, JPEG, PNG or WebP · up to 25 MiB each</span>
                <input
                  id="upload-files"
                  type="file"
                  className="document-upload__input"
                  multiple
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  disabled={busy || !ready}
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = '';
                    if (items.length + files.length > 20) {
                      setError('Choose up to 20 files at a time.');
                      return;
                    }
                    if (
                      files.some(
                        (file) =>
                          !documentMimeTypes.includes(
                            file.type as DocumentMimeType,
                          ) ||
                          !file.size ||
                          file.size > maximumDocumentBytes ||
                          !file.name.trim() ||
                          file.name.trim().length > 200,
                      )
                    ) {
                      setError(
                        'Choose supported files with a name and a size between 1 byte and 25 MiB.',
                      );
                      return;
                    }
                    setError('');
                    setItems((previous) => [
                      ...previous,
                      ...files.map((file): QueueItem => ({
                        key: crypto.randomUUID(),
                        file,
                        state: 'waiting',
                      })),
                    ]);
                  }}
                />
              </label>
            </div>
            {items.length > 0 && (
              <>
                <div className="document-upload__queue-heading">
                  Selected files <span>{items.length} / 20</span>
                </div>
                <ul className="document-upload__queue" aria-live="polite">
                  {items.map((item) => (
                    <li key={item.key} className="document-upload__item">
                      <FileText size={18} aria-hidden="true" />
                      <div className="document-upload__item-content">
                        <span className="document-upload__filename">
                          {item.file.name}:{' '}
                        </span>
                        <span
                          className={`document-upload__status document-upload__status--${item.state}`}
                        >
                          {item.state === 'ready'
                            ? 'Stored'
                            : item.state === 'uploading'
                              ? 'Uploading…'
                              : item.state === 'error'
                                ? 'Failed'
                                : 'Waiting'}
                        </span>
                        {item.error && (
                          <span className="document-upload__item-error">
                            {item.error}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="document-upload__actions">
              {items.length > 0 && (
                <Button
                  variant="outline"
                  disabled={busy || patientsLoading || checkingStorage}
                  onClick={() => {
                    setItems([]);
                    setError('');
                  }}
                >
                  Clear file queue
                </Button>
              )}
              <Button
                disabled={
                  !ready ||
                  busy ||
                  !items.some((item) => item.state !== 'ready')
                }
                onClick={() => void start()}
              >
                {busy ? 'Uploading…' : 'Upload selected files'}
              </Button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
