import type { ReactNode } from 'react';
import { extractDiagnosisFields } from '@fmv/contracts';
import type { SavedExtraction } from '@fmv/contracts';
import { Button } from '../../components/ui/button';

/** Source presentation; optional controlled selection never writes or infers facts. */
export function DiagnosisCandidates({
  snapshot,
  onShowSource,
  selected,
  onSelection,
  disabled,
  review,
  children,
  open,
  onOpenChange,
}: {
  snapshot: SavedExtraction;
  selected?: string[];
  onSelection?: ((ids: string[]) => void) | undefined;
  disabled?: boolean;
  review?: ReactNode;
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: ((open: boolean) => void) | undefined;
  onShowSource: (target: { page: number; excerpt: string }) => void;
}) {
  const candidates = extractDiagnosisFields(snapshot.pages, {
    truncatedFinalLine: snapshot.partialReason === 'characters',
  });
  return (
    <section
      aria-label="Diagnosis source text"
      className="min-w-0 rounded-xl border border-border px-4 py-1"
    >
      <details
        className="min-w-0"
        open={open}
        onToggle={(e) => onOpenChange?.(e.currentTarget.open)}
      >
        <summary className="min-h-11 cursor-pointer content-center rounded-sm text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Diagnosis text · Unverified
        </summary>
        <div className="min-w-0 space-y-3 pb-3 pt-2">
          <p className="text-pretty text-sm text-muted-foreground">
            Explicitly labeled source text, not confirmed diagnoses. Wording may
            describe uncertainty, negation, history or another person. Check the
            full original document.
          </p>
          {review}
          {snapshot.partial && (
            <p className="text-pretty text-sm text-muted-foreground">
              Based on partial text; other pages or statements may be missing.
            </p>
          )}
          {candidates.length === 20 && (
            <p className="text-pretty text-sm text-muted-foreground">
              Up to 20 excerpts are shown. Check the complete source for other
              statements.
            </p>
          )}
          {!candidates.length ? (
            <p
              role="status"
              className="text-pretty text-sm text-muted-foreground"
            >
              No explicitly labeled diagnosis text found. The original and saved
              text remain available.
            </p>
          ) : (
            <ul className="min-w-0 divide-y divide-border">
              {candidates.map((candidate) => (
                <li
                  key={candidate.id}
                  className="min-w-0 space-y-2 py-3 first:pt-0"
                >
                  {onSelection ? (
                    <label className="flex min-h-11 min-w-0 items-start gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        aria-label={`Select diagnosis source statement ${candidate.id}`}
                        className="mt-1 size-5 shrink-0 accent-primary"
                        disabled={disabled}
                        checked={selected?.includes(candidate.id) ?? false}
                        onChange={(e) =>
                          onSelection(
                            e.target.checked
                              ? [...(selected ?? []), candidate.id]
                              : (selected ?? []).filter(
                                  (id) => id !== candidate.id,
                                ),
                          )
                        }
                      />
                      <span className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                        {candidate.field.value}
                      </span>
                    </label>
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-sm font-medium [overflow-wrap:anywhere]">
                      {candidate.field.value}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    Unverified · Page {candidate.page}
                  </p>
                  <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    {candidate.field.excerpt}
                  </blockquote>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      onShowSource({
                        page: candidate.page,
                        excerpt: candidate.field.excerpt,
                      })
                    }
                  >
                    Show in source
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {children}
        </div>
      </details>
    </section>
  );
}
