import type { DocumentSummary } from '@fmv/contracts';
import { maximumOriginalExportFiles } from '@fmv/contracts';
export const formatFileSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / 1048576).toFixed(2)} MiB`;
export function OriginalSelection({
  documents,
  selected,
  disabled,
  onChange,
  legend = 'Originals available for export',
}: {
  documents: DocumentSummary[];
  selected: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
  legend?: string;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      {documents.map((d) => (
        <label
          key={d.id}
          className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm"
        >
          <input
            type="checkbox"
            data-focus-key={`original:${d.id}`}
            className="mt-1 size-5 shrink-0 accent-primary"
            checked={selected.includes(d.id)}
            disabled={
              !selected.includes(d.id) &&
              selected.length >= maximumOriginalExportFiles
            }
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, d.id]
                  : selected.filter((id) => id !== d.id),
              )
            }
          />
          <span className="min-w-0 break-words">
            {d.title}
            <span className="block text-xs text-muted-foreground">
              {formatFileSize(d.bytes)}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
