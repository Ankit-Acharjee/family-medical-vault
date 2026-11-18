import { classifyMeasurementDate } from './measurements.js';
import { isMeasurementWorkspace } from './measurement-workspace.js';
import type {
  MeasurementOption,
  MeasurementSource,
} from './measurement-workspace.js';
import { isManualReadingsPage } from './manual-readings.js';
import type { ManualReadingEntry } from './manual-readings.js';
import { isMedicationReconciliationsPage } from './medication-reconciliation.js';
import type { MedicationReconciliationView } from './medication-reconciliation.js';
export type SummaryPeriod = { fromDate: string; toDate: string };
export type SummaryScope = 'patient' | 'laboratory' | 'manual' | 'medication';
export type GroundedSummaryRequest = {
  scope: SummaryScope;
  period: SummaryPeriod | null;
};
export type GroundedSummary = {
  meaning: 'source-grounded-summary';
  patientId: string;
  generatedAt: string;
  scope: SummaryScope;
  period: SummaryPeriod | null;
  laboratory: {
    dated: MeasurementOption[];
    undated: MeasurementOption[];
    sources: MeasurementSource[];
  };
  manual: ManualReadingEntry[];
  medications: MedicationReconciliationView[];
  medicationMeaning: 'current-record-snapshot';
  coverage: {
    laboratoryLimited: boolean;
    manualLimited: boolean;
    medicationsLimited: boolean;
  };
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const scope = (v: unknown): v is SummaryScope =>
  ['patient', 'laboratory', 'manual', 'medication'].includes(v as string);
const instant = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
export function isSummaryPeriod(v: unknown): v is SummaryPeriod {
  return (
    object(v) &&
    exact(v, ['fromDate', 'toDate']) &&
    typeof v.fromDate === 'string' &&
    typeof v.toDate === 'string' &&
    classifyMeasurementDate(v.fromDate).kind === 'day' &&
    classifyMeasurementDate(v.toDate).kind === 'day' &&
    v.fromDate <= v.toDate
  );
}
export function isGroundedSummaryRequest(
  v: unknown,
): v is GroundedSummaryRequest {
  return (
    object(v) &&
    exact(v, ['scope', 'period']) &&
    scope(v.scope) &&
    (v.period === null || isSummaryPeriod(v.period))
  );
}
const within = (date: string, period: SummaryPeriod | null) =>
  !period || (date >= period.fromDate && date <= period.toDate);
/** Validated representation only: callers must independently enforce fresh aggregate/source authority. */
export function isGroundedSummary(v: unknown): v is GroundedSummary {
  if (
    !object(v) ||
    !exact(v, [
      'meaning',
      'patientId',
      'generatedAt',
      'scope',
      'period',
      'laboratory',
      'manual',
      'medications',
      'medicationMeaning',
      'coverage',
    ]) ||
    v.meaning !== 'source-grounded-summary' ||
    !instant(v.generatedAt) ||
    !isGroundedSummaryRequest({ scope: v.scope, period: v.period }) ||
    v.medicationMeaning !== 'current-record-snapshot' ||
    !object(v.laboratory) ||
    !exact(v.laboratory, ['dated', 'undated', 'sources']) ||
    !Array.isArray(v.laboratory.dated) ||
    !Array.isArray(v.laboratory.undated) ||
    !Array.isArray(v.laboratory.sources) ||
    !object(v.coverage) ||
    !exact(v.coverage, [
      'laboratoryLimited',
      'manualLimited',
      'medicationsLimited',
    ]) ||
    !Object.values(v.coverage).every((x) => typeof x === 'boolean')
  )
    return false;
  const measurements = [...v.laboratory.dated, ...v.laboratory.undated];
  if (
    !isMeasurementWorkspace({
      patientId: v.patientId,
      canConfirm: false,
      measurements,
      measurementsLimited: v.coverage.laboratoryLimited,
      comparisons: [],
      comparisonsLimited: false,
      sources: v.laboratory.sources,
    }) ||
    !isManualReadingsPage({
      patientId: v.patientId,
      canWrite: false,
      entries: v.manual,
      nextCursor: null,
    }) ||
    !isMedicationReconciliationsPage({
      patientId: v.patientId,
      canWrite: false,
      entries: v.medications,
      nextCursor: null,
    })
  )
    return false;
  const value = v as unknown as GroundedSummary;
  const docIds = new Set(
    measurements.map((m) => (m as MeasurementOption).member.documentId),
  );
  return (
    value.laboratory.sources.every((s) => docIds.has(s.documentId)) &&
    value.laboratory.dated.every(
      (o) =>
        o.measurement.collectionDate.kind === 'day' &&
        within(o.measurement.collectionDate.isoDate, value.period),
    ) &&
    value.laboratory.undated.every(
      (o) => o.measurement.collectionDate.kind !== 'day',
    ) &&
    value.manual.every(
      (r) =>
        r.action !== 'withdrawal' &&
        within(r.reading.observedAt.slice(0, 10), value.period),
    ) &&
    value.medications.every((r) => r.sourceState === 'current-source') &&
    (value.scope === 'patient' ||
      value.scope === 'laboratory' ||
      (measurements.length === 0 &&
        value.laboratory.sources.length === 0 &&
        !value.coverage.laboratoryLimited)) &&
    (value.scope === 'patient' ||
      value.scope === 'manual' ||
      (value.manual.length === 0 && !value.coverage.manualLimited)) &&
    (value.scope === 'patient' ||
      value.scope === 'medication' ||
      (value.medications.length === 0 && !value.coverage.medicationsLimited))
  );
}
/**
 * Pure bounded projection of already-authorized current read pages. No diagnosis,
 * interpretation, conversion, cross-report comparison, or treatment-period inference.
 * Input shapes and source fingerprints establish representation, never permission.
 */
export function projectGroundedSummary(input: {
  patientId: string;
  generatedAt: string;
  request: unknown;
  laboratory: unknown;
  manual: unknown;
  medications: unknown;
}): GroundedSummary | null {
  if (
    !isGroundedSummaryRequest(input.request) ||
    !instant(input.generatedAt) ||
    !isMeasurementWorkspace(input.laboratory) ||
    !isManualReadingsPage(input.manual) ||
    !isMedicationReconciliationsPage(input.medications) ||
    [input.laboratory, input.manual, input.medications].some(
      (p) => p.patientId !== input.patientId,
    )
  )
    return null;
  const { scope, period } = input.request;
  const labs = scope === 'patient' || scope === 'laboratory';
  const manual = scope === 'patient' || scope === 'manual';
  const meds = scope === 'patient' || scope === 'medication';
  const dated = labs
    ? input.laboratory.measurements.filter(
        (o) =>
          o.measurement.collectionDate.kind === 'day' &&
          within(o.measurement.collectionDate.isoDate, period),
      )
    : [];
  const undated = labs
    ? input.laboratory.measurements.filter(
        (o) => o.measurement.collectionDate.kind !== 'day',
      )
    : [];
  const included = new Set(
    [...dated, ...undated].map((o) => o.member.documentId),
  );
  const result: GroundedSummary = {
    meaning: 'source-grounded-summary',
    patientId: input.patientId,
    generatedAt: input.generatedAt,
    scope,
    period,
    laboratory: {
      dated,
      undated,
      sources: input.laboratory.sources.filter((s) =>
        included.has(s.documentId),
      ),
    },
    manual: manual
      ? input.manual.entries.filter(
          (r) =>
            r.action !== 'withdrawal' &&
            within(r.reading.observedAt.slice(0, 10), period),
        )
      : [],
    medications: meds
      ? input.medications.entries.filter(
          (r) => r.sourceState === 'current-source',
        )
      : [],
    medicationMeaning: 'current-record-snapshot',
    coverage: {
      laboratoryLimited: labs && input.laboratory.measurementsLimited,
      manualLimited: manual && input.manual.nextCursor !== null,
      medicationsLimited: meds && input.medications.nextCursor !== null,
    },
  };
  if (!isGroundedSummary(result)) return null;
  // Return independent JSON values: UI edits cannot mutate the authorized inputs.
  return JSON.parse(JSON.stringify(result)) as GroundedSummary;
}
