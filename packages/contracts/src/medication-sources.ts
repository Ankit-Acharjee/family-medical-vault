import { isMedicationReviewResult } from './medication-review.js';
import type { MedicationCandidate } from './medication-fields.js';
/** Source metadata loaded by an authorized caller from current registry/ledgers. */
export type MedicationSourceFence = {
  sourceRevision: number;
  sourceSha256: string;
  lifecycleVersion: number;
  reviewRevision: number;
  reviewLifecycleVersion: number;
};
export type ReviewedMedicationSource = {
  source: MedicationCandidate;
  provenance: {
    patientId: string;
    documentId: string;
    sourceRevision: number;
    sourceSha256: string;
    lifecycleVersion: number;
    reviewRevision: number;
    confirmedAt: string;
  };
  meaning: 'source-fields-only';
  reconciliation: { status: 'unreconciled' };
};
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length === 36 &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    v,
  );
const integer = (v: unknown, min: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 2147483647;
function isFence(v: unknown): v is MedicationSourceFence {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const f = v as Record<string, unknown>,
    keys = [
      'sourceRevision',
      'sourceSha256',
      'lifecycleVersion',
      'reviewRevision',
      'reviewLifecycleVersion',
    ];
  return (
    Object.keys(f).length === keys.length &&
    keys.every((k) => Object.hasOwn(f, k)) &&
    integer(f.sourceRevision, 1) &&
    integer(f.reviewRevision, 1) &&
    integer(f.lifecycleVersion, 0) &&
    integer(f.reviewLifecycleVersion, 0) &&
    typeof f.sourceSha256 === 'string' &&
    f.sourceSha256.length === 64 &&
    /^[a-f0-9]{64}$/.test(f.sourceSha256)
  );
}
/**
 * Pure projection, not authorization or an active-regimen decision. The caller
 * must resolve current View, READY/non-Trash original and authoritative fence
 * from the database; matching client-supplied metadata cannot establish access.
 * Snapshot contracts omit their lifecycle version, so require it explicitly
 * from the review ledger rather than stamping an old review after Restore.
 */
export function projectReviewedMedicationSources(
  patientId: string,
  documentId: string,
  review: unknown,
  fence: unknown,
): ReviewedMedicationSource[] {
  if (
    !uuid(patientId) ||
    !uuid(documentId) ||
    !isFence(fence) ||
    !isMedicationReviewResult(review) ||
    !review.snapshot
  )
    return [];
  const { context, snapshot } = review;
  if (
    context.revision !== fence.reviewRevision ||
    snapshot.revision !== fence.reviewRevision ||
    context.sourceRevision !== fence.sourceRevision ||
    snapshot.sourceRevision !== fence.sourceRevision ||
    context.sourceSha256 !== fence.sourceSha256 ||
    snapshot.sourceSha256 !== fence.sourceSha256 ||
    context.lifecycleVersion !== fence.lifecycleVersion ||
    fence.reviewLifecycleVersion !== fence.lifecycleVersion
  )
    return [];
  return snapshot.statements.map((source) => ({
    source: {
      ...source,
      fields: {
        medication: { ...source.fields.medication },
        strength: source.fields.strength && { ...source.fields.strength },
        dose: source.fields.dose && { ...source.fields.dose },
        frequency: source.fields.frequency && { ...source.fields.frequency },
        route: source.fields.route && { ...source.fields.route },
        duration: source.fields.duration && { ...source.fields.duration },
        start: source.fields.start && { ...source.fields.start },
        end: source.fields.end && { ...source.fields.end },
        instructions: source.fields.instructions && {
          ...source.fields.instructions,
        },
      },
    },
    provenance: {
      patientId,
      documentId,
      sourceRevision: fence.sourceRevision,
      sourceSha256: fence.sourceSha256,
      lifecycleVersion: fence.lifecycleVersion,
      reviewRevision: fence.reviewRevision,
      confirmedAt: snapshot.confirmedAt,
    },
    meaning: 'source-fields-only',
    reconciliation: { status: 'unreconciled' },
  }));
}
