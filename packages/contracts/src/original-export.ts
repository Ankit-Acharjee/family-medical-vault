import { documentMimeTypes } from './index.js';
export const maximumOriginalExportFiles = 20;
export const maximumOriginalExportContentBytes = 32 * 1024 * 1024;
export const maximumOriginalExportArchiveBytes = 34 * 1024 * 1024;
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    v,
  );
const sha = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export type OriginalExportSelection = { documentIds: string[] };
export type OriginalExportRequest = OriginalExportSelection & {
  requestId: string;
  confirmed: true;
  format: 'zip';
  snapshotSha256: string;
};
export type OriginalExportPreview = {
  patientId: string;
  patientName: string;
  snapshotSha256: string;
  files: {
    id: string;
    title: string;
    originalTitle: string;
    mimeType: (typeof documentMimeTypes)[number];
    bytes: number;
    sha256: string;
  }[];
};
function selection(v: Record<string, unknown>) {
  return (
    Array.isArray(v.documentIds) &&
    v.documentIds.length > 0 &&
    v.documentIds.length <= maximumOriginalExportFiles &&
    v.documentIds.every(uuid) &&
    new Set(v.documentIds.map((id) => id.toLowerCase())).size ===
      v.documentIds.length
  );
}
export function isOriginalExportSelection(
  v: unknown,
): v is OriginalExportSelection {
  return record(v) && Object.keys(v).length === 1 && selection(v);
}
export function isOriginalExportRequest(
  v: unknown,
): v is OriginalExportRequest {
  return (
    record(v) &&
    Object.keys(v).length === 5 &&
    ['documentIds', 'requestId', 'confirmed', 'format', 'snapshotSha256'].every(
      (k) => Object.hasOwn(v, k),
    ) &&
    selection(v) &&
    uuid(v.requestId) &&
    v.confirmed === true &&
    v.format === 'zip' &&
    sha(v.snapshotSha256)
  );
}
export function isOriginalExportPreview(
  v: unknown,
): v is OriginalExportPreview {
  if (
    !record(v) ||
    Object.keys(v).length !== 4 ||
    !uuid(v.patientId) ||
    typeof v.patientName !== 'string' ||
    v.patientName.length > 1000 ||
    !sha(v.snapshotSha256) ||
    !Array.isArray(v.files) ||
    v.files.length < 1 ||
    v.files.length > maximumOriginalExportFiles
  )
    return false;
  let total = 0;
  const ids = new Set<string>();
  for (const f of v.files) {
    if (
      !record(f) ||
      Object.keys(f).length !== 6 ||
      !uuid(f.id) ||
      ids.has(f.id.toLowerCase()) ||
      typeof f.title !== 'string' ||
      !f.title ||
      f.title.length > 4000 ||
      typeof f.originalTitle !== 'string' ||
      !f.originalTitle ||
      f.originalTitle.length > 4000 ||
      !documentMimeTypes.includes(
        f.mimeType as (typeof documentMimeTypes)[number],
      ) ||
      !Number.isSafeInteger(f.bytes) ||
      (f.bytes as number) < 1 ||
      (f.bytes as number) > 25 * 1024 * 1024 ||
      !sha(f.sha256)
    )
      return false;
    ids.add(f.id.toLowerCase());
    total += f.bytes as number;
  }
  return total <= maximumOriginalExportContentBytes;
}
