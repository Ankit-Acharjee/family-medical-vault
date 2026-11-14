import type { SavedExtraction } from '@fmv/contracts';
import {
  metadataSuggestionRuleVersion,
  suggestMetadata,
} from './metadataSuggestionRules';

const methodNames: Record<SavedExtraction['method'], string> = {
  'pdf-text': 'Embedded PDF text',
  'image-ocr': 'Image OCR',
  'pdf-page-ocr': 'Selected-page PDF OCR',
};

const fieldNames = {
  type: 'Document type',
  date: 'Date',
  provider: 'Provider',
  label: 'Label',
};

export function MetadataSuggestions({
  snapshot,
}: {
  snapshot: SavedExtraction;
}) {
  const suggestions = suggestMetadata(snapshot.pages, {
    truncatedFinalLine: snapshot.partialReason === 'characters',
  });

  return (
    <section
      aria-label="Suggested metadata"
      className="min-w-0 rounded-xl border border-border px-4 py-1"
    >
      <details className="min-w-0">
        <summary className="min-h-11 cursor-pointer content-center rounded-sm text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Suggested metadata · Unverified
        </summary>
        <div className="flex min-w-0 flex-col gap-3 pb-3 pt-2">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-pretty text-sm text-muted-foreground">
              Derived on this device from the saved text. Suggestions are not
              separately saved or applied to the document.
            </p>
            <p className="break-words text-sm text-muted-foreground">
              Saved text revision {snapshot.revision} ·{' '}
              {methodNames[snapshot.method]}
              {' · '}Rule version {metadataSuggestionRuleVersion}
            </p>
            {snapshot.partial && (
              <p className="text-pretty text-sm text-muted-foreground">
                Based on partial text only; other pages or content may be
                missing.
              </p>
            )}
          </div>
          {suggestions.length ? (
            <>
              <p className="text-pretty text-sm text-muted-foreground">
                Match strength describes the rule, not the accuracy of the
                source.
              </p>
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
                      </details>
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="text-pretty text-sm text-muted-foreground">
              No clear metadata suggestions in this saved text.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
