export const maximumDocumentSearchHits = 200;
export const maximumDocumentSearchQueryLength = 200;

export type DocumentSearchInput = {
  query: string;
  categoryId?: string;
  uploadedFrom?: string;
  uploadedBefore?: string;
};
export type DocumentSearchResult = {
  documentIds: string[];
  truncated: boolean;
};

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function safeText(value: string) {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit === 0) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
function instant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

export function isDocumentSearchInput(
  value: unknown,
): value is DocumentSearchInput {
  if (
    !object(value) ||
    !Object.hasOwn(value, 'query') ||
    Object.keys(value).some(
      (key) =>
        !['query', 'categoryId', 'uploadedFrom', 'uploadedBefore'].includes(
          key,
        ),
    ) ||
    typeof value.query !== 'string' ||
    value.query.trim().length < 1 ||
    value.query.trim().length > maximumDocumentSearchQueryLength ||
    !safeText(value.query)
  )
    return false;
  if (
    Object.hasOwn(value, 'categoryId') &&
    (typeof value.categoryId !== 'string' || !uuid.test(value.categoryId))
  )
    return false;
  for (const key of ['uploadedFrom', 'uploadedBefore']) {
    if (Object.hasOwn(value, key) && !instant(value[key])) return false;
  }
  return !(
    typeof value.uploadedFrom === 'string' &&
    typeof value.uploadedBefore === 'string' &&
    Date.parse(value.uploadedFrom) >= Date.parse(value.uploadedBefore)
  );
}

export function isDocumentSearchResult(
  value: unknown,
): value is DocumentSearchResult {
  return (
    object(value) &&
    Object.keys(value).length === 2 &&
    Object.hasOwn(value, 'documentIds') &&
    Object.hasOwn(value, 'truncated') &&
    typeof value.truncated === 'boolean' &&
    Array.isArray(value.documentIds) &&
    value.documentIds.length <= maximumDocumentSearchHits &&
    value.documentIds.every((id) => typeof id === 'string' && uuid.test(id)) &&
    new Set(value.documentIds.map((id: string) => id.toLowerCase())).size ===
      value.documentIds.length
  );
}
