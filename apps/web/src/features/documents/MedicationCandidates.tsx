import { extractMedicationFields } from '@fmv/contracts';
import type { MedicationCandidate, SavedExtraction } from '@fmv/contracts';
import { Button } from '../../components/ui/button';
const labels: Record<keyof MedicationCandidate['fields'], string> = {
  medication: 'Medication as written',
  strength: 'Strength as written',
  dose: 'Dose as written',
  frequency: 'Frequency as written',
  route: 'Route as written',
  duration: 'Duration as written',
  start: 'Start date as written',
  end: 'End date as written',
  instructions: 'Instructions as written',
};
const otherFields = [
  'route',
  'duration',
  'start',
  'end',
  'instructions',
] as const;
export function MedicationCandidates({
  snapshot,
  onShowSource,
}: {
  snapshot: SavedExtraction;
  onShowSource: (target: { page: number; excerpt: string }) => void;
}) {
  const candidates = extractMedicationFields(snapshot.pages, {
    truncatedFinalLine: snapshot.partialReason === 'characters',
  });
  const field = (
    candidate: MedicationCandidate,
    key: keyof MedicationCandidate['fields'],
  ) => {
    const evidence = candidate.fields[key];
    return (
      <div key={key} className="min-w-0 space-y-1">
        <dt className="text-sm font-medium">{labels[key]}</dt>
        <dd className="min-w-0 space-y-1">
          <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
            {evidence?.value ?? 'Not identified in this source block'}
          </p>
          {evidence && (
            <details>
              <summary className="min-h-11 cursor-pointer content-center rounded-sm text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
                Source · Page {candidate.page}
              </summary>
              <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {evidence.excerpt}
              </blockquote>
              <Button
                className="mt-2"
                variant="secondary"
                onClick={() =>
                  onShowSource({
                    page: candidate.page,
                    excerpt: evidence.excerpt,
                  })
                }
              >
                Show {labels[key].replace(' as written', '').toLowerCase()} in
                source
              </Button>
            </details>
          )}
        </dd>
      </div>
    );
  };
  return (
    <section
      aria-label="Medication source text"
      className="min-w-0 rounded-xl border border-border px-4 py-1"
    >
      <details className="min-w-0">
        <summary className="min-h-11 cursor-pointer content-center rounded-sm text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Medication and dose text · Unverified
        </summary>
        <div className="min-w-0 space-y-3 pb-3 pt-2">
          <p className="text-pretty text-sm text-muted-foreground">
            Proposed source fields only. Check every dose, strength and
            frequency against the original. No active regimen or schedule is
            created.
          </p>
          {snapshot.partial && (
            <p className="text-pretty text-sm text-muted-foreground">
              Based on partial text; other medicines or fields may be missing.
              Incomplete fields are not filled in.
            </p>
          )}
          {candidates.length === 20 && (
            <p className="text-pretty text-sm text-muted-foreground">
              Up to 20 source blocks are shown. Check the complete original for
              other statements.
            </p>
          )}
          {!candidates.length ? (
            <p
              role="status"
              className="text-pretty text-sm text-muted-foreground"
            >
              No explicitly labeled medication blocks found. The original and
              saved text remain available.
            </p>
          ) : (
            <ul className="min-w-0 divide-y divide-border">
              {candidates.map((candidate, i) => (
                <li
                  key={candidate.id}
                  className="min-w-0 space-y-3 py-3 first:pt-0"
                >
                  <h3 className="text-balance text-sm font-semibold">
                    Source block {i + 1} · Unverified · Page {candidate.page}
                  </h3>
                  <dl className="min-w-0 space-y-3">
                    {field(candidate, 'medication')}
                    {field(candidate, 'strength')}
                    {field(candidate, 'dose')}
                    {field(candidate, 'frequency')}
                  </dl>
                  {otherFields.some((key) => candidate.fields[key]) && (
                    <details>
                      <summary className="min-h-11 cursor-pointer content-center text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
                        Other source fields
                      </summary>
                      <dl className="min-w-0 space-y-3 pt-2">
                        {otherFields
                          .filter((key) => candidate.fields[key])
                          .map((key) => field(candidate, key))}
                      </dl>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </section>
  );
}
