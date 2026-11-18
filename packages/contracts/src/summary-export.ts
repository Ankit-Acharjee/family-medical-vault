import {
  isGroundedSummary,
  isGroundedSummaryRequest,
} from './grounded-summary.js';
import type { GroundedSummaryRequest } from './grounded-summary.js';
export const maximumSummaryExportBytes = 16 * 1024 * 1024;
export type SummaryExportRequest = {
  requestId: string;
  confirmed: true;
  format: 'zip';
  request: GroundedSummaryRequest;
  snapshotSha256: string;
};
export function isSummaryExportRequest(v: unknown): v is SummaryExportRequest {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    Object.keys(o).length === 5 &&
    ['requestId', 'confirmed', 'format', 'request', 'snapshotSha256'].every(
      (k) => Object.hasOwn(o, k),
    ) &&
    typeof o.requestId === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      o.requestId,
    ) &&
    o.confirmed === true &&
    o.format === 'zip' &&
    isGroundedSummaryRequest(o.request) &&
    typeof o.snapshotSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(o.snapshotSha256)
  );
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => [key, canonical(v)]),
    );
  return value;
}
/** Exact displayed snapshot selection; volatile generation time is not clinical provenance or authority. */
export function canonicalSummarySnapshot(value: unknown): string | null {
  if (!isGroundedSummary(value)) return null;
  const snapshot = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'generatedAt'),
  );
  return JSON.stringify(canonical(snapshot));
}
