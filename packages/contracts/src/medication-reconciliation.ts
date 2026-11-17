import { projectReviewedMedicationSources } from './medication-sources.js';
import type { MedicationSourceFence } from './medication-sources.js';

/** Owner-recorded literal fields. Null means unknown, never an inferred value. */
export type ReconciledMedicationFields = {
  medication: string;
  strength: string | null;
  dose: string | null;
  frequency: string | null;
  route: string | null;
  duration: string | null;
  start: string | null;
  end: string | null;
  instructions: string | null;
};
export type MedicationSourceBinding = {
  documentId: string;
  candidateId: string;
  sourceRevision: number;
  sourceSha256: string;
  lifecycleVersion: number;
  reviewRevision: number;
};
export type SaveMedicationReconciliation = {
  requestId: string;
  expectedRevision: number;
  confirmed: true;
  meaning: 'owner-recorded-medication-context';
  source: MedicationSourceBinding;
  recordedStatus: 'current' | 'historical';
  fields: ReconciledMedicationFields;
};
export type MedicationReconciliationEntry = {
  medicationId: string;
  patientId: string;
  revision: number;
  action: 'reconciliation' | 'correction';
  recordedAt: string;
  meaning: 'owner-recorded-medication-context';
  source: MedicationSourceBinding;
  recordedStatus: 'current' | 'historical';
  fields: ReconciledMedicationFields;
};
const keys = [
  'medication',
  'strength',
  'dose',
  'frequency',
  'route',
  'duration',
  'start',
  'end',
  'instructions',
] as const;
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(v).length === names.length &&
  names.every((k) => Object.hasOwn(v, k));
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length === 36 &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    v,
  );
const integer = (v: unknown, min: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 2147483647;
const literal = (v: unknown) =>
  typeof v === 'string' &&
  v.length <= 120 &&
  v.trim().length > 0 &&
  [...v].every((character) => {
    const code = character.charCodeAt(0);
    return code > 31 && code !== 127;
  });
export function isReconciledMedicationFields(
  v: unknown,
): v is ReconciledMedicationFields {
  return (
    obj(v) &&
    exact(v, keys) &&
    keys.every((k) => (k !== 'medication' && v[k] === null) || literal(v[k]))
  );
}
export function isMedicationSourceBinding(
  v: unknown,
): v is MedicationSourceBinding {
  if (
    !obj(v) ||
    !exact(v, [
      'documentId',
      'candidateId',
      'sourceRevision',
      'sourceSha256',
      'lifecycleVersion',
      'reviewRevision',
    ])
  )
    return false;
  const match =
    typeof v.candidateId === 'string' &&
    /^page-([1-9][0-9]?)-medication-(0|[1-9][0-9]{0,5})$/.exec(v.candidateId);
  return (
    uuid(v.documentId) &&
    !!match &&
    match[0] === v.candidateId &&
    Number(match[1]) <= 50 &&
    Number(match[2]) < 500000 &&
    integer(v.sourceRevision, 1) &&
    integer(v.reviewRevision, 1) &&
    integer(v.lifecycleVersion, 0) &&
    typeof v.sourceSha256 === 'string' &&
    v.sourceSha256.length === 64 &&
    /^[a-f0-9]{64}$/.test(v.sourceSha256)
  );
}
function content(v: Record<string, unknown>) {
  return (
    v.meaning === 'owner-recorded-medication-context' &&
    (v.recordedStatus === 'current' || v.recordedStatus === 'historical') &&
    isMedicationSourceBinding(v.source) &&
    isReconciledMedicationFields(v.fields)
  );
}
export function isSaveMedicationReconciliation(
  v: unknown,
): v is SaveMedicationReconciliation {
  return (
    obj(v) &&
    exact(v, [
      'requestId',
      'expectedRevision',
      'confirmed',
      'meaning',
      'source',
      'recordedStatus',
      'fields',
    ]) &&
    uuid(v.requestId) &&
    integer(v.expectedRevision, 0) &&
    v.expectedRevision < 2147483647 &&
    v.confirmed === true &&
    content(v)
  );
}
export function isMedicationReconciliationEntry(
  v: unknown,
): v is MedicationReconciliationEntry {
  return (
    obj(v) &&
    exact(v, [
      'medicationId',
      'patientId',
      'revision',
      'action',
      'recordedAt',
      'meaning',
      'source',
      'recordedStatus',
      'fields',
    ]) &&
    uuid(v.medicationId) &&
    uuid(v.patientId) &&
    integer(v.revision, 1) &&
    ((v.action === 'reconciliation' && v.revision === 1) ||
      (v.action === 'correction' && v.revision > 1)) &&
    typeof v.recordedAt === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.recordedAt) &&
    Number.isFinite(Date.parse(v.recordedAt)) &&
    new Date(v.recordedAt).toISOString() === v.recordedAt &&
    content(v)
  );
}
/** Pure freshness check only. Caller enforces current source View and availability.
 * Never changes owner-recorded status; false means review required, not stopped.
 */
export function medicationReconciliationSourceCurrent(
  entry: unknown,
  review: unknown,
  fence: MedicationSourceFence,
): boolean {
  if (!isMedicationReconciliationEntry(entry)) return false;
  const source = entry.source;
  return projectReviewedMedicationSources(
    entry.patientId,
    source.documentId,
    review,
    fence,
  ).some(
    (item) =>
      item.source.id === source.candidateId &&
      item.provenance.sourceRevision === source.sourceRevision &&
      item.provenance.sourceSha256 === source.sourceSha256 &&
      item.provenance.lifecycleVersion === source.lifecycleVersion &&
      item.provenance.reviewRevision === source.reviewRevision,
  );
}
