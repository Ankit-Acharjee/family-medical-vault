import { isExtractionResult } from './extractions.js';
import type { ExtractionResult } from './extractions.js';
import type { LabFieldCandidate } from './lab-fields.js';
export const labFieldKeys = [
  'analyte',
  'result',
  'unit',
  'reference',
  'specimen',
  'method',
  'date',
  'laboratory',
] as const;
export type LabFieldKey = (typeof labFieldKeys)[number];
export type ReviewedLabFields = {
  analyte: string;
  result: string;
  unit: string | null;
  reference: string | null;
  specimen: string | null;
  method: string | null;
  date: string | null;
  laboratory: string | null;
};
export type ClinicalSelection = {
  candidateId: string;
  fields: ReviewedLabFields;
};
export type SaveClinicalReview = {
  requestId: string;
  expectedRevision: number;
  sourceRevision: number;
  sourceSha256: string;
  lifecycleVersion: number;
  confirmed: true;
  selections: ClinicalSelection[];
};
export type ClinicalReviewedItem = {
  source: LabFieldCandidate;
  fields: ReviewedLabFields;
};
export type WithdrawClinicalReview = {
  requestId: string;
  expectedRevision: number;
  sourceSha256: string;
  lifecycleVersion: number;
  confirmed: true;
  candidateIds: string[];
};
export type ClinicalReviewSnapshot = {
  action: 'confirmation' | 'withdrawal';
  withdrawnItems: ClinicalReviewedItem[];
  extraction: Omit<ExtractionResult, 'pages'>;
  revision: number;
  sourceRevision: number;
  sourceSha256: string;
  verifiedAt: string;
  ruleVersion: 'labeled-lab-blocks-v1';
  items: ClinicalReviewedItem[];
  /** True only when this set contains active confirmed entries. */
  verified: boolean;
};
export type ClinicalReviewResult = {
  context: {
    sourceRevision: number;
    sourceSha256: string;
    lifecycleVersion: number;
    revision: number;
    canVerify: boolean;
  };
  candidates: LabFieldCandidate[];
  snapshot: ClinicalReviewSnapshot | null;
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const int = (v: unknown, min = 0): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 2147483647;
const sha = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function text(v: unknown, max = 120): v is string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c === 0) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = v.charCodeAt(++i);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
export function isReviewedLabFields(v: unknown): v is ReviewedLabFields {
  return (
    record(v) &&
    exact(v, labFieldKeys) &&
    text(v.analyte) &&
    text(v.result) &&
    labFieldKeys.slice(2).every((k) => v[k] === null || text(v[k]))
  );
}
export function isLabFieldCandidate(v: unknown): v is LabFieldCandidate {
  if (
    !record(v) ||
    !exact(v, ['id', 'page', 'fields', 'unverified', 'confidence']) ||
    !text(v.id, 80) ||
    !/^page-[1-9][0-9]?-block-[0-9]{1,6}$/.test(v.id) ||
    !int(v.page, 1) ||
    v.page > 50 ||
    !v.id.startsWith(`page-${v.page}-block-`) ||
    v.unverified !== true ||
    v.confidence !== 'unrated' ||
    !record(v.fields) ||
    !exact(v.fields, labFieldKeys)
  )
    return false;
  const fields = v.fields;
  return labFieldKeys.every((k) => {
    const f = fields[k];
    if (f === null) return k !== 'analyte' && k !== 'result';
    return (
      record(f) &&
      exact(f, ['value', 'excerpt']) &&
      text(f.value) &&
      text(f.excerpt, 240) &&
      f.excerpt.includes(f.value)
    );
  });
}
export function isSaveClinicalReview(v: unknown): v is SaveClinicalReview {
  if (
    !record(v) ||
    !exact(v, [
      'requestId',
      'expectedRevision',
      'sourceRevision',
      'sourceSha256',
      'lifecycleVersion',
      'confirmed',
      'selections',
    ]) ||
    typeof v.requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v.requestId,
    ) ||
    !int(v.expectedRevision) ||
    !int(v.sourceRevision, 1) ||
    !sha(v.sourceSha256) ||
    !int(v.lifecycleVersion) ||
    v.confirmed !== true ||
    !Array.isArray(v.selections) ||
    v.selections.length < 1 ||
    v.selections.length > 20
  )
    return false;
  const seen = new Set<string>();
  return v.selections.every((s) => {
    if (
      !record(s) ||
      !exact(s, ['candidateId', 'fields']) ||
      !text(s.candidateId, 80) ||
      seen.has(s.candidateId) ||
      !isReviewedLabFields(s.fields)
    )
      return false;
    seen.add(s.candidateId);
    return true;
  });
}
export function isWithdrawClinicalReview(
  v: unknown,
): v is WithdrawClinicalReview {
  if (
    !record(v) ||
    !exact(v, [
      'requestId',
      'expectedRevision',
      'sourceSha256',
      'lifecycleVersion',
      'confirmed',
      'candidateIds',
    ]) ||
    typeof v.requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v.requestId,
    ) ||
    !int(v.expectedRevision, 1) ||
    !sha(v.sourceSha256) ||
    !int(v.lifecycleVersion) ||
    v.confirmed !== true ||
    !Array.isArray(v.candidateIds) ||
    v.candidateIds.length < 1 ||
    v.candidateIds.length > 20
  )
    return false;
  return (
    v.candidateIds.every(
      (id) => text(id, 80) && /^page-[1-9][0-9]?-block-[0-9]{1,6}$/.test(id),
    ) && new Set(v.candidateIds).size === v.candidateIds.length
  );
}
export function isClinicalReviewResult(v: unknown): v is ClinicalReviewResult {
  if (
    !record(v) ||
    !exact(v, ['context', 'candidates', 'snapshot']) ||
    !record(v.context) ||
    !exact(v.context, [
      'sourceRevision',
      'sourceSha256',
      'lifecycleVersion',
      'revision',
      'canVerify',
    ]) ||
    !int(v.context.sourceRevision) ||
    !sha(v.context.sourceSha256) ||
    !int(v.context.lifecycleVersion) ||
    !int(v.context.revision) ||
    typeof v.context.canVerify !== 'boolean' ||
    !Array.isArray(v.candidates) ||
    v.candidates.length > 20 ||
    !v.candidates.every(isLabFieldCandidate) ||
    new Set(v.candidates.map((c) => c.id)).size !== v.candidates.length
  )
    return false;
  if (v.snapshot === null) return v.context.revision === 0;
  const s = v.snapshot;
  if (
    !record(s) ||
    !exact(s, [
      'revision',
      'sourceRevision',
      'sourceSha256',
      'verifiedAt',
      'ruleVersion',
      'items',
      'verified',
      'extraction',
      'action',
      'withdrawnItems',
    ]) ||
    !int(s.revision, 1) ||
    s.revision !== v.context.revision ||
    !int(s.sourceRevision, 1) ||
    s.sourceRevision > v.context.sourceRevision ||
    s.sourceSha256 !== v.context.sourceSha256 ||
    s.ruleVersion !== 'labeled-lab-blocks-v1' ||
    s.verified !== (Array.isArray(s.items) && s.items.length > 0) ||
    typeof s.verifiedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s.verifiedAt) ||
    !Number.isFinite(Date.parse(s.verifiedAt)) ||
    new Date(s.verifiedAt).toISOString() !== s.verifiedAt ||
    !Array.isArray(s.items) ||
    !Array.isArray(s.withdrawnItems) ||
    s.items.length + s.withdrawnItems.length > 20 ||
    !(s.action === 'confirmation'
      ? s.items.length >= 1 && s.withdrawnItems.length === 0
      : s.action === 'withdrawal' && s.withdrawnItems.length >= 1)
  )
    return false;
  if (
    !record(s.extraction) ||
    !exact(s.extraction, [
      'method',
      'engineVersion',
      'partial',
      'partialReason',
      'downsized',
    ])
  )
    return false;
  const provenancePages = Array.from(
    { length: s.extraction.partialReason === 'pages' ? 50 : 1 },
    (_, index) => ({ page: index + 1, text: 'validation' }),
  );
  if (!isExtractionResult({ ...s.extraction, pages: provenancePages }))
    return false;
  return (
    [...s.items, ...s.withdrawnItems].every(
      (i) =>
        record(i) &&
        exact(i, ['source', 'fields']) &&
        isLabFieldCandidate(i.source) &&
        isReviewedLabFields(i.fields),
    ) &&
    new Set(
      [...s.items, ...s.withdrawnItems].map(
        (i) => (i as { source: LabFieldCandidate }).source.id,
      ),
    ).size ===
      s.items.length + s.withdrawnItems.length
  );
}
