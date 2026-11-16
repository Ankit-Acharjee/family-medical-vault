import { documentMimeTypes, maximumDocumentBytes } from './index.js';
import type { DocumentMimeType } from './index.js';
import { isConfirmedMeasurement } from './measurements.js';
import type { ConfirmedMeasurement } from './measurements.js';
import { isMeasurementComparisonMember } from './comparability.js';
import type { MeasurementComparisonMember } from './comparability.js';
export type MeasurementOption = {
  member: MeasurementComparisonMember;
  title: string;
  measurement: ConfirmedMeasurement;
};
export type ComparisonSummary = {
  setId: string;
  revision: number;
  status: 'current' | 'invalid' | 'withdrawn';
  analyte: string | null;
  recordedAt: string;
  memberCount: number;
};
export type MeasurementSource = {
  documentId: string;
  title: string;
  bytes: number;
  mimeType: DocumentMimeType;
};
export type MeasurementWorkspace = {
  sources: MeasurementSource[];
  patientId: string;
  canConfirm: boolean;
  measurements: MeasurementOption[];
  measurementsLimited: boolean;
  comparisons: ComparisonSummary[];
  comparisonsLimited: boolean;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, ks: string[]) =>
  Object.keys(v).length === ks.length && ks.every((k) => Object.hasOwn(v, k));
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length === 36 &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= max &&
  !!v.trim() &&
  !v.includes('\0') &&
  Array.from(v).every((c) => {
    const n = c.codePointAt(0)!;
    return n < 0xd800 || n > 0xdfff;
  });
const positive = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 2147483647;
export function measurementMember(
  m: ConfirmedMeasurement,
): MeasurementComparisonMember {
  return {
    documentId: m.provenance.documentId,
    candidateId: m.source.id,
    reviewRevision: m.provenance.reviewRevision,
    sourceRevision: m.provenance.sourceRevision,
    sourceSha256: m.provenance.sourceSha256,
    lifecycleVersion: m.provenance.lifecycleVersion,
  };
}
export function measurementKey(m: MeasurementComparisonMember) {
  return JSON.stringify([
    m.documentId.toLowerCase(),
    m.candidateId,
    m.reviewRevision,
    m.sourceRevision,
    m.sourceSha256,
    m.lifecycleVersion,
  ]);
}
export function isMeasurementWorkspace(v: unknown): v is MeasurementWorkspace {
  if (
    !object(v) ||
    !exact(v, [
      'patientId',
      'canConfirm',
      'measurements',
      'measurementsLimited',
      'comparisons',
      'comparisonsLimited',
      'sources',
    ]) ||
    !Array.isArray(v.sources) ||
    v.sources.length > 250 ||
    !v.sources.every(
      (s: unknown) =>
        object(s) &&
        exact(s, ['documentId', 'title', 'bytes', 'mimeType']) &&
        uuid(s.documentId) &&
        text(s.title, 200) &&
        positive(s.bytes) &&
        s.bytes <= maximumDocumentBytes &&
        documentMimeTypes.includes(s.mimeType as DocumentMimeType),
    ) ||
    new Set(v.sources.map((s) => s.documentId.toLowerCase())).size !==
      v.sources.length ||
    !uuid(v.patientId) ||
    typeof v.canConfirm !== 'boolean' ||
    typeof v.measurementsLimited !== 'boolean' ||
    typeof v.comparisonsLimited !== 'boolean' ||
    !Array.isArray(v.measurements) ||
    v.measurements.length > 50 ||
    !Array.isArray(v.comparisons) ||
    v.comparisons.length > 10
  )
    return false;
  const sourceRows = v.sources as MeasurementSource[];
  const keys = new Set<string>(),
    sets = new Set<string>();
  return (
    v.measurements.every((o: unknown) => {
      if (
        !object(o) ||
        !exact(o, ['member', 'title', 'measurement']) ||
        !isMeasurementComparisonMember(o.member) ||
        !text(o.title, 200) ||
        !sourceRows.some(
          (s) =>
            s.documentId ===
              (o.member as MeasurementComparisonMember).documentId &&
            s.title === o.title,
        ) ||
        !isConfirmedMeasurement(o.measurement) ||
        o.measurement.provenance.patientId !== v.patientId ||
        measurementKey(o.member) !==
          measurementKey(measurementMember(o.measurement))
      )
        return false;
      const key = measurementKey(o.member);
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    }) &&
    v.comparisons.every((s: unknown) => {
      if (
        !object(s) ||
        !exact(s, [
          'setId',
          'revision',
          'status',
          'analyte',
          'recordedAt',
          'memberCount',
        ]) ||
        !uuid(s.setId) ||
        sets.has(s.setId.toLowerCase()) ||
        !positive(s.revision) ||
        !positive(s.memberCount) ||
        s.memberCount < 2 ||
        s.memberCount > 20 ||
        !['current', 'invalid', 'withdrawn'].includes(s.status as string) ||
        (s.status === 'current' ? !text(s.analyte, 120) : s.analyte !== null) ||
        typeof s.recordedAt !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s.recordedAt) ||
        !Number.isFinite(Date.parse(s.recordedAt)) ||
        new Date(s.recordedAt).toISOString() !== s.recordedAt
      )
        return false;
      sets.add(s.setId.toLowerCase());
      return true;
    })
  );
}
