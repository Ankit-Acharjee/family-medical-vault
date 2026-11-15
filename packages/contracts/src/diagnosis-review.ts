import { extractDiagnosisFields } from './diagnosis-fields.js';
import type { DiagnosisCandidate } from './diagnosis-fields.js';
import { isExtractionResult } from './extractions.js';
import type { ExtractionResult } from './extractions.js';
import type { ClinicalReviewResult } from './clinical-review.js';
export type DiagnosisReviewContext = ClinicalReviewResult['context'];
export type DiagnosisReviewSnapshot = {
  revision: number;
  sourceRevision: number;
  sourceSha256: string;
  confirmedAt: string;
  action: 'confirmation' | 'withdrawal';
  meaning: 'source-statement-only';
  ruleVersion: 'explicit-diagnosis-lines-v1';
  extraction: Omit<ExtractionResult, 'pages'>;
  statements: DiagnosisCandidate[];
  withdrawnStatements: DiagnosisCandidate[];
};
export type DiagnosisReviewResult = {
  context: DiagnosisReviewContext;
  candidates: DiagnosisCandidate[];
  snapshot: DiagnosisReviewSnapshot | null;
};
export type DiagnosisHistoryResult = {
  context: DiagnosisReviewContext;
  snapshot: DiagnosisReviewSnapshot | null;
  nextBefore: number | null;
};
export type SaveDiagnosisReview = {
  requestId: string;
  expectedRevision: number;
  sourceRevision: number;
  sourceSha256: string;
  lifecycleVersion: number;
  confirmed: true;
  meaning: 'source-statement-only';
  candidateIds: string[];
};
export type WithdrawDiagnosisReview = Omit<
  SaveDiagnosisReview,
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
export function isDiagnosisCandidate(v: unknown): v is DiagnosisCandidate {
  if (
    !record(v) ||
    !exact(v, ['id', 'page', 'field', 'confidence', 'unverified']) ||
    !integer(v.page, 1) ||
    v.page > 50 ||
    typeof v.id !== 'string' ||
    !new RegExp(`^page-${v.page}-diagnosis-(0|[1-9][0-9]{0,5})$`).test(v.id) ||
    v.unverified !== true ||
    v.confidence !== 'unrated' ||
    !record(v.field) ||
    !exact(v.field, ['value', 'excerpt']) ||
    typeof v.field.value !== 'string' ||
    typeof v.field.excerpt !== 'string'
  )
    return false;
  const parsed = extractDiagnosisFields([
    { page: v.page, text: v.field.excerpt },
  ]);
  return (
    parsed.length === 1 &&
    parsed[0]!.field.value === v.field.value &&
    parsed[0]!.field.excerpt === v.field.excerpt
  );
}
export function isSaveDiagnosisReview(v: unknown): v is SaveDiagnosisReview {
  return input(v, true);
}
export function isWithdrawDiagnosisReview(
  v: unknown,
): v is WithdrawDiagnosisReview {
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
    v.meaning === 'source-statement-only' &&
    Array.isArray(v.candidateIds) &&
    v.candidateIds.length >= 1 &&
    v.candidateIds.length <= 20 &&
    v.candidateIds.every(
      (id) =>
        typeof id === 'string' &&
        /^page-[1-9][0-9]?-diagnosis-(0|[1-9][0-9]{0,5})$/.test(id),
    ) &&
    new Set(v.candidateIds).size === v.candidateIds.length
  );
}
function context(v: unknown): v is DiagnosisReviewContext {
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
  c: DiagnosisReviewContext,
): v is DiagnosisReviewSnapshot {
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
    v.meaning !== 'source-statement-only' ||
    v.ruleVersion !== 'explicit-diagnosis-lines-v1' ||
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
    all.every(isDiagnosisCandidate) &&
    new Set(all.map((x) => (x as DiagnosisCandidate).id)).size === all.length
  );
}
export function isDiagnosisReviewResult(
  v: unknown,
): v is DiagnosisReviewResult {
  return (
    record(v) &&
    exact(v, ['context', 'candidates', 'snapshot']) &&
    context(v.context) &&
    Array.isArray(v.candidates) &&
    v.candidates.length <= 20 &&
    v.candidates.every(isDiagnosisCandidate) &&
    new Set(v.candidates.map((x) => x.id)).size === v.candidates.length &&
    (v.snapshot === null
      ? v.context.revision === 0
      : snapshot(v.snapshot, v.context) &&
        v.snapshot.revision === v.context.revision)
  );
}
export function isDiagnosisHistoryResult(
  v: unknown,
): v is DiagnosisHistoryResult {
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
