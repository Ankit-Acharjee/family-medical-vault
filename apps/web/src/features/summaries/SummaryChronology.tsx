import type { GroundedSummary } from '@fmv/contracts';
import { measurementKey } from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import { reportedChronology } from './reported-chronology';
import { SummaryLabRecord, SummaryManualRecord } from './SummaryObservation';
export function SummaryChronology({
  value,
  enabled,
  onDenied,
  onReload,
}: {
  value: GroundedSummary;
  enabled: boolean;
  onDenied: () => void;
  onReload: () => void;
}) {
  if (!enabled) return null;
  const chronology = reportedChronology(value);
  if (!chronology)
    return (
      <div className="space-y-3">
        <p role="alert">The dated view could not be assembled.</p>
        <Button variant="outline" onClick={onReload}>
          Reload summary
        </Button>
      </div>
    );
  const lab = (row: GroundedSummary['laboratory']['dated'][number]) => (
    <SummaryLabRecord
      key={measurementKey(row.member)}
      row={row}
      source={value.laboratory.sources.find(
        (s) => s.documentId === row.member.documentId,
      )}
      enabled={enabled}
      onDenied={onDenied}
      onReload={onReload}
    />
  );
  return (
    <section
      aria-label="Reported-date chronology"
      className="min-w-0 space-y-4 border-t border-border pt-4"
    >
      <div className="space-y-2">
        <h2 className="text-base font-semibold">
          Observations by reported date
        </h2>
        <p className="text-sm text-muted-foreground">
          Calendar grouping only; no encounter or comparability is inferred.
        </p>
      </div>
      {(value.coverage.laboratoryLimited || value.coverage.manualLimited) && (
        <p className="text-sm text-muted-foreground">
          Limited source window; older observations may be missing.
        </p>
      )}
      {chronology.days.length ? (
        <ol className="space-y-5">
          {chronology.days.map((day) => (
            <li
              key={day.date}
              className="min-w-0 border-l-2 border-border pl-3 sm:pl-4"
            >
              <h3 className="mb-3 text-sm font-semibold tabular-nums">
                <time dateTime={day.date}>{day.date}</time>
              </h3>
              <ul className="space-y-3">
                {day.observations.map((o) => (
                  <li key={o.key} className="min-w-0">
                    {o.kind === 'laboratory' ? (
                      lab(o.value)
                    ) : (
                      <SummaryManualRecord entry={o.value} />
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          No dated observations in the available window
          {value.period ? ' for this reported-date period' : ''}.
        </p>
      )}
      {(value.scope === 'patient' || value.scope === 'laboratory') && (
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">
            Unknown or imprecise collection dates
          </h3>
          <p className="text-sm text-muted-foreground">
            These source records are not assigned a calendar position.
          </p>
          {chronology.undated.length ? (
            chronology.undated.map(lab)
          ) : (
            <p className="text-sm text-muted-foreground">
              No undated results in the available window.
            </p>
          )}
        </div>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="min-h-11 cursor-pointer content-center rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
          How dates are arranged
        </summary>
        <p>
          Newest reported date first. A shared calendar day does not establish a
          common encounter, clinical sequence or comparable test series.
          Original units and source links remain separate; within-day order is
          not a clinical sequence.
        </p>
      </details>
      {(value.scope === 'patient' || value.scope === 'manual') && (
        <Button
          variant="outline"
          onClick={() => {
            window.location.hash = 'trends';
          }}
        >
          View readings and preserved history
        </Button>
      )}
    </section>
  );
}
