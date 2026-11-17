import { useState, useRef } from 'react';
import { ShieldCheck, FileText } from 'lucide-react';
import { measurementKey } from '@fmv/contracts';
import type {
  MeasurementOption,
  PatientSummary,
  MeasurementComparisonResult,
} from '@fmv/contracts';
import { usePatientContext } from '../patients';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ResourceState } from '../../components/ui/resource-state';
import { useMeasurementWorkspace } from './useMeasurementWorkspace';
import { useComparisonAction } from './useComparisonAction';
import { ComparisonDialog } from './ComparisonDialog';
import { MeasurementDetails } from './MeasurementDetails';
import { ManualReadingsPanel } from '../manual-readings';
function compatibility(options: MeasurementOption[]) {
  const first = options[0]?.measurement.fields;
  if (!first) return '';
  if (
    options.some(
      (o) =>
        !o.measurement.fields.unit || o.measurement.fields.unit !== first.unit,
    )
  )
    return 'Units must be present and match exactly. Unit conversion is not supported.';
  if (options.some((o) => o.measurement.fields.analyte !== first.analyte))
    return 'Test names must match exactly. Analyte aliases are not inferred.';
  for (const field of ['specimen', 'method'] as const)
    if (
      new Set(
        options
          .map((o) => o.measurement.fields[field])
          .filter((v) => v !== null),
      ).size > 1
    )
      return `Known ${field} fields differ. These results cannot be combined here.`;
  return '';
}
export function TrendsPanel({
  onRequestPatient,
}: {
  onRequestPatient: () => void;
}) {
  const context = usePatientContext();
  const [retained, setRetained] = useState(context.selectedPatient);
  if (context.selectedPatient?.id !== retained?.id && context.selectedPatient)
    setRetained(context.selectedPatient);
  if (!context.loading && !context.selectedPatient && retained)
    setRetained(null);
  const patient =
    context.selectedPatient ?? (context.loading ? retained : null);
  return patient ? (
    <PatientMeasurements
      key={patient.id}
      patient={patient}
      enabled={!context.loading && context.selectedPatient?.id === patient.id}
      onDenied={context.clearSelection}
    />
  ) : context.loading ? (
    <p role="status">Checking patient access…</p>
  ) : (
    <ResourceState
      state="empty"
      title="Choose a patient"
      description="Select a patient to view owner-confirmed laboratory results and comparison sets."
      icon={<ShieldCheck aria-hidden="true" size={28} />}
      actionLabel="Select patient"
      onAction={onRequestPatient}
    />
  );
}
function PatientMeasurements({
  patient,
  enabled,
  onDenied,
}: {
  patient: PatientSummary;
  enabled: boolean;
  onDenied: () => void;
}) {
  const workspace = useMeasurementWorkspace(patient.id, enabled, onDenied),
    data = workspace.value;
  const [selected, setSelected] = useState<string[]>([]),
    [query, setQuery] = useState(''),
    [notice, setNotice] = useState(''),
    [target, setTarget] = useState<{ setId: string; revision: number } | null>(
      null,
    );
  const trigger = useRef<HTMLElement | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const ready = enabled && !!data;
  const manager = useComparisonAction(
    patient.id,
    ready,
    data,
    (message) => {
      setSelected([]);
      setTarget(null);
      setNotice(message);
      workspace.reload();
    },
    onDenied,
  );
  const choices =
    data?.measurements.filter((o) =>
      selected.includes(measurementKey(o.member)),
    ) ?? [];
  const conflict = compatibility(choices),
    multipleDocs = new Set(choices.map((o) => o.member.documentId)).size >= 2;
  const filtered =
    data?.measurements.filter((o) =>
      `${o.measurement.fields.analyte} ${o.title}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    ) ?? [];
  const restoreFocus = () => {
    (trigger.current?.isConnected &&
    !(trigger.current as HTMLButtonElement).disabled
      ? trigger.current
      : (heading.current ?? document.getElementById('page-title'))
    )?.focus();
  };
  function reconfirm(value: MeasurementComparisonResult) {
    manager.close();
    setTarget({ setId: value.setId, revision: value.revision });
    setSelected(
      (data?.measurements ?? [])
        .filter((o) =>
          value.members.some(
            (m) =>
              m.documentId === o.member.documentId &&
              m.candidateId === o.member.candidateId,
          ),
        )
        .map((o) => measurementKey(o.member)),
    );
    setNotice(
      'Review the current results before confirming again. Unavailable earlier results have not been substituted.',
    );
    heading.current?.focus();
  }
  return (
    <section
      aria-label={
        enabled
          ? `Measurements for ${patient.displayName}`
          : 'Checking measurement access'
      }
      className="flex min-w-0 flex-col gap-6"
    >
      {!enabled ? (
        <p role="status">Checking patient access…</p>
      ) : workspace.state.phase === 'failed' ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5">
          <p role="alert">Laboratory results could not be loaded.</p>
          <Button variant="outline" onClick={workspace.reload}>
            Try again
          </Button>
        </div>
      ) : !data ? (
        <p role="status">Loading verified results…</p>
      ) : (
        <>
          {notice && (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          )}
          <section
            aria-labelledby="comparison-sets-title"
            className="flex flex-col gap-3"
          >
            <div>
              <h2 id="comparison-sets-title" className="text-lg font-semibold">
                Saved comparisons
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Reports share a set only after the profile owner confirms
                comparability.
              </p>
            </div>
            {!data.comparisons.length ? (
              <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                No comparison sets are available.{' '}
                {data.canConfirm
                  ? 'Choose verified results below to review a new set.'
                  : 'The profile owner can confirm comparable reports.'}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {data.comparisons.map((s) => (
                  <li
                    key={s.setId}
                    className="flex min-w-0 flex-wrap items-center justify-between gap-3 p-4"
                  >
                    <div className="min-w-0">
                      <p className="font-medium [overflow-wrap:anywhere]">
                        {s.analyte ?? 'Comparison set'}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {s.status === 'current'
                          ? 'Owner confirmed'
                          : s.status === 'invalid'
                            ? 'Needs new confirmation'
                            : 'Withdrawn'}{' '}
                        · {s.memberCount} results
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={(e) => {
                        trigger.current = e.currentTarget;
                        manager.beginRead(s.setId);
                      }}
                    >
                      View comparison
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {data.comparisonsLimited && (
              <p className="text-sm text-muted-foreground">
                More comparison sets exist than this recent list can display.
              </p>
            )}
          </section>
          <section
            aria-labelledby="verified-results-title"
            className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2
                  id="verified-results-title"
                  ref={heading}
                  tabIndex={-1}
                  className="flex items-center gap-2 text-lg font-semibold"
                >
                  <ShieldCheck
                    className="size-5 text-primary"
                    aria-hidden="true"
                  />
                  Verified results
                </h2>
                <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                  Exact owner-reviewed values and source evidence. Results are
                  separate until comparability is explicitly confirmed.
                </p>
              </div>
              <Button variant="outline" onClick={workspace.reload}>
                Refresh results
              </Button>
            </div>
            {!data.measurements.length ? (
              <div className="flex flex-col items-start gap-3 py-4">
                <p className="text-sm">
                  No current verified laboratory results are available.
                </p>
                <p className="max-w-prose text-sm text-muted-foreground">
                  Review extracted lab fields in Documents first. Unverified,
                  withdrawn and changed sources do not enter this list.
                </p>
                <Button asChild variant="outline">
                  <a href="#documents">
                    <FileText className="size-4" aria-hidden="true" />
                    View documents
                  </a>
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="measurement-filter"
                    className="text-sm font-medium"
                  >
                    Find a result
                  </label>
                  <Input
                    id="measurement-filter"
                    type="search"
                    name="measurement-filter"
                    autoComplete="off"
                    placeholder="Test name or source document…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                {!filtered.length && (
                  <p role="status" className="text-sm text-muted-foreground">
                    No results match this filter. Try a different test name or
                    clear the filter.
                  </p>
                )}
                <ul className="divide-y divide-border">
                  {filtered.map((o) => {
                    const key = measurementKey(o.member),
                      checked = selected.includes(key),
                      m = o.measurement;
                    return (
                      <li key={key} className="min-w-0 py-4">
                        <div className="flex min-w-0 items-start gap-3">
                          {data.canConfirm && (
                            <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg focus-within:outline-2 focus-within:outline-ring">
                              <input
                                type="checkbox"
                                className="size-5 accent-primary"
                                aria-label={`Select ${m.fields.analyte}, ${m.fields.result} ${m.fields.unit ?? ''}, ${o.title}`}
                                checked={checked}
                                disabled={!checked && choices.length >= 20}
                                onChange={() =>
                                  setSelected((previous) => {
                                    const current = previous.filter((k) =>
                                      data.measurements.some(
                                        (row) =>
                                          measurementKey(row.member) === k,
                                      ),
                                    );
                                    return checked
                                      ? current.filter((k) => k !== key)
                                      : [...current, key];
                                  })
                                }
                              />
                            </label>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium [overflow-wrap:anywhere]">
                              {m.fields.analyte}
                            </p>
                            <p className="mt-1 text-xl font-semibold tabular-nums [overflow-wrap:anywhere]">
                              {m.fields.result}{' '}
                              <span className="text-sm font-normal text-muted-foreground">
                                {m.fields.unit ?? 'Unit unknown'}
                              </span>
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                              Collection date: {m.fields.date ?? 'Unknown'}
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                              {o.title}
                            </p>
                            <details className="mt-2">
                              <summary className="min-h-11 cursor-pointer content-center rounded-sm text-sm text-primary focus-visible:outline-2 focus-visible:outline-ring">
                                Source details
                              </summary>
                              <MeasurementDetails
                                measurement={m}
                                source={data.sources.find(
                                  (s) => s.documentId === o.member.documentId,
                                )}
                                enabled={ready}
                                onDenied={onDenied}
                                onReload={workspace.reload}
                              />
                            </details>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {data.measurementsLimited && (
                  <p className="text-sm text-muted-foreground">
                    This recent verified-result list is limited. Older or
                    otherwise unavailable results remain accessible through
                    their documents.
                  </p>
                )}
                {data.canConfirm ? (
                  <div className="flex flex-col gap-3 rounded-xl bg-muted p-4">
                    <p className="text-sm font-medium">
                      {choices.length} of 20 results selected
                      {target ? ' · updating an existing set' : ''}
                    </p>
                    {selected.length !== choices.length && (
                      <p role="status" className="text-sm">
                        Some selected sources changed. Review their current
                        results before continuing.
                      </p>
                    )}
                    {choices.length > 0 && !multipleDocs && (
                      <p className="text-sm text-muted-foreground">
                        Choose results from at least two documents.
                      </p>
                    )}
                    {conflict && (
                      <p role="alert" className="text-sm text-destructive">
                        {conflict}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-3">
                      <Button
                        disabled={
                          choices.length < 2 || !multipleDocs || !!conflict
                        }
                        onClick={(e) => {
                          trigger.current = e.currentTarget;
                          setNotice('');
                          manager.beginConfirm(choices, target);
                        }}
                      >
                        Review selection
                      </Button>
                      {(selected.length > 0 || target) && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setSelected([]);
                            setTarget(null);
                          }}
                        >
                          Clear selection
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Only the profile owner can confirm or withdraw
                    comparability. You can view results permitted by your
                    current access.
                  </p>
                )}
              </>
            )}
          </section>
        </>
      )}
      <ManualReadingsPanel patient={patient} enabled={enabled} />
      <ComparisonDialog
        manager={manager}
        workspace={data}
        enabled={ready}
        onDenied={onDenied}
        onReload={workspace.reload}
        onReconfirm={reconfirm}
        restoreFocus={restoreFocus}
      />
    </section>
  );
}
