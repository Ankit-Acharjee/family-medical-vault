import type { MetadataSuggestion, SavedExtraction } from '@fmv/contracts';
import { metadataSuggestionRuleVersion, suggestMetadata } from '@fmv/contracts';
import { MetadataCandidateList } from './MetadataCandidateList';
import { SavedMetadataPanel } from './SavedMetadataPanel';

const methodNames: Record<SavedExtraction['method'], string> = {
  'pdf-text': 'Embedded PDF text',
  'image-ocr': 'Image OCR',
  'pdf-page-ocr': 'Selected-page PDF OCR',
};

export function MetadataSuggestions({
  snapshot,
  patientId,
  documentId,
  onDenied,
  onReloadSource,
  onShowSource,
}: {
  snapshot: SavedExtraction;
  patientId: string;
  documentId: string;
  onDenied: () => void;
  onReloadSource: () => void;
  onShowSource: (suggestion: MetadataSuggestion) => void;
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
              Local suggestions derived on this device from the saved text. Save
              suggestions to keep a separate unverified snapshot. No document
              fields are applied or verified.
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
              <MetadataCandidateList
                suggestions={suggestions}
                onShowSource={onShowSource}
              />
            </>
          ) : (
            <p className="text-pretty text-sm text-muted-foreground">
              No clear metadata suggestions in this saved text.
            </p>
          )}
          <SavedMetadataPanel
            key={`${patientId}:${documentId}:${snapshot.revision}:${snapshot.sourceSha256}`}
            patientId={patientId}
            documentId={documentId}
            snapshot={snapshot}
            onDenied={onDenied}
            onReloadSource={onReloadSource}
            onShowSource={onShowSource}
          />
        </div>
      </details>
    </section>
  );
}
