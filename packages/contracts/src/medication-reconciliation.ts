import { projectReviewedMedicationSources } from './medication-sources.js';
import type { MedicationSourceFence } from './medication-sources.js';
import { isMedicationCandidate } from './medication-review.js';
import type { MedicationCandidate } from './medication-fields.js';

export type MedicationSourceOption = {
  title: string;
  source: MedicationCandidate;
  binding: MedicationSourceBinding;
};
export type MedicationSourceOptions = {
  patientId: string;
  canWrite: true;
  options: MedicationSourceOption[];
  limited: boolean;
};

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
export type MedicationReconciliationView = {
  entry: MedicationReconciliationEntry;
  sourceState: 'current-source' | 'source-review-required';
};
export type MedicationReconciliationCursor = {
  recordedAt: string;
  medicationId: string;
};
export type MedicationReconciliationsPage = {
  patientId: string;
  canWrite: boolean;
  entries: MedicationReconciliationView[];
  nextCursor: MedicationReconciliationCursor | null;
};
export type MedicationReconciliationHistory = {
  current: MedicationReconciliationView;
  canWrite: boolean;
  history: MedicationReconciliationView[];
  nextBeforeRevision: number | null;
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
    return (
      code > 31 &&
      code !== 127 &&
      !(character.length === 1 && code >= 0xd800 && code <= 0xdfff)
    );
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
export function isMedicationSourceOptions(
  v: unknown,
): v is MedicationSourceOptions {
  if (
    !obj(v) ||
    !exact(v, ['patientId', 'canWrite', 'options', 'limited']) ||
    !uuid(v.patientId) ||
    v.canWrite !== true ||
    typeof v.limited !== 'boolean' ||
    !Array.isArray(v.options) ||
    v.options.length > 50
  )
    return false;
  const seen = new Set<string>();
  return v.options.every((option) => {
    if (
      !obj(option) ||
      !exact(option, ['title', 'source', 'binding']) ||
      typeof option.title !== 'string' ||
      option.title.length > 200 ||
      !option.title.trim() ||
      !isMedicationCandidate(option.source) ||
      !isMedicationSourceBinding(option.binding) ||
      option.source.id !== option.binding.candidateId
    )
      return false;
    const key = `${option.binding.documentId.toLowerCase()}/${option.source.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
export function isMedicationReconciliationCursor(
  v: unknown,
): v is MedicationReconciliationCursor {
  return (
    obj(v) &&
    exact(v, ['recordedAt', 'medicationId']) &&
    uuid(v.medicationId) &&
    typeof v.recordedAt === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.recordedAt) &&
    Number.isFinite(Date.parse(v.recordedAt)) &&
    new Date(v.recordedAt).toISOString() === v.recordedAt
  );
}
function view(v: unknown): v is MedicationReconciliationView {
  return (
    obj(v) &&
    exact(v, ['entry', 'sourceState']) &&
    isMedicationReconciliationEntry(v.entry) &&
    (v.sourceState === 'current-source' ||
      v.sourceState === 'source-review-required')
  );
}
export function isMedicationReconciliationsPage(
  v: unknown,
): v is MedicationReconciliationsPage {
  if (
    !obj(v) ||
    !exact(v, ['patientId', 'canWrite', 'entries', 'nextCursor']) ||
    !uuid(v.patientId) ||
    typeof v.canWrite !== 'boolean' ||
    !Array.isArray(v.entries) ||
    v.entries.length > 20 ||
    !v.entries.every(view)
  )
    return false;
  const entries = v.entries as MedicationReconciliationView[];
  if (
    new Set(entries.map((r) => r.entry.medicationId.toLowerCase())).size !==
      entries.length ||
    entries.some((r) => r.entry.patientId !== v.patientId)
  )
    return false;
  for (let i = 1; i < entries.length; i++) {
    const a = entries[i - 1]!.entry,
      b = entries[i]!.entry;
    if (
      a.recordedAt < b.recordedAt ||
      (a.recordedAt === b.recordedAt && a.medicationId <= b.medicationId)
    )
      return false;
  }
  const last = entries.at(-1)?.entry;
  return (
    v.nextCursor === null ||
    (entries.length === 20 &&
      isMedicationReconciliationCursor(v.nextCursor) &&
      last?.recordedAt === v.nextCursor.recordedAt &&
      last?.medicationId === v.nextCursor.medicationId)
  );
}
export function isMedicationReconciliationHistory(
  v: unknown,
): v is MedicationReconciliationHistory {
  if (
    !obj(v) ||
    !exact(v, ['current', 'canWrite', 'history', 'nextBeforeRevision']) ||
    !view(v.current) ||
    typeof v.canWrite !== 'boolean' ||
    !Array.isArray(v.history) ||
    v.history.length < 1 ||
    v.history.length > 20 ||
    !v.history.every(view)
  )
    return false;
  const currentView = v.current,
    current = currentView.entry,
    rows = v.history as MedicationReconciliationView[];
  if (
    rows.some(
      (r) =>
        r.entry.medicationId !== current.medicationId ||
        r.entry.patientId !== current.patientId ||
        r.entry.source.documentId !== current.source.documentId ||
        r.entry.revision > current.revision ||
        (r.entry.revision === current.revision &&
          (r.sourceState !== currentView.sourceState ||
            r.entry.recordedAt !== current.recordedAt ||
            r.entry.recordedStatus !== current.recordedStatus ||
            Object.keys(current.source).some(
              (k) =>
                r.entry.source[k as keyof MedicationSourceBinding] !==
                current.source[k as keyof MedicationSourceBinding],
            ) ||
            keys.some((k) => r.entry.fields[k] !== current.fields[k]))),
    )
  )
    return false;
  for (let i = 1; i < rows.length; i++)
    if (rows[i]!.entry.revision !== rows[i - 1]!.entry.revision - 1)
      return false;
  const last = rows.at(-1)!.entry.revision;
  return v.nextBeforeRevision === null
    ? last === 1
    : rows.length === 20 &&
        integer(v.nextBeforeRevision, 1) &&
        v.nextBeforeRevision === last - 1;
}
