import { documentMimeTypes } from '@fmv/contracts';
import type { DocumentMimeType, DocumentsResult } from '@fmv/contracts';

export type DocumentOpenRequest = {
  patientId: string;
  documentId: string;
  intent: 'preview' | 'locate';
};

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function isDocumentsResult(
  value: unknown,
  patientId: string,
): value is DocumentsResult {
  if (
    !object(value) ||
    typeof value.storageReady !== 'boolean' ||
    !Array.isArray(value.documents)
  )
    return false;
  const ids = new Set<string>();
  return value.documents.every((d: unknown) => {
    if (
      !object(d) ||
      typeof d.id !== 'string' ||
      !d.id ||
      ids.has(d.id) ||
      d.patientId !== patientId ||
      typeof d.title !== 'string' ||
      !d.title ||
      typeof d.mimeType !== 'string' ||
      !documentMimeTypes.includes(d.mimeType as DocumentMimeType) ||
      typeof d.bytes !== 'number' ||
      !Number.isSafeInteger(d.bytes) ||
      d.bytes <= 0 ||
      typeof d.createdAt !== 'string' ||
      Number.isNaN(Date.parse(d.createdAt)) ||
      typeof d.categoryId !== 'string' ||
      typeof d.canView !== 'boolean' ||
      typeof d.canExport !== 'boolean' ||
      (d.canEdit !== undefined && typeof d.canEdit !== 'boolean') ||
      (d.canManageConsent !== undefined &&
        typeof d.canManageConsent !== 'boolean') ||
      (d.originalTitle !== undefined && typeof d.originalTitle !== 'string') ||
      (d.categoryName !== undefined && typeof d.categoryName !== 'string')
    )
      return false;
    ids.add(d.id);
    return true;
  });
}
