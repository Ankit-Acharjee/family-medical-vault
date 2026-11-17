import { isMeasurementComparisonResult } from '@fmv/contracts';
import type { ConfirmedMeasurement } from '@fmv/contracts';
export type TrendPoint = {
  measurement: ConfirmedMeasurement;
  x: number;
  y: number;
  number: number;
};
export type TrendExclusion = {
  measurement: ConfirmedMeasurement;
  reason: string;
};
export type TrendPlot = {
  analyte: string;
  unit: string;
  points: TrendPoint[];
  excluded: TrendExclusion[];
  domain: {
    firstDay: string;
    lastDay: string;
    minimum: string;
    maximum: string;
  } | null;
};
// Only layout coordinates are rounded (one million steps). Clinical values,
// ordering, endpoints and displayed representations never pass through Number.
function decimal(raw: string) {
  const negative = raw.startsWith('-'),
    unsigned = raw.replace(/^[+-]/, '');
  const [whole = '', fraction = ''] = unsigned.split('.');
  return {
    coefficient: BigInt((whole || '0') + fraction) * (negative ? -1n : 1n),
    scale: fraction.length,
  };
}
const ratio = (value: bigint, first: bigint, last: bigint) =>
  last === first
    ? 0.5
    : Number(((value - first) * 1000000n) / (last - first)) / 1000000;
/** Pure presentation projection, never an authorization or clinical validator. */
export function projectTrend(input: unknown): TrendPlot | null {
  if (!isMeasurementComparisonResult(input) || input.status !== 'current')
    return null;
  const first = input.measurements[0]!;
  const { analyte, unit } = first.fields;
  if (
    !unit ||
    input.measurements.some(
      (m) => m.fields.analyte !== analyte || m.fields.unit !== unit,
    )
  )
    return null;
  for (const key of ['method', 'specimen'] as const)
    if (
      new Set(
        input.measurements.map((m) => m.fields[key]).filter((v) => v !== null),
      ).size > 1
    )
      return null;
  const excluded: TrendExclusion[] = [],
    eligible: ConfirmedMeasurement[] = [];
  for (const measurement of input.measurements) {
    const reasons: string[] = [];
    if (measurement.result.kind === 'qualified')
      reasons.push('Qualified limit, not an exact numeric result');
    if (measurement.result.kind === 'text') reasons.push('Non-numeric result');
    if (measurement.collectionDate.kind !== 'day')
      reasons.push('Exact collection day unavailable');
    if (reasons.length)
      excluded.push({ measurement, reason: reasons.join(' · ') });
    else eligible.push(measurement);
  }
  eligible.sort(
    (a, b) =>
      a.fields.date!.localeCompare(b.fields.date!) ||
      a.provenance.documentId.localeCompare(b.provenance.documentId) ||
      a.source.id.localeCompare(b.source.id),
  );
  if (!eligible.length)
    return { analyte, unit, points: [], excluded, domain: null };
  const decimals = eligible.map((m) => decimal(m.fields.result));
  const scale = Math.max(...decimals.map((d) => d.scale));
  const values = decimals.map(
    (d) => d.coefficient * 10n ** BigInt(scale - d.scale),
  );
  let minIndex = 0,
    maxIndex = 0;
  values.forEach((v, i) => {
    if (v < values[minIndex]!) minIndex = i;
    if (v > values[maxIndex]!) maxIndex = i;
  });
  const days = eligible.map((m) =>
    BigInt(Date.parse(m.fields.date! + 'T00:00:00.000Z')),
  );
  return {
    analyte,
    unit,
    excluded,
    domain: {
      firstDay: eligible[0]!.fields.date!,
      lastDay: eligible.at(-1)!.fields.date!,
      minimum: eligible[minIndex]!.fields.result,
      maximum: eligible[maxIndex]!.fields.result,
    },
    points: eligible.map((measurement, i) => ({
      measurement,
      number: i + 1,
      x: ratio(days[i]!, days[0]!, days.at(-1)!),
      y: 1 - ratio(values[i]!, values[minIndex]!, values[maxIndex]!),
    })),
  };
}
