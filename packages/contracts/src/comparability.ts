import { isConfirmedMeasurement } from './measurements.js';
import type { ConfirmedMeasurement } from './measurements.js';

export type MeasurementComparisonMember = {
  documentId: string;
  candidateId: string;
  reviewRevision: number;
  sourceRevision: number;
  sourceSha256: string;
  lifecycleVersion: number;
};
export type ConfirmMeasurementComparison = {
  requestId: string;
  expectedRevision: number;
  confirmed: true;
  members: MeasurementComparisonMember[];
};
export type WithdrawMeasurementComparison = {
  requestId: string;
  expectedRevision: number;
  confirmed: true;
};
export type MeasurementComparisonResult = {
  setId: string;
  revision: number;
  status: 'missing' | 'current' | 'invalid' | 'withdrawn';
  canConfirm: boolean;
  members: MeasurementComparisonMember[];
  measurements: ConfirmedMeasurement[];
};
export type MeasurementComparisonWriteResult = {
  saved: true;
  revision: number;
};

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const integer = (v: unknown, min: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 2147483647;
export function isMeasurementComparisonMember(
  v: unknown,
): v is MeasurementComparisonMember {
  return (
    record(v) &&
    exact(v, [
      'documentId',
      'candidateId',
      'reviewRevision',
      'sourceRevision',
      'sourceSha256',
      'lifecycleVersion',
    ]) &&
    typeof v.documentId === 'string' &&
    v.documentId.length === 36 &&
    uuid.test(v.documentId) &&
    typeof v.candidateId === 'string' &&
    !/[\r\n]/.test(v.candidateId) &&
    /^page-[1-9][0-9]?-block-[0-9]{1,6}$/.exec(v.candidateId)?.[0] ===
      v.candidateId &&
    Number(v.candidateId.split('-')[1]) <= 50 &&
    integer(v.reviewRevision, 1) &&
    integer(v.sourceRevision, 1) &&
    integer(v.lifecycleVersion, 0) &&
    typeof v.sourceSha256 === 'string' &&
    v.sourceSha256.length === 64 &&
    /^[a-f0-9]{64}$/.test(v.sourceSha256)
  );
}
export function isMeasurementComparisonMembers(
  v: unknown,
): v is MeasurementComparisonMember[] {
  if (
    !Array.isArray(v) ||
    v.length < 2 ||
    v.length > 20 ||
    !v.every(isMeasurementComparisonMember)
  )
    return false;
  const docs = new Set(v.map((x) => x.documentId.toLowerCase()));
  const pairs = new Set(
    v.map((x) => `${x.documentId.toLowerCase()}:${x.candidateId}`),
  );
  return docs.size >= 2 && pairs.size === v.length;
}
export function isConfirmMeasurementComparison(
  v: unknown,
): v is ConfirmMeasurementComparison {
  return (
    record(v) &&
    exact(v, ['requestId', 'expectedRevision', 'confirmed', 'members']) &&
    typeof v.requestId === 'string' &&
    v.requestId.length === 36 &&
    uuid.test(v.requestId) &&
    integer(v.expectedRevision, 0) &&
    v.confirmed === true &&
    isMeasurementComparisonMembers(v.members)
  );
}
export function isWithdrawMeasurementComparison(
  v: unknown,
): v is WithdrawMeasurementComparison {
  return (
    record(v) &&
    exact(v, ['requestId', 'expectedRevision', 'confirmed']) &&
    typeof v.requestId === 'string' &&
    v.requestId.length === 36 &&
    uuid.test(v.requestId) &&
    integer(v.expectedRevision, 0) &&
    v.confirmed === true
  );
}
export function canonicalComparisonMembers(
  members: MeasurementComparisonMember[],
): MeasurementComparisonMember[] {
  return members
    .map((m) => ({
      documentId: m.documentId.toLowerCase(),
      candidateId: m.candidateId,
      reviewRevision: m.reviewRevision,
      sourceRevision: m.sourceRevision,
      sourceSha256: m.sourceSha256,
      lifecycleVersion: m.lifecycleVersion,
    }))
    .sort(
      (a, b) =>
        a.documentId.localeCompare(b.documentId) ||
        a.candidateId.localeCompare(b.candidateId),
    );
}

export function isMeasurementComparisonResult(
  v: unknown,
): v is MeasurementComparisonResult {
  if (
    !record(v) ||
    !exact(v, [
      'setId',
      'revision',
      'status',
      'canConfirm',
      'members',
      'measurements',
    ]) ||
    typeof v.setId !== 'string' ||
    v.setId.length !== 36 ||
    !uuid.test(v.setId) ||
    !integer(v.revision, 0) ||
    typeof v.canConfirm !== 'boolean' ||
    !Array.isArray(v.measurements)
  )
    return false;
  if (v.status === 'missing')
    return (
      v.revision === 0 &&
      Array.isArray(v.members) &&
      v.members.length === 0 &&
      v.measurements.length === 0 &&
      v.canConfirm
    );
  if (
    !['current', 'invalid', 'withdrawn'].includes(v.status as string) ||
    v.revision === 0 ||
    !isMeasurementComparisonMembers(v.members)
  )
    return false;
  if (v.status !== 'current') return v.measurements.length === 0;
  return (
    v.measurements.length === v.members.length &&
    v.measurements.every((m: unknown, i: number) => {
      if (!isConfirmedMeasurement(m)) return false;
      const r = (v.members as MeasurementComparisonMember[])[i]!;
      const p = m.provenance;
      return (
        p.patientId ===
          (v.measurements as ConfirmedMeasurement[])[0]!.provenance.patientId &&
        p.documentId.toLowerCase() === r.documentId.toLowerCase() &&
        m.source.id === r.candidateId &&
        p.reviewRevision === r.reviewRevision &&
        p.sourceRevision === r.sourceRevision &&
        p.sourceSha256 === r.sourceSha256 &&
        p.lifecycleVersion === r.lifecycleVersion
      );
    })
  );
}
