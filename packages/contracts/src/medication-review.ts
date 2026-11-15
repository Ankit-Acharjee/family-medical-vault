import { extractMedicationFields } from './medication-fields.js';
import type { MedicationCandidate } from './medication-fields.js';
import { isExtractionResult } from './extractions.js';
import type { ExtractionResult } from './extractions.js';
import type { ClinicalReviewResult } from './clinical-review.js';
export type MedicationReviewContext = ClinicalReviewResult['context'];
export type MedicationReviewSnapshot = {
  revision: number;
  sourceRevision: number;
  sourceSha256: string;
  confirmedAt: string;
  action: 'confirmation' | 'withdrawal';
  meaning: 'source-fields-only';
  ruleVersion: 'labeled-medication-blocks-v1';
  extraction: Omit<ExtractionResult, 'pages'>;
  statements: MedicationCandidate[];
  withdrawnStatements: MedicationCandidate[];
};
export type MedicationReviewResult = {
  context: MedicationReviewContext;
  candidates: MedicationCandidate[];
  snapshot: MedicationReviewSnapshot | null;
};
export type MedicationHistoryResult = {
  context: MedicationReviewContext;
  snapshot: MedicationReviewSnapshot | null;
  nextBefore: number | null;
};
export type SaveMedicationReview = {
  requestId: string;
  expectedRevision: number;
  sourceRevision: number;
  sourceSha256: string;
  lifecycleVersion: number;
  confirmed: true;
  meaning: 'source-fields-only';
  candidateIds: string[];
};
export type WithdrawMedicationReview = Omit<
  SaveMedicationReview,
  'sourceRevision'
>;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const integer = (v: unknown, min = 0): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 2147483647;
const sha = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
function candidateId(value: string): boolean {
  const match = /^page-([1-9][0-9]?)-medication-(0|[1-9][0-9]{0,5})$/.exec(
    value,
  );
  return match !== null && Number(match[1]) <= 50 && Number(match[2]) < 500000;
}
export function isMedicationCandidate(v: unknown): v is MedicationCandidate {
  if (
    !record(v) ||
    !exact(v, ['id', 'page', 'fields', 'confidence', 'unverified']) ||
    !integer(v.page, 1) ||
    v.page > 50 ||
    typeof v.id !== 'string' ||
    !candidateId(v.id) ||
    !v.id.startsWith(`page-${v.page}-medication-`) ||
    v.unverified !== true ||
    v.confidence !== 'unrated' ||
    !record(v.fields) ||
    !exact(v.fields, medicationFieldNames)
  )
    return false;
  for (const name of medicationFieldNames) {
    const field = v.fields[name];
    if (field === null && name !== 'medication') continue;
    if (
      !record(field) ||
      !exact(field, ['value', 'excerpt']) ||
      typeof field.value !== 'string' ||
      typeof field.excerpt !== 'string' ||
      field.excerpt.includes('\n')
    )
      return false;
    // Validate each evidence line at EOF. Joining canonical fields with LF
    // would turn a literal trailing CR into CRLF and alter valid source text.
    const parsed = extractMedicationFields([
      {
        page: v.page,
        text:
          name === 'medication'
            ? field.excerpt
            : `Medication: validation\n${field.excerpt}`,
      },
    ]);
    const evidence =
      parsed[0]?.fields[name as keyof MedicationCandidate['fields']];
    if (
      parsed.length !== 1 ||
      !evidence ||
      evidence.value !== field.value ||
      evidence.excerpt !== field.excerpt
    )
      return false;
  }
  return true;
}

const medicationFieldNames = [
  'medication',
  'strength',
  'dose',
  'frequency',
  'route',
  'duration',
  'start',
  'end',
  'instructions',
];
/** Compare values explicitly: PostgreSQL JSONB does not retain object key order. */
export function medicationFieldsEqual(
  a: MedicationCandidate['fields'],
  b: unknown,
): boolean {
  if (!record(b) || !exact(b, medicationFieldNames)) return false;
  return medicationFieldNames.every((name) => {
    const left = a[name as keyof typeof a],
      right = b[name];
    return left === null
      ? right === null
      : record(right) &&
          exact(right, ['value', 'excerpt']) &&
          left.value === right.value &&
          left.excerpt === right.excerpt;
  });
}

export function isSaveMedicationReview(v: unknown): v is SaveMedicationReview {
  return input(v, true);
}
export function isWithdrawMedicationReview(
  v: unknown,
): v is WithdrawMedicationReview {
  return input(v, false);
}
function input(v: unknown, source: boolean): boolean {
  return (
    record(v) &&
    exact(v, [
      'requestId',
      'expectedRevision',
      'sourceSha256',
      'lifecycleVersion',
      'confirmed',
      'meaning',
      'candidateIds',
      ...(source ? ['sourceRevision'] : []),
    ]) &&
    uuid(v.requestId) &&
    integer(v.expectedRevision, source ? 0 : 1) &&
    (!source || integer(v.sourceRevision, 1)) &&
    sha(v.sourceSha256) &&
    integer(v.lifecycleVersion) &&
    v.confirmed === true &&
    v.meaning === 'source-fields-only' &&
    Array.isArray(v.candidateIds) &&
    v.candidateIds.length >= 1 &&
    v.candidateIds.length <= 20 &&
    v.candidateIds.every((id) => typeof id === 'string' && candidateId(id)) &&
    new Set(v.candidateIds).size === v.candidateIds.length
  );
}
function context(v: unknown): v is MedicationReviewContext {
  return (
    record(v) &&
    exact(v, [
      'sourceRevision',
      'sourceSha256',
      'lifecycleVersion',
      'revision',
      'canVerify',
    ]) &&
    integer(v.sourceRevision) &&
    sha(v.sourceSha256) &&
    integer(v.lifecycleVersion) &&
    integer(v.revision) &&
    typeof v.canVerify === 'boolean'
  );
}
function snapshot(
  v: unknown,
  c: MedicationReviewContext,
): v is MedicationReviewSnapshot {
  if (
    !record(v) ||
    !exact(v, [
      'revision',
      'sourceRevision',
      'sourceSha256',
      'confirmedAt',
      'action',
      'meaning',
      'ruleVersion',
      'extraction',
      'statements',
      'withdrawnStatements',
    ]) ||
    !integer(v.revision, 1) ||
    v.revision > c.revision ||
    !integer(v.sourceRevision, 1) ||
    v.sourceRevision > c.sourceRevision ||
    v.sourceSha256 !== c.sourceSha256 ||
    v.meaning !== 'source-fields-only' ||
    v.ruleVersion !== 'labeled-medication-blocks-v1' ||
    typeof v.confirmedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.confirmedAt) ||
    !Number.isFinite(Date.parse(v.confirmedAt)) ||
    new Date(v.confirmedAt).toISOString() !== v.confirmedAt ||
    !Array.isArray(v.statements) ||
    !Array.isArray(v.withdrawnStatements) ||
    v.statements.length + v.withdrawnStatements.length > 20 ||
    !(v.action === 'confirmation'
      ? v.statements.length >= 1 && v.withdrawnStatements.length === 0
      : v.action === 'withdrawal' && v.withdrawnStatements.length >= 1) ||
    !record(v.extraction) ||
    !exact(v.extraction, [
      'method',
      'engineVersion',
      'partial',
      'partialReason',
      'downsized',
    ])
  )
    return false;
  const pages = Array.from(
    { length: v.extraction.partialReason === 'pages' ? 50 : 1 },
    (_, i) => ({ page: i + 1, text: 'validation' }),
  );
  if (!isExtractionResult({ ...v.extraction, pages })) return false;
  const all = [...v.statements, ...v.withdrawnStatements];
  return (
    all.every(isMedicationCandidate) &&
    new Set(all.map((x) => (x as MedicationCandidate).id)).size === all.length
  );
}
export function isMedicationReviewResult(
  v: unknown,
): v is MedicationReviewResult {
  return (
    record(v) &&
    exact(v, ['context', 'candidates', 'snapshot']) &&
    context(v.context) &&
    Array.isArray(v.candidates) &&
    v.candidates.length <= 20 &&
    v.candidates.every(isMedicationCandidate) &&
    new Set(v.candidates.map((x) => x.id)).size === v.candidates.length &&
    (v.snapshot === null
      ? v.context.revision === 0
      : snapshot(v.snapshot, v.context) &&
        v.snapshot.revision === v.context.revision)
  );
}
export function isMedicationHistoryResult(
  v: unknown,
): v is MedicationHistoryResult {
  if (
    !record(v) ||
    !exact(v, ['context', 'snapshot', 'nextBefore']) ||
    !context(v.context)
  )
    return false;
  return v.snapshot === null
    ? v.nextBefore === null
    : snapshot(v.snapshot, v.context) &&
        (v.nextBefore === null ||
          (v.nextBefore === v.snapshot.revision && v.snapshot.revision > 1));
}
