// DocumentTrashPresentation.tsx
// Pure presentation components for the document trash flow.
// No state, auth, or business logic — parents own dialogs, validation, and data.

import { Button } from '../../components/ui/button';
import type { TrashDocumentSummary } from '@fmv/contracts';

export function DocumentsViewSwitcher({
  value,
  onChange,
}: {
  value: 'active' | 'trash';
  onChange: (value: 'active' | 'trash') => void;
}) {
  const views: Array<{ key: 'active' | 'trash'; label: string }> = [
    { key: 'active', label: 'Active documents' },
    { key: 'trash', label: 'Trash' },
  ];
  return (
    <div
      className="flex flex-wrap items-center gap-2 group"
      aria-label="Document views"
      role="group"
    >
      {views.map((view) => (
        <Button
          key={view.key}
          type="button"
          variant={value === view.key ? 'secondary' : 'ghost'}
          aria-pressed={value === view.key}
          className="min-h-11"
          onClick={() => onChange(view.key)}
        >
          {view.label}
        </Button>
      ))}
    </div>
  );
}

export function DocumentTrashConfirmation({
  action,
  patientName,
  title,
  working,
  error,
  onConfirm,
  onCancel,
}: {
  action: 'trash' | 'restore';
  patientName: string;
  title: string;
  working: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const copy =
    action === 'trash'
      ? 'This removes the document from active records. You can restore it from Trash for 30 days. The original file is retained during recovery.'
      : 'Restore this document to active records. Existing permissions still apply.';
  const actionLabel = action === 'trash' ? 'Move to Trash' : 'Restore';
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm();
      }}
      className="flex flex-col gap-4"
    >
      <section className="flex flex-col gap-1">
        <p className="text-sm text-foreground [overflow-wrap:anywhere]">
          <span className="font-medium">Patient:</span> {patientName}
        </p>
        <p className="text-sm text-foreground [overflow-wrap:anywhere]">
          <span className="font-medium">Document:</span> {title}
        </p>
      </section>
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {copy}
      </p>
      {error ? (
        <p
          role="alert"
          className="text-sm text-destructive [overflow-wrap:anywhere]"
        >
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          onClick={onCancel}
          disabled={working}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant={action === 'trash' ? 'outline' : 'default'}
          className={
            action === 'trash'
              ? 'min-h-11 border-destructive text-destructive hover:bg-destructive/10'
              : 'min-h-11'
          }
          disabled={working}
        >
          {working ? 'Working…' : actionLabel}
        </Button>
      </div>
    </form>
  );
}

export function TrashDocumentRow({
  document,
  onRestore,
  disabled,
}: {
  document: TrashDocumentSummary;
  onRestore: () => void;
  disabled: boolean;
}) {
  return (
    <li className="min-w-0 border border-border bg-card p-4 rounded-2xl [overflow-wrap:anywhere]">
      <p className="font-medium">{document.title}</p>
      <div className="mt-1 text-sm text-muted-foreground">
        <p>Removed {new Date(document.deletedAt).toLocaleString()}</p>
        <p>Recovery until {new Date(document.restoreUntil).toLocaleString()}</p>
      </div>
      {document.canRestore ? (
        <Button
          type="button"
          variant="secondary"
          aria-label={`Restore ${document.title}`}
          className="mt-3 min-h-11"
          onClick={onRestore}
          disabled={disabled}
        >
          Restore
        </Button>
      ) : (
        <div className="mt-3 text-sm text-muted-foreground">
          <p>Recovery period ended</p>
          <p>The recovery deadline has passed.</p>
        </div>
      )}
    </li>
  );
}
