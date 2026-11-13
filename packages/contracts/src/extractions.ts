// Browser-submitted source text is always unverified, never clinical facts.
export type ExtractionMethod = 'pdf-text' | 'image-ocr' | 'pdf-page-ocr';
export const extractionEngineVersions: Record<ExtractionMethod, string> = {
  'pdf-text': 'pdfjs-6.5.438',
  'image-ocr': 'tesseract-7.0.0+eng-1.0.0',
  'pdf-page-ocr': 'pdfjs-6.5.438+tesseract-7.0.0+eng-1.0.0',
};
export const maximumExtractionRequestBytes = 4 * 1024 * 1024;
export type ExtractionResult = {
  method: ExtractionMethod;
  engineVersion: string;
  pages: { page: number; text: string }[];
  partial: boolean;
  partialReason: 'pages' | 'characters' | 'selected-page' | null;
  downsized: boolean;
};
export type ExtractionContext = {
  sourceSha256: string;
  lifecycleVersion: number;
  revision: number;
  canSave: boolean;
};
export type SavedExtraction = ExtractionResult & {
  revision: number;
  sourceSha256: string;
  savedAt: string;
  unverified: true;
};
export type ExtractionReadResult = {
  context: ExtractionContext;
  snapshot: SavedExtraction | null;
};
export type SaveExtraction = {
  requestId: string;
  expectedRevision: number;
  lifecycleVersion: number;
  sourceSha256: string;
  result: ExtractionResult;
};
export type SaveExtractionResult = { saved: true; revision: number };

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha = /^[a-f0-9]{64}$/;
const resultKeys = [
  'method',
  'engineVersion',
  'pages',
  'partial',
  'partialReason',
  'downsized',
];
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]) {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
function integer(value: unknown, min = 0): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= 2_147_483_647
  );
}
function safeText(value: string) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
export function isExtractionResult(value: unknown): value is ExtractionResult {
  if (!object(value) || !keys(value, resultKeys)) return false;
  if (
    value.method !== 'pdf-text' &&
    value.method !== 'image-ocr' &&
    value.method !== 'pdf-page-ocr'
  )
    return false;
  if (
    value.engineVersion !== extractionEngineVersions[value.method] ||
    typeof value.partial !== 'boolean' ||
    typeof value.downsized !== 'boolean'
  )
    return false;
  if (
    !Array.isArray(value.pages) ||
    value.pages.length < 1 ||
    value.pages.length > 50
  )
    return false;
  if (value.partial !== (value.partialReason !== null)) return false;
  if (value.method === 'pdf-text') {
    if (
      value.downsized ||
      ![null, 'pages', 'characters'].includes(value.partialReason as null)
    )
      return false;
    if (value.partialReason === 'pages' && value.pages.length !== 50)
      return false;
  } else {
    if (value.pages.length !== 1) return false;
    if (
      value.method === 'image-ocr' &&
      ![null, 'characters'].includes(value.partialReason as null)
    )
      return false;
    if (
      value.method === 'pdf-page-ocr' &&
      (!value.partial ||
        !['selected-page', 'characters'].includes(
          value.partialReason as string,
        ))
    )
      return false;
  }
  let total = 0,
    previous = 0,
    nonempty = false;
  for (const entry of value.pages) {
    if (
      !object(entry) ||
      !keys(entry, ['page', 'text']) ||
      !integer(entry.page, 1) ||
      entry.page > 50 ||
      entry.page <= previous ||
      typeof entry.text !== 'string'
    )
      return false;
    if (value.method === 'pdf-text' && entry.page !== previous + 1)
      return false;
    if (value.method === 'image-ocr' && entry.page !== 1) return false;
    previous = entry.page;
    total += entry.text.length;
    if (
      total > (value.method === 'pdf-text' ? 500_000 : 100_000) ||
      !safeText(entry.text)
    )
      return false;
    nonempty ||= entry.text.trim().length > 0;
  }
  return nonempty;
}
export function isExtractionContext(
  value: unknown,
): value is ExtractionContext {
  return (
    object(value) &&
    keys(value, ['sourceSha256', 'lifecycleVersion', 'revision', 'canSave']) &&
    typeof value.sourceSha256 === 'string' &&
    sha.test(value.sourceSha256) &&
    integer(value.lifecycleVersion) &&
    integer(value.revision) &&
    typeof value.canSave === 'boolean'
  );
}
export function isSaveExtraction(value: unknown): value is SaveExtraction {
  return (
    object(value) &&
    keys(value, [
      'requestId',
      'expectedRevision',
      'lifecycleVersion',
      'sourceSha256',
      'result',
    ]) &&
    typeof value.requestId === 'string' &&
    uuid.test(value.requestId) &&
    integer(value.expectedRevision) &&
    integer(value.lifecycleVersion) &&
    typeof value.sourceSha256 === 'string' &&
    sha.test(value.sourceSha256) &&
    isExtractionResult(value.result)
  );
}
export function isSaveExtractionResult(
  value: unknown,
): value is SaveExtractionResult {
  return (
    object(value) &&
    keys(value, ['saved', 'revision']) &&
    value.saved === true &&
    integer(value.revision, 1)
  );
}
export function isExtractionReadResult(
  value: unknown,
): value is ExtractionReadResult {
  if (
    !object(value) ||
    !keys(value, ['context', 'snapshot']) ||
    !isExtractionContext(value.context)
  )
    return false;
  if (value.snapshot === null) return value.context.revision === 0;
  const s = value.snapshot;
  if (
    !object(s) ||
    !keys(s, [
      ...resultKeys,
      'revision',
      'sourceSha256',
      'savedAt',
      'unverified',
    ])
  )
    return false;
  const { revision, sourceSha256, savedAt, unverified, ...result } = s;
  return (
    isExtractionResult(result) &&
    integer(revision, 1) &&
    revision === value.context.revision &&
    sourceSha256 === value.context.sourceSha256 &&
    typeof savedAt === 'string' &&
    /^\d{4}-\d\d-\d\dT/.test(savedAt) &&
    Number.isFinite(Date.parse(savedAt)) &&
    unverified === true
  );
}
