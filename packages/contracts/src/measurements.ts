import {
  isClinicalReviewResult,
  isReviewedLabFields,
  isLabFieldCandidate,
} from './clinical-review.js';
import type { ReviewedLabFields } from './clinical-review.js';
import type { LabFieldCandidate } from './lab-fields.js';

export type MeasurementResult =
  | { kind: 'numeric'; raw: string; decimal: string }
  | {
      kind: 'qualified';
      raw: string;
      operator: '<' | '<=' | '>' | '>=' | '≤' | '≥';
      decimal: string;
    }
  | { kind: 'text'; raw: string };

export type MeasurementDate =
  | { kind: 'day'; raw: string; isoDate: string }
  | { kind: 'unparsed'; raw: string }
  | { kind: 'unknown'; raw: null };

export type ConfirmedMeasurement = {
  fields: ReviewedLabFields;
  source: LabFieldCandidate;
  provenance: {
    patientId: string;
    documentId: string;
    reviewRevision: number;
    sourceRevision: number;
    sourceSha256: string;
    lifecycleVersion: number;
    verifiedAt: string;
  };
  result: MeasurementResult;
  collectionDate: MeasurementDate;
  comparability: { status: 'unconfirmed' };
};

/** Classify literal syntax only; no conversion or clinical interpretation. */
export function classifyMeasurementResult(raw: string): MeasurementResult {
  const match =
    /^(?:(<=|>=|<|>|≤|≥)[ \t]*)?([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))$/.exec(
      raw,
    );
  // JavaScript's $ can match before a final newline; require the entire string.
  if (!match || match[0] !== raw) return { kind: 'text', raw };
  const decimal = match[2]!;
  const operator = match[1] as '<' | '<=' | '>' | '>=' | '≤' | '≥' | undefined;
  return operator
    ? { kind: 'qualified', raw, operator, decimal }
    : { kind: 'numeric', raw, decimal };
}

/** Recognize only an exact, valid ISO calendar day without inferring precision. */
export function classifyMeasurementDate(raw: string | null): MeasurementDate {
  if (raw === null) return { kind: 'unknown', raw };
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(raw);
  if (!match || match[0] !== raw) return { kind: 'unparsed', raw };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1]!
  )
    return { kind: 'unparsed', raw };
  return { kind: 'day', raw, isoDate: raw };
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Project the active confirmed snapshot only. IDs and provenance are not
 * authorization: the caller must enforce current document View, lifecycle,
 * and source authority. The snapshot cannot independently prove lifecycle.
 * Cross-report comparability requires a separate owner confirmation.
 */
export function projectConfirmedMeasurements(
  patientId: string,
  documentId: string,
  review: unknown,
): ConfirmedMeasurement[] {
  if (
    typeof patientId !== 'string' ||
    typeof documentId !== 'string' ||
    patientId.length !== 36 ||
    documentId.length !== 36 ||
    !uuid.test(patientId) ||
    !uuid.test(documentId) ||
    !isClinicalReviewResult(review)
  )
    return [];
  const { context, snapshot } = review;
  if (
    !snapshot?.verified ||
    snapshot.sourceRevision !== context.sourceRevision ||
    snapshot.sourceSha256 !== context.sourceSha256
  )
    return [];

  return snapshot.items.map(({ fields, source }) => ({
    fields: { ...fields },
    source: {
      ...source,
      fields: {
        analyte: { ...source.fields.analyte },
        result: { ...source.fields.result },
        unit: source.fields.unit && { ...source.fields.unit },
        reference: source.fields.reference && { ...source.fields.reference },
        specimen: source.fields.specimen && { ...source.fields.specimen },
        method: source.fields.method && { ...source.fields.method },
        date: source.fields.date && { ...source.fields.date },
        laboratory: source.fields.laboratory && { ...source.fields.laboratory },
      },
    },
    provenance: {
      patientId,
      documentId,
      reviewRevision: snapshot.revision,
      sourceRevision: snapshot.sourceRevision,
      sourceSha256: snapshot.sourceSha256,
      lifecycleVersion: context.lifecycleVersion,
      verifiedAt: snapshot.verifiedAt,
    },
    result: classifyMeasurementResult(fields.result),
    collectionDate: classifyMeasurementDate(fields.date),
    comparability: { status: 'unconfirmed' },
  }));
}

/** A response shape check, never a substitute for current source authorization. */
export function isConfirmedMeasurement(
  value: unknown,
): value is ConfirmedMeasurement {
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  const exact = (v: Record<string, unknown>, keys: string[]) =>
    Object.keys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k));
  const integer = (v: unknown, min: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 2147483647;
  const id = (v: unknown) =>
    typeof v === 'string' && v.length === 36 && uuid.test(v);
  const equal = (v: unknown, expected: object) =>
    object(v) &&
    exact(v, Object.keys(expected)) &&
    Object.entries(expected).every(([k, x]) => v[k] === x);
  if (
    !object(value) ||
    !exact(value, [
      'fields',
      'source',
      'provenance',
      'result',
      'collectionDate',
      'comparability',
    ]) ||
    !isReviewedLabFields(value.fields) ||
    !isLabFieldCandidate(value.source) ||
    !object(value.provenance)
  )
    return false;
  const p = value.provenance;
  return (
    exact(p, [
      'patientId',
      'documentId',
      'reviewRevision',
      'sourceRevision',
      'sourceSha256',
      'lifecycleVersion',
      'verifiedAt',
    ]) &&
    id(p.patientId) &&
    id(p.documentId) &&
    integer(p.reviewRevision, 1) &&
    integer(p.sourceRevision, 1) &&
    integer(p.lifecycleVersion, 0) &&
    typeof p.sourceSha256 === 'string' &&
    p.sourceSha256.length === 64 &&
    /^[a-f0-9]{64}$/.test(p.sourceSha256) &&
    typeof p.verifiedAt === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.verifiedAt) &&
    Number.isFinite(Date.parse(p.verifiedAt)) &&
    new Date(p.verifiedAt).toISOString() === p.verifiedAt &&
    equal(value.result, classifyMeasurementResult(value.fields.result)) &&
    equal(value.collectionDate, classifyMeasurementDate(value.fields.date)) &&
    equal(value.comparability, { status: 'unconfirmed' })
  );
}
