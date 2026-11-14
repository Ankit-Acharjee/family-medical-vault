import type { MetadataSuggestion } from '@fmv/contracts';
import { Button } from '../../components/ui/button';
const fieldNames = {
  type: 'Document type',
  date: 'Date',
  provider: 'Provider',
  label: 'Label',
};

export function MetadataCandidateList({
  suggestions,
  onShowSource,
}: {
  suggestions: MetadataSuggestion[];
  onShowSource?: ((suggestion: MetadataSuggestion) => void) | undefined;
}) {
  return (
    <dl className="flex min-w-0 flex-col gap-3">
      {suggestions.map((suggestion) => (
        <div
          key={`${suggestion.kind}:${suggestion.dateRole ?? ''}:${suggestion.value}:${suggestion.page}`}
          className="grid min-w-0 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3"
        >
          <dt className="text-sm font-medium text-foreground">
            {suggestion.kind === 'date'
              ? (suggestion.dateRole ?? fieldNames.date)
              : fieldNames[suggestion.kind]}
          </dt>
          <dd className="flex min-w-0 flex-col gap-1 text-sm">
            <p className="whitespace-pre-wrap break-words text-foreground">
              {suggestion.value}
            </p>
            <p className="text-muted-foreground">
              {suggestion.confidence === 'explicit'
                ? 'Explicit match'
                : 'Tentative match'}
            </p>
            <details className="min-w-0">
              <summary className="min-h-11 cursor-pointer content-center rounded-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                Source excerpt · Page {suggestion.page}
              </summary>
              <blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-foreground">
                {suggestion.excerpt}
              </blockquote>
              {onShowSource && (
                <Button
                  variant="secondary"
                  className="mt-2"
                  onClick={() => onShowSource(suggestion)}
                >
                  Show in source
                </Button>
              )}
            </details>
          </dd>
        </div>
      ))}
    </dl>
  );
}
