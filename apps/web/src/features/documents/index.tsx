import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, UploadCloud, UserRound } from 'lucide-react';
import './upload.css';
import { DocumentTextDialog } from './DocumentTextDialog';
import { SavedExtractionDialog } from './SavedExtractionDialog';
import type { SavedTextSource } from './SavedExtractionDialog';
import type { DocumentTextSource } from './DocumentTextDialog';
import { DuplicateUploadNotice } from './DuplicateUploadNotice';
import {
  DocumentsViewSwitcher,
  DocumentTrashConfirmation,
  TrashDocumentRow,
} from './DocumentTrashPresentation';
import {
  DocumentBrowserControls,
  DocumentTitleEditor,
} from './DocumentBrowserControls';
import type { BrowseFilters } from './DocumentBrowserControls';
import { documentMimeTypes, maximumDocumentBytes } from '@fmv/contracts';
import type {
  AuthBootstrap,
  DocumentCategory,
  DocumentMimeType,
  DocumentsResult,
  DocumentSummary,
  UploadResult,
  TrashDocumentsResult,
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
        typeof d.canExport === 'boolean' &&
        (d.canEdit === undefined || typeof d.canEdit === 'boolean') &&
        (d.originalTitle === undefined ||
          typeof d.originalTitle === 'string') &&
        (d.categoryName === undefined || typeof d.categoryName === 'string'),
    )
  );
}
function trashDocuments(
  value: unknown,
  patientId: string,
): value is TrashDocumentsResult {
  return (
    object(value) &&
    Array.isArray(value.documents) &&
    documents({ documents: value.documents, storageReady: false }, patientId) &&
    value.documents.every(
      (d: unknown) =>
        object(d) &&
        typeof d.deletedAt === 'string' &&
        !Number.isNaN(Date.parse(d.deletedAt)) &&
        typeof d.restoreUntil === 'string' &&
        !Number.isNaN(Date.parse(d.restoreUntil)) &&
        typeof d.canRestore === 'boolean' &&
        d.canView === false &&
        d.canExport === false &&
        d.canEdit === false,
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
      value.state === 'failed') &&
    (value.potentialDuplicate === undefined ||
      typeof value.potentialDuplicate === 'boolean')
  );
}

export function DocumentsPanel({
  onRequestUpload,
  refreshRevision = 0,
}: {
  onRequestUpload?: () => void;
  refreshRevision?: number;
}) {
  const { selectedPatient, loading: patientsLoading } = usePatientContext();
  const retainedPatient = useRef(selectedPatient);
  if (selectedPatient) retainedPatient.current = selectedPatient;
  const displayPatient =
    selectedPatient ?? (patientsLoading ? retainedPatient.current : null);
  const patientId = selectedPatient?.id ?? null;
  const [view, setView] = useState<'active' | 'trash'>('active');
  const [list, setList] = useState<
    | (
        | { id: string; view: 'active'; value: DocumentsResult }
        | { id: string; view: 'trash'; value: TrashDocumentsResult }
      )
    | null
  >(null);
  const [lifecycle, setLifecycle] = useState<{
    patientId: string;
    documentId: string;
    title: string;
    action: 'trash' | 'restore';
    restoreUntil?: string;
  } | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState('');
  const lifecycleAction = useRef<AbortController | null>(null);
  const lifecycleInProgress = useRef(false);
  const lifecycleTrigger = useRef<HTMLElement | null>(null);
  const lifecycleRestoreFocus = useRef(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [preview, setPreview] = useState<{
    id: string;
    title: string;
    documentId: string;
    url: string;
    mime: string;
  } | null>(null);
  const [extraction, setExtraction] = useState<
    DocumentTextSource | SavedTextSource | null
  >(null);
  const extractionTrigger = useRef<HTMLButtonElement | null>(null);
  const extractionRestoreFocus = useRef(false);
  const [actionError, setActionError] = useState('');
  const [filters, setFilters] = useState<BrowseFilters>({
    query: '',
    category: '',
    from: '',
    to: '',
  });
  const [editing, setEditing] = useState<{
    patientId: string;
    documentId: string;
    title: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [notice, setNotice] = useState('');
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const previewTrigger = useRef<HTMLElement | null>(null);
  const previewRestoreFocus = useRef(false);
  const panel = useRef<HTMLElement | null>(null);
  const restoreAfterReload = useRef(false);
  const editAction = useRef<AbortController | null>(null);
  const editingBusy = useRef(false);
  const listPatient = useRef(patientId);
  const active = useRef(patientId);
  active.current = patientId;
  const action = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!extractionRestoreFocus.current || busy || patientsLoading) return;
    extractionRestoreFocus.current = false;
    (extractionTrigger.current?.isConnected &&
    !extractionTrigger.current.disabled
      ? extractionTrigger.current
      : (panel.current?.querySelector<HTMLButtonElement>(
          '[aria-label="Document views"] button[aria-pressed="true"]',
        ) ?? panel.current)
    )?.focus();
  }, [list, busy, patientsLoading]);
  useEffect(() => {
    if (!previewRestoreFocus.current || busy || patientsLoading) return;
    previewRestoreFocus.current = false;
    (previewTrigger.current?.isConnected &&
    !(
      previewTrigger.current instanceof HTMLButtonElement &&
      previewTrigger.current.disabled
    )
      ? previewTrigger.current
      : (panel.current?.querySelector<HTMLButtonElement>(
          '[aria-label="Document views"] button[aria-pressed="true"]',
        ) ?? panel.current)
    )?.focus();
  }, [list, busy, patientsLoading]);
  useEffect(() => {
    if (!list || busy || patientsLoading || !restoreAfterReload.current) return;
    restoreAfterReload.current = false;
    (editTrigger.current?.isConnected
      ? editTrigger.current
      : (panel.current?.querySelector<HTMLInputElement>(
          'input[type="search"]',
        ) ?? panel.current)
    )?.focus();
  }, [list, busy, patientsLoading]);
  useEffect(() => {
    if (!lifecycleRestoreFocus.current || busy || patientsLoading) return;
    lifecycleRestoreFocus.current = false;
    (lifecycleTrigger.current?.isConnected &&
    !(
      lifecycleTrigger.current instanceof HTMLButtonElement &&
      lifecycleTrigger.current.disabled
    )
      ? lifecycleTrigger.current
      : (panel.current?.querySelector<HTMLButtonElement>(
          '[aria-label="Document views"] button[aria-pressed="true"]',
        ) ?? panel.current)
    )?.focus();
  }, [list, busy, patientsLoading]);
  useEffect(() => {
    lifecycleAction.current?.abort();
    lifecycleInProgress.current = false;
    setLifecycleBusy(false);
    action.current?.abort();
    editAction.current?.abort();
    editingBusy.current = false;
    setSaving(false);
    if (!patientId && patientsLoading) {
      setBusy(true);
      return;
    }
    if (listPatient.current !== patientId) {
      setList(null);
      setEditing(null);
      setLifecycle(null);
      setPreview(null);
      setExtraction(null);
      setFilters({ query: '', category: '', from: '', to: '' });
      setNotice('');
      listPatient.current = patientId;
    }
    setError('');
    setActionError('');
    if (!patientId) return;
    const controller = new AbortController();
    setBusy(true);
    void request(
      `${base(patientId)}/${view === 'active' ? 'documents' : 'trash'}`,
      { signal: controller.signal },
    )
      .then((r) => r.json() as Promise<unknown>)
      .then((result) => {
        if (
          view === 'active'
            ? !documents(result, patientId)
            : !trashDocuments(result, patientId)
        )
          throw new Error();
        if (!controller.signal.aborted && active.current === patientId) {
          if (view === 'active' && documents(result, patientId)) {
            setList({ id: patientId, view: 'active', value: result });
            setPreview((previous) =>
              previous &&
              result.documents.some(
                (d) => d.id === previous.documentId && d.canView,
              )
                ? previous
                : null,
            );
            setExtraction((previous) =>
              previous &&
              result.documents.some(
                (d) =>
                  d.id === previous.documentId &&
                  d.canView &&
                  (d.mimeType === 'application/pdf' ||
                    d.mimeType.startsWith('image/')),
              )
                ? previous
                : null,
            );
            setEditing((previous) =>
              previous &&
              result.documents.some(
                (d) => d.id === previous.documentId && d.canEdit,
              )
                ? previous
                : null,
            );
            setLifecycle((previous) =>
              previous &&
              previous.action === 'trash' &&
              result.documents.some(
                (d) => d.id === previous.documentId && d.canEdit,
              )
                ? previous
                : null,
            );
          } else if (view === 'trash' && trashDocuments(result, patientId)) {
            setList({ id: patientId, view: 'trash', value: result });
            setPreview(null);
            setExtraction(null);
            setEditing(null);
            setLifecycle((previous) =>
              previous &&
              previous.action === 'restore' &&
              result.documents.some(
                (d) => d.id === previous.documentId && d.canRestore,
              )
                ? previous
                : null,
            );
          }
        }
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted && active.current === patientId) {
          setError(message(e));
          setList(null);
          setPreview(null);
          setExtraction(null);
          setEditing(null);
          setLifecycle(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && active.current === patientId)
          setBusy(false);
      });
    return () => {
      controller.abort();
      action.current?.abort();
      editAction.current?.abort();
      lifecycleAction.current?.abort();
    };
  }, [patientId, patientsLoading, version, refreshRevision, view]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const denyExtraction = useCallback(() => {
    setExtraction(null);
    setPreview(null);
    setList(null);
    setError('Document access is no longer available. Refresh and try again.');
  }, []);
  async function read(document: DocumentSummary, download: boolean) {
    if (!patientId) return;
    if (!download)
      previewTrigger.current =
        window.document.activeElement instanceof HTMLElement
          ? window.document.activeElement
          : null;
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
          documentId: document.id,
          url,
          mime: document.mimeType,
        });
    } catch (e) {
      if (!controller.signal.aborted && active.current === patientId) {
        if (e instanceof RequestError && [401, 403, 404].includes(e.status)) {
          setList(null);
          setPreview(null);
          setExtraction(null);
          setError(message(e));
        } else setActionError(message(e));
      }
    }
  }
  async function rename() {
    if (
      !editing ||
      !patientId ||
      busy ||
      patientsLoading ||
      editingBusy.current ||
      editing.patientId !== patientId
    )
      return;
    const title = editing.title.trim();
    if (
      !title ||
      title.length > 200 ||
      Array.from(editing.title).some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || (code >= 127 && code <= 159);
      })
    ) {
      setEditError(
        'Enter a title of 1–200 characters without control characters.',
      );
      return;
    }
    const controller = new AbortController();
    editAction.current?.abort();
    editAction.current = controller;
    editingBusy.current = true;
    setSaving(true);
    setEditError('');
    try {
      const boot: unknown = await request('/api/auth/bootstrap', {
        signal: controller.signal,
      }).then((r) => r.json());
      if (
        !object(boot) ||
        boot.enabled !== true ||
        typeof boot.csrf !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(boot.csrf)
      )
        throw new Error();
      if (controller.signal.aborted || active.current !== patientId) return;
      const result: unknown = await request(
        `${base(patientId)}/documents/${encodeURIComponent(editing.documentId)}/title`,
        {
          method: 'PATCH',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': boot.csrf,
          },
          body: JSON.stringify({ title }),
        },
      ).then((r) => r.json());
      if (!object(result) || result.saved !== true) throw new Error();
      if (controller.signal.aborted || active.current !== patientId) return;
      setEditing(null);
      setNotice('Document title updated.');
      restoreAfterReload.current = true;
      setVersion((n) => n + 1);
    } catch (e) {
      if (!controller.signal.aborted && active.current === patientId) {
        if (e instanceof RequestError && [401, 403, 404].includes(e.status)) {
          setEditing(null);
          setList(null);
          setError(message(e));
        } else setEditError(message(e));
      }
    } finally {
      if (!controller.signal.aborted && active.current === patientId) {
        setSaving(false);
        editingBusy.current = false;
      }
    }
  }
  async function changeTrash() {
    if (
      !lifecycle ||
      !patientId ||
      busy ||
      patientsLoading ||
      lifecycleInProgress.current ||
      lifecycle.patientId !== patientId
    )
      return;
    const selected = lifecycle;
    const abort = new AbortController();
    lifecycleAction.current?.abort();
    lifecycleAction.current = abort;
    lifecycleInProgress.current = true;
    setLifecycleBusy(true);
    setLifecycleError('');
    let timedOut = false;
    const deadline = window.setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, 30_000);
    try {
      const boot: unknown = await request('/api/auth/bootstrap', {
        signal: abort.signal,
      }).then((r) => r.json());
      if (
        !object(boot) ||
        boot.enabled !== true ||
        typeof boot.csrf !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(boot.csrf)
      )
        throw new Error();
      if (abort.signal.aborted || active.current !== patientId) return;
      const result: unknown = await request(
        `${base(patientId)}/documents/${encodeURIComponent(selected.documentId)}/${selected.action}`,
        {
          method: 'POST',
          signal: abort.signal,
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': boot.csrf,
          },
          body: '{}',
        },
      ).then((r) => r.json());
      if (!object(result) || result.saved !== true) throw new Error();
      if (abort.signal.aborted || active.current !== patientId) return;
      setPreview(null);
      setExtraction(null);
      setLifecycle(null);
      setNotice(
        selected.action === 'trash'
          ? 'Document moved to Trash.'
          : 'Document restored.',
      );
      lifecycleRestoreFocus.current = true;
      setVersion((n) => n + 1);
    } catch (e) {
      if (
        active.current === patientId &&
        lifecycleAction.current === abort &&
        (!abort.signal.aborted || timedOut)
      ) {
        if (timedOut)
          setLifecycleError(
            'The result could not be confirmed. Refresh documents or retry safely.',
          );
        else if (
          e instanceof RequestError &&
          [401, 403, 404].includes(e.status)
        ) {
          setList(null);
          setPreview(null);
          setExtraction(null);
          setLifecycle(null);
          setError(message(e));
        } else if (e instanceof RequestError && e.status === 409) {
          setLifecycle(null);
          setNotice('Recovery is no longer available.');
          lifecycleRestoreFocus.current = true;
          setVersion((n) => n + 1);
        } else setLifecycleError(message(e));
      }
    } finally {
      window.clearTimeout(deadline);
      if (active.current === patientId && lifecycleAction.current === abort) {
        setLifecycleBusy(false);
        lifecycleInProgress.current = false;
      }
    }
  }
  if (!displayPatient) return <p>Select a patient to view documents.</p>;
  const current =
    list?.id === displayPatient.id &&
    list.view === 'active' &&
    view === 'active'
      ? list.value
      : null;
  const trash =
    list?.id === displayPatient.id && list.view === 'trash' && view === 'trash'
      ? list.value
      : null;
  const dateValid = (date: string) =>
    !date ||
    (/^\d{4}-\d{2}-\d{2}$/.test(date) &&
      !Number.isNaN(Date.parse(date)) &&
      new Date(date).toISOString().slice(0, 10) === date);
  const filterError =
    !dateValid(filters.from) || !dateValid(filters.to)
      ? 'Enter valid upload dates.'
      : filters.from && filters.to && filters.from > filters.to
        ? 'The start date must be on or before the end date.'
        : '';
  const query = filters.query.trim().toLowerCase();
  const filtered = filterError
    ? []
    : (current?.documents ?? []).filter((doc) => {
        const date = new Date(doc.createdAt);
        const day = `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        return (
          (!query ||
            doc.title.toLowerCase().includes(query) ||
            (doc.originalTitle ?? doc.title).toLowerCase().includes(query)) &&
          (!filters.category || doc.categoryId === filters.category) &&
          (!filters.from || day >= filters.from) &&
          (!filters.to || day <= filters.to)
        );
      });
  const categories = [
    ...new Map(
      (current?.documents ?? []).map((doc) => [
        doc.categoryId,
        { id: doc.categoryId, name: doc.categoryName ?? 'Unclassified' },
      ]),
    ).values(),
  ];
  return (
    <section
      ref={panel}
      tabIndex={-1}
      className="space-y-4"
      aria-label={`Documents for ${displayPatient.displayName}`}
    >
      <p>Patient: {displayPatient.displayName}</p>
      <DocumentsViewSwitcher
        value={view}
        onChange={(next) => {
          if (next !== view) {
            setLifecycle(null);
            setLifecycleError('');
            setEditing(null);
            setPreview(null);
            setExtraction(null);
            setView(next);
          }
        }}
      />
      {notice && <p role="status">{notice}</p>}
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
                busy ||
                patientsLoading ||
                !displayPatient.capabilities.some(
                  (capability) => capability.action === 'upload',
                )
              }
              onClick={onRequestUpload}
            >
              Upload documents
            </Button>
          )}
          <DocumentBrowserControls
            filters={filters}
            onChange={setFilters}
            onReset={() =>
              setFilters({ query: '', category: '', from: '', to: '' })
            }
            categories={categories}
            count={filtered.length}
            error={filterError}
          />
          <p className="mt-2 text-sm text-muted-foreground">
            Upload dates use your local time.
          </p>
          {filtered.length ? (
            <ul className="mt-4 grid gap-3">
              {filtered.map((doc) => (
                <li
                  key={doc.id}
                  className="min-w-0 rounded-2xl border border-border bg-card p-4 [overflow-wrap:anywhere]"
                >
                  <span className="block font-medium">{doc.title}</span>
                  <span className="mb-2 block text-sm text-muted-foreground">
                    {doc.categoryName ?? 'Unclassified'} · Uploaded{' '}
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </span>
                  {doc.canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy || patientsLoading}
                      aria-label={`Edit title ${doc.title}`}
                      onClick={(event) => {
                        editTrigger.current = event.currentTarget;
                        setNotice('');
                        setEditError('');
                        setEditing({
                          patientId: patientId!,
                          documentId: doc.id,
                          title: doc.title,
                        });
                      }}
                    >
                      Edit title
                    </Button>
                  )}{' '}
                  {doc.canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy || patientsLoading}
                      aria-label={`Move to Trash ${doc.title}`}
                      onClick={(event) => {
                        lifecycleTrigger.current = event.currentTarget;
                        setNotice('');
                        setLifecycleError('');
                        setLifecycle({
                          patientId: patientId!,
                          documentId: doc.id,
                          title: doc.title,
                          action: 'trash',
                        });
                      }}
                    >
                      Move to Trash
                    </Button>
                  )}
                  {doc.canView && (
                    <Button
                      variant="ghost"
                      disabled={busy || patientsLoading}
                      aria-label={`Preview ${doc.title}`}
                      onClick={() => void read(doc, false)}
                    >
                      Preview
                    </Button>
                  )}{' '}
                  {doc.canView && doc.mimeType === 'application/pdf' && (
                    <Button
                      variant="ghost"
                      disabled={busy || patientsLoading}
                      aria-label={`Extract text ${doc.title}`}
                      onClick={(event) => {
                        extractionTrigger.current = event.currentTarget;
                        setExtraction({
                          kind: 'pdf',
                          patientId: patientId!,
                          documentId: doc.id,
                          title: doc.title,
                          bytes: doc.bytes,
                        });
                      }}
                    >
                      Extract text
                    </Button>
                  )}
                  {doc.canView &&
                    [
                      'application/pdf',
                      'image/jpeg',
                      'image/png',
                      'image/webp',
                    ].includes(doc.mimeType) && (
                      <Button
                        variant="ghost"
                        disabled={busy || patientsLoading}
                        aria-label={`Recognize text (OCR) ${doc.title}`}
                        onClick={(event) => {
                          extractionTrigger.current = event.currentTarget;
                          setExtraction({
                            patientId: patientId!,
                            documentId: doc.id,
                            title: doc.title,
                            bytes: doc.bytes,
                            kind: 'ocr',
                            mime: doc.mimeType,
                          });
                        }}
                      >
                        Recognize text (OCR)
                      </Button>
                    )}
                  {doc.canView && (
                    <Button
                      variant="ghost"
                      disabled={busy || patientsLoading}
                      aria-label={`Saved text ${doc.title}`}
                      onClick={(event) => {
                        extractionTrigger.current = event.currentTarget;
                        setExtraction({
                          kind: 'saved',
                          patientId: patientId!,
                          documentId: doc.id,
                          title: doc.title,
                          bytes: doc.bytes,
                        });
                      }}
                    >
                      Saved text
                    </Button>
                  )}
                  {doc.canExport && (
                    <Button
                      variant="ghost"
                      disabled={busy || patientsLoading}
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
            <p className="py-6 text-muted-foreground">
              {current.documents.length
                ? 'No documents match these filters. Try another search or clear filters.'
                : 'No documents are available for this patient.'}
            </p>
          )}
        </>
      )}
      {trash && (
        <section aria-label="Trashed documents">
          <p className="text-sm text-muted-foreground">
            Documents in Trash cannot be opened or downloaded. Recovery is
            available for 30 days.
          </p>
          {trash.documents.length ? (
            <ul className="mt-4 grid gap-3">
              {trash.documents.map((doc) => (
                <TrashDocumentRow
                  key={doc.id}
                  document={doc}
                  disabled={busy || patientsLoading}
                  onRestore={() => {
                    lifecycleTrigger.current =
                      document.activeElement instanceof HTMLElement
                        ? document.activeElement
                        : null;
                    setNotice('');
                    setLifecycleError('');
                    setLifecycle({
                      patientId: patientId!,
                      documentId: doc.id,
                      title: doc.title,
                      action: 'restore',
                      restoreUntil: doc.restoreUntil,
                    });
                  }}
                />
              ))}
            </ul>
          ) : (
            <p className="py-6 text-muted-foreground">
              No documents are available in Trash.
            </p>
          )}
        </section>
      )}
      {actionError && <p role="alert">{actionError}</p>}
      <Dialog
        open={!!lifecycle && lifecycle.patientId === displayPatient.id}
        onOpenChange={(open) => {
          if (!open) {
            if (lifecycleBusy) return;
            lifecycleAction.current?.abort();
            lifecycleInProgress.current = false;
            setLifecycleBusy(false);
            setLifecycle(null);
          }
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (busy || patientsLoading) {
              lifecycleRestoreFocus.current = true;
              return;
            }
            (lifecycleTrigger.current?.isConnected
              ? lifecycleTrigger.current
              : (panel.current?.querySelector<HTMLButtonElement>(
                  '[aria-label="Document views"] button[aria-pressed="true"]',
                ) ?? panel.current)
            )?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {lifecycle?.action === 'restore'
                ? 'Restore document'
                : 'Move document to Trash'}
            </DialogTitle>
            <DialogDescription>
              {lifecycle?.action === 'restore'
                ? 'Return the selected original to active documents.'
                : 'Confirm the selected patient and document before moving it to Trash.'}
            </DialogDescription>
          </DialogHeader>
          {lifecycle?.restoreUntil && (
            <p className="text-sm text-muted-foreground">
              Recovery until {new Date(lifecycle.restoreUntil).toLocaleString()}
            </p>
          )}
          {lifecycle && (
            <DocumentTrashConfirmation
              action={lifecycle.action}
              patientName={displayPatient.displayName}
              title={lifecycle.title}
              working={lifecycleBusy || busy || patientsLoading}
              error={lifecycleError}
              onConfirm={() => void changeTrash()}
              onCancel={() => setLifecycle(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!editing && editing.patientId === displayPatient.id}
        onOpenChange={(open) => {
          if (!open) {
            editAction.current?.abort();
            editingBusy.current = false;
            setSaving(false);
            setEditing(null);
          }
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (busy || patientsLoading) {
              restoreAfterReload.current = true;
              return;
            }
            (editTrigger.current?.isConnected
              ? editTrigger.current
              : (panel.current?.querySelector<HTMLInputElement>(
                  'input[type="search"]',
                ) ?? panel.current)
            )?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit document title</DialogTitle>
            <DialogDescription>
              Patient: {displayPatient.displayName}. Original file contents are
              preserved.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <DocumentTitleEditor
              title={editing.title}
              onTitleChange={(title) =>
                setEditing((previous) =>
                  previous ? { ...previous, title } : null,
                )
              }
              onSave={() => void rename()}
              onCancel={() => setEditing(null)}
              saving={saving || busy || patientsLoading}
              error={editError}
            />
          )}
        </DialogContent>
      </Dialog>
      {extraction &&
        extraction.patientId === displayPatient.id &&
        (extraction.kind === 'saved' ? (
          <SavedExtractionDialog
            source={extraction}
            enabled={
              !busy && !patientsLoading && patientId === extraction.patientId
            }
            onClose={() => setExtraction(null)}
            onDenied={denyExtraction}
            restoreFocus={() => {
              if (busy || patientsLoading) {
                extractionRestoreFocus.current = true;
                return;
              }
              (extractionTrigger.current?.isConnected &&
              !extractionTrigger.current.disabled
                ? extractionTrigger.current
                : (panel.current?.querySelector<HTMLButtonElement>(
                    '[aria-label="Document views"] button[aria-pressed="true"]',
                  ) ?? panel.current)
              )?.focus();
            }}
          />
        ) : (
          <DocumentTextDialog
            source={extraction}
            enabled={
              !busy && !patientsLoading && patientId === extraction.patientId
            }
            onClose={() => setExtraction(null)}
            onDenied={denyExtraction}
            restoreFocus={() => {
              if (busy || patientsLoading) {
                extractionRestoreFocus.current = true;
                return;
              }
              (extractionTrigger.current?.isConnected &&
              !extractionTrigger.current.disabled
                ? extractionTrigger.current
                : (panel.current?.querySelector<HTMLButtonElement>(
                    '[aria-label="Document views"] button[aria-pressed="true"]',
                  ) ?? panel.current)
              )?.focus();
            }}
          />
        ))}
      <Dialog
        open={!!preview && preview.id === displayPatient.id}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (busy || patientsLoading) {
              previewRestoreFocus.current = true;
              return;
            }
            (previewTrigger.current?.isConnected
              ? previewTrigger.current
              : (panel.current?.querySelector<HTMLButtonElement>(
                  '[aria-label="Document views"] button[aria-pressed="true"]',
                ) ?? panel.current)
            )?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Document preview</DialogTitle>
            <DialogDescription>{preview?.title}</DialogDescription>
          </DialogHeader>
          {preview &&
            preview.id === displayPatient.id &&
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
  potentialDuplicate?: boolean;
};
export function DocumentUploadForm({
  onComplete,
}: {
  onComplete?: (
    allStored: boolean,
    completion: { patientId: string; potentialDuplicate: boolean },
  ) => void;
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
    // Advisory warnings expire on revalidation; preserve the actual file queue.
    setItems((previous) =>
      previous.map((item) => ({ ...item, potentialDuplicate: false })),
    );
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
    setItems((previous) =>
      previous.map((item) => ({ ...item, potentialDuplicate: false })),
    );
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
      let potentialDuplicate = false;
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
          update(item.key, {
            state: 'ready',
            potentialDuplicate: result.potentialDuplicate === true,
          });
          potentialDuplicate ||= result.potentialDuplicate === true;
          storedAny = true;
          storedCount += 1;
        } catch (e) {
          if (!abort.signal.aborted && active.current === patientId)
            update(item.key, { state: 'error', error: message(e) });
        }
      }
      if (storedAny && !abort.signal.aborted && active.current === patientId)
        onComplete?.(storedCount === pending.length, {
          patientId,
          potentialDuplicate,
        });
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
            {ready &&
              items.some(
                (item) => item.state === 'ready' && item.potentialDuplicate,
              ) && <DuplicateUploadNotice />}
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
