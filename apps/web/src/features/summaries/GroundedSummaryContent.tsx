import { Button } from '../../components/ui/button';
import type { GroundedSummary, MeasurementOption } from '@fmv/contracts';
import { measurementKey } from '@fmv/contracts';
import { MeasurementDetails } from '../measurements/MeasurementDetails';
import { ReadingSummary } from '../manual-readings/ReadingSummary';
import { MedicationSummary } from '../medications/MedicationSummary';
const sectionClass = 'min-w-0 space-y-3 border-t border-border pt-4';
export function GroundedSummaryContent({
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
  const lab = (row: MeasurementOption) => (
    <details
      key={measurementKey(row.member)}
      className="min-w-0 rounded-xl border border-border p-4"
    >
      <summary className="min-h-11 cursor-pointer rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-ring [overflow-wrap:anywhere]">
        <span className="font-semibold">{row.measurement.fields.analyte}</span>
        {' · '}
        {row.measurement.fields.result}{' '}
        {row.measurement.fields.unit ?? '(unit unknown)'}
        <span className="mt-1 block text-muted-foreground">
          Owner-confirmed ·{' '}
          {row.measurement.fields.date ?? 'Collection date unknown'} ·{' '}
          {row.title}
        </span>
      </summary>
      <MeasurementDetails
        measurement={row.measurement}
        source={value.laboratory.sources.find(
          (s) => s.documentId === row.member.documentId,
        )}
        enabled={enabled}
        onDenied={onDenied}
        onReload={onReload}
      />
    </details>
  );
  return (
    <div className="min-w-0 space-y-5 [overflow-wrap:anywhere]">
      <p className="text-xs text-muted-foreground">
        Generated: <time dateTime={value.generatedAt}>{value.generatedAt}</time>
        . Limited record window; not a complete medical history.
      </p>
      {value.period && (
        <p className="text-sm text-muted-foreground">
          Reported-date period: {value.period.fromDate} through{' '}
          {value.period.toDate}, inclusive. Unknown/imprecise laboratory dates
          are listed separately. Upload and verification dates are not
          substituted.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Unverified, withdrawn and source-invalid data is excluded. Missing
        fields remain unknown; an empty section does not establish absence.
      </p>
      {(value.scope === 'patient' || value.scope === 'laboratory') && (
        <section
          aria-label="Summary laboratory results"
          className={sectionClass}
        >
          <h2 className="text-base font-semibold">
            Owner-confirmed laboratory results
          </h2>
          {value.coverage.laboratoryLimited && (
            <p className="text-sm text-muted-foreground">
              More laboratory results are available beyond this source window.
              This section is incomplete.
            </p>
          )}
          {value.laboratory.dated.length ? (
            value.laboratory.dated.map(lab)
          ) : (
            <p className="text-sm text-muted-foreground">
              No dated results in the available window
              {value.period ? ' for this reported-date period' : ''}.
            </p>
          )}
          <h3 className="pt-2 text-sm font-semibold">
            Unknown or imprecise collection dates
          </h3>
          {value.laboratory.undated.length ? (
            value.laboratory.undated.map(lab)
          ) : (
            <p className="text-sm text-muted-foreground">
              No undated results in the available window.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Results remain separate; matching labels do not establish
            cross-report comparability. Expand a result for its source and
            original comparison.
          </p>
        </section>
      )}
      {(value.scope === 'patient' || value.scope === 'manual') && (
        <section
          aria-label="Summary user-reported readings"
          className={sectionClass}
        >
          <h2 className="text-base font-semibold">
            Manual / user-reported readings
          </h2>
          {value.coverage.manualLimited && (
            <p className="text-sm text-muted-foreground">
              More recorded readings exist beyond the latest 20-record window.
              Older readings may match this period.
            </p>
          )}
          {value.manual.length ? (
            <ul className="space-y-3">
              {value.manual.map((r) => (
                <li
                  key={r.readingId}
                  className="rounded-xl border border-border p-4"
                >
                  <ReadingSummary entry={r} />
                  <details className="mt-2 text-xs text-muted-foreground">
                    <summary className="min-h-11 cursor-pointer content-center rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
                      Reading reference
                    </summary>
                    <p>
                      {r.readingId} · revision {r.revision}
                    </p>
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No active user-reported readings in the available window
              {value.period ? ' for this reported-date period' : ''}.
            </p>
          )}
          <Button
            variant="outline"
            onClick={() => {
              window.location.hash = 'trends';
            }}
          >
            View readings and preserved history
          </Button>
        </section>
      )}
      {(value.scope === 'patient' || value.scope === 'medication') && (
        <section
          aria-label="Summary medication snapshot"
          className={sectionClass}
        >
          <h2 className="text-base font-semibold">
            Medication context · current record snapshot
          </h2>
          <p className="text-sm text-muted-foreground">
            Current/historical labels are recorded by the owner. This snapshot
            does not reconstruct treatment during the requested period or
            recommend starting or stopping medication.
          </p>
          {value.coverage.medicationsLimited && (
            <p className="text-sm text-muted-foreground">
              More medication records are available beyond the latest 20-record
              window. This section is incomplete.
            </p>
          )}
          {value.medications.length ? (
            <ul className="space-y-3">
              {value.medications.map((r) => (
                <li
                  key={r.entry.medicationId}
                  className="rounded-xl border border-border p-4"
                >
                  <MedicationSummary record={r} />
                  <details className="mt-3">
                    <summary className="min-h-11 cursor-pointer content-center rounded-sm text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
                      All recorded fields and provenance
                    </summary>
                    <div className="pt-3">
                      <MedicationSummary record={r} details />
                    </div>
                  </details>
                  <a
                    className="text-link mt-3 inline-flex min-h-11 items-center text-sm"
                    href={`/api/patients/${encodeURIComponent(value.patientId)}/documents/${encodeURIComponent(r.entry.source.documentId)}/preview`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open original source (new tab)
                    <span className="sr-only">
                      {' '}
                      for {r.entry.fields.medication}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No source-current medication records in the available window.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
