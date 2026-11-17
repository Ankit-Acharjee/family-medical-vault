import { useEffect, useId, useRef, useState } from 'react';
import type {
  MeasurementComparisonResult,
  MeasurementSource,
} from '@fmv/contracts';
import { projectTrend } from './trendPlot';
import { MeasurementDetails } from './MeasurementDetails';
import { Button } from '../../components/ui/button';
export function ConfirmedTrend({
  result,
  sources,
  onDenied,
  onReload,
}: {
  result: MeasurementComparisonResult;
  sources: MeasurementSource[];
  onDenied: () => void;
  onReload: () => void;
}) {
  const plot = projectTrend(result),
    id = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const sourcePanel = useRef<HTMLHeadingElement>(null);
  const plotContainer = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(320);
  useEffect(() => {
    const node = plotContainer.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setPlotWidth(Math.max(160, Math.floor(width)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [result]);
  const left = 60,
    right = plotWidth - 20,
    span = right - left;
  if (!plot)
    return (
      <p role="alert" className="text-sm">
        These results cannot supply a supported chart. Close this view and
        refresh the comparison sources.
      </p>
    );
  const points = plot.points,
    domain = plot.domain;
  const key = (m: MeasurementComparisonResult['measurements'][number]) =>
    m.provenance.documentId + ':' + m.source.id;
  const active = result.measurements.find((m) => key(m) === selected);
  return (
    <section
      aria-label="Confirmed laboratory trend"
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-muted/30 p-4"
    >
      <div className="min-w-0">
        <h3 className="text-base font-semibold [overflow-wrap:anywhere]">
          {plot.analyte}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          Owner-confirmed comparison · {plot.unit}
        </p>
      </div>
      {domain && points.length >= 2 ? (
        <>
          <div ref={plotContainer} className="min-w-0">
            <div className="mb-2 flex flex-col gap-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              <p>
                Maximum: <span className="tabular-nums">{domain.maximum}</span>{' '}
                {plot.unit}
              </p>
              <p>
                Minimum: <span className="tabular-nums">{domain.minimum}</span>{' '}
                {plot.unit}
              </p>
            </div>
            <svg
              viewBox={`0 0 ${plotWidth} 220`}
              role="img"
              aria-labelledby={`${id}-title ${id}-description`}
              className="block h-[220px] w-full overflow-visible text-primary"
            >
              <title id={`${id}-title`}>{plot.analyte} by collection day</title>
              <desc id={`${id}-description`}>
                {points.length} exact numeric results from {domain.firstDay} to{' '}
                {domain.lastDay}. Values range from {domain.minimum} to{' '}
                {domain.maximum} {plot.unit}. Point numbers correspond to the
                values and source buttons below. Vertical scale spans the
                observed results; no clinical target or shared reference band is
                implied.
              </desc>
              <path
                d={`M${left} 12V192H${right}`}
                fill="none"
                stroke="var(--border)"
                strokeWidth="1.5"
              />
              {[12, 102, 192].map((y) => (
                <path
                  key={y}
                  d={`M${left} ${y}H${right}`}
                  fill="none"
                  stroke="var(--border)"
                  strokeDasharray="3 5"
                />
              ))}
              <text x="0" y="14" fill="var(--muted-foreground)" fontSize="11">
                {domain.maximum.length <= 8 ? domain.maximum : 'Max'}
              </text>
              <text x="0" y="196" fill="var(--muted-foreground)" fontSize="11">
                {domain.minimum.length <= 8 ? domain.minimum : 'Min'}
              </text>
              {points.map((p) => (
                <g key={key(p.measurement)}>
                  <circle
                    cx={left + p.x * span}
                    cy={12 + p.y * 180}
                    r="5"
                    fill="currentColor"
                  />
                  <text
                    x={left + p.x * span}
                    y={12 + p.y * 180 + (p.y < 0.15 ? 20 : -12)}
                    textAnchor="middle"
                    fill="var(--foreground)"
                    fontSize="12"
                  >
                    {p.number}
                  </text>
                </g>
              ))}
            </svg>
            <div className="flex justify-between gap-3 text-xs tabular-nums text-muted-foreground">
              <span>{domain.firstDay}</span>
              <span>{domain.lastDay}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Collection day · dots show observed results, without
              interpolation. Same-day results may overlap; use the exact values
              below. Plot positions are approximate; the displayed values remain
              exact.
            </p>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          At least two exact numeric results with exact collection days are
          needed to draw this chart. All confirmed results remain listed below.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Reference intervals stay with each source. No shared range, unit
        conversion, abnormality assessment or clinical interpretation is
        inferred.
      </p>
      <ol
        className="flex min-w-0 flex-col divide-y divide-border"
        aria-label="Exact values and source links"
      >
        {[
          ...points.map((p) => ({
            measurement: p.measurement,
            label: `Point ${p.number}`,
            reason: null,
          })),
          ...plot.excluded.map((e) => ({ ...e, label: 'Not plotted' })),
        ].map(({ measurement: m, label, reason }) => {
          const source = sources.find(
            (s) => s.documentId === m.provenance.documentId,
          );
          return (
            <li
              key={key(m)}
              className="flex min-w-0 flex-col gap-2 py-3 text-sm"
            >
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <p className="text-xs text-muted-foreground">
                    {label} · {m.fields.date ?? 'Collection date unknown'}
                  </p>
                  <p className="mt-1 font-semibold tabular-nums">
                    {m.fields.result}{' '}
                    <span className="font-normal">
                      {m.fields.unit ?? 'Unit unknown'}
                    </span>
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Reference as written: {m.fields.reference ?? 'Unknown'}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {source?.title ?? 'Source document'}
                  </p>
                  {reason && (
                    <p className="mt-1 text-muted-foreground">
                      Not plotted: {reason}.
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  aria-label={`View source for ${label.toLowerCase()}, ${m.fields.result}, ${m.fields.date ?? 'date unknown'}, ${source?.title ?? 'source document'}`}
                  onClick={() => {
                    setSelected(key(m));
                    window.requestAnimationFrame(() =>
                      sourcePanel.current?.focus(),
                    );
                  }}
                >
                  View source
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      {active && (
        <div className="min-w-0 rounded-lg border border-border bg-card p-3">
          <h4
            ref={sourcePanel}
            tabIndex={-1}
            className="font-medium [overflow-wrap:anywhere]"
          >
            Selected source · {active.fields.result} {active.fields.unit}
          </h4>
          <MeasurementDetails
            measurement={active}
            source={sources.find(
              (s) => s.documentId === active.provenance.documentId,
            )}
            enabled={true}
            onDenied={onDenied}
            onReload={onReload}
          />
        </div>
      )}
    </section>
  );
}
