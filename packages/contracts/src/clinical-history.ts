import { isClinicalReviewResult } from './clinical-review.js';
import type {
  ClinicalReviewResult,
  ClinicalReviewSnapshot,
} from './clinical-review.js';
export type ClinicalHistoryResult = {
  context: ClinicalReviewResult['context'];
  snapshot: ClinicalReviewSnapshot | null;
  nextBefore: number | null;
};
export function clinicalHistoryCursor(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,9}$/.test(value))
    return null;
  const n = Number(value);
  return Number.isInteger(n) && n <= 2147483647 ? n : null;
}
export function isClinicalHistoryResult(
  value: unknown,
): value is ClinicalHistoryResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).length !== 3 ||
    !('context' in v) ||
    !('snapshot' in v) ||
    !('nextBefore' in v)
  )
    return false;
  if (!v.context || typeof v.context !== 'object' || Array.isArray(v.context))
    return false;
  const c = v.context as Record<string, unknown>;
  // Validate the exact current context independently of the older set's revision.
  if (
    !isClinicalReviewResult({
      context: { ...c, revision: 0 },
      candidates: [],
      snapshot: null,
    }) ||
    typeof c.revision !== 'number' ||
    !Number.isInteger(c.revision) ||
    c.revision < 0 ||
    c.revision > 2147483647
  )
    return false;
  if (v.snapshot === null) return v.nextBefore === null;
  if (
    !v.snapshot ||
    typeof v.snapshot !== 'object' ||
    Array.isArray(v.snapshot)
  )
    return false;
  const s = v.snapshot as Record<string, unknown>;
  if (
    typeof s.revision !== 'number' ||
    typeof c.revision !== 'number' ||
    s.revision > c.revision ||
    !isClinicalReviewResult({
      context: { ...c, revision: s.revision },
      candidates: [],
      snapshot: s,
    })
  )
    return false;
  return (
    v.nextBefore === null || (v.nextBefore === s.revision && s.revision > 1)
  );
}
