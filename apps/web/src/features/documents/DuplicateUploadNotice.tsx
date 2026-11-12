import { Files } from 'lucide-react';

export function DuplicateUploadNotice() {
  return (
    <div
      role="status"
      aria-label="Potential duplicate upload"
      className="flex items-start gap-2 rounded-xl border border-border bg-muted p-3 text-sm leading-relaxed text-muted-foreground"
    >
      <Files size={18} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 break-words text-foreground">
        An identical file is already available in this patient’s documents. All
        originals were kept.
      </span>
    </div>
  );
}
