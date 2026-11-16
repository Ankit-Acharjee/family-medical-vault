import { isMetadataSuggestion } from './metadata.js';
import type { MetadataSuggestion } from './metadata-rules.js';

export type RelatedDocumentContext = {
  documentId: string;
  sourceSha256: string;
  sourceRevision: number;
  metadataRevision: number;
  lifecycleVersion: number;
};
export type RelatedDocumentEvidence = {
  sourceProvider: MetadataSuggestion;
  sourceDate: MetadataSuggestion;
  candidateProvider: MetadataSuggestion;
  candidateDate: MetadataSuggestion;
};
export type RelatedDocumentsResult = {
  source: RelatedDocumentContext;
  status: 'ready' | 'insufficient-hints';
  matches: (RelatedDocumentContext & {
    title: string;
    evidence: RelatedDocumentEvidence;
  })[];
  limited: boolean;
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha = /^[a-f0-9]{64}$/;
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, k: string[]) =>
  Object.keys(v).length === k.length && k.every((key) => Object.hasOwn(v, key));
const integer = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2147483647;
const contextKeys = [
  'documentId',
  'sourceSha256',
  'sourceRevision',
  'metadataRevision',
  'lifecycleVersion',
];
function context(v: Record<string, unknown>) {
  return (
    typeof v.documentId === 'string' &&
    uuid.test(v.documentId) &&
    typeof v.sourceSha256 === 'string' &&
    sha.test(v.sourceSha256) &&
    integer(v.sourceRevision) &&
    integer(v.metadataRevision) &&
    integer(v.lifecycleVersion)
  );
}
function validUnicode(value: string) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = value.charCodeAt(++i);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
export function isRelatedIsoDate(v: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m || +m[1]! < 1000) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === v;
}
export function isRelatedDocumentsResult(
  value: unknown,
): value is RelatedDocumentsResult {
  if (
    !obj(value) ||
    !keys(value, ['source', 'status', 'matches', 'limited']) ||
    !obj(value.source) ||
    !keys(value.source, contextKeys) ||
    !context(value.source) ||
    (value.status !== 'ready' && value.status !== 'insufficient-hints') ||
    typeof value.limited !== 'boolean' ||
    !Array.isArray(value.matches) ||
    value.matches.length > 20 ||
    (value.status === 'insufficient-hints' &&
      (value.matches.length !== 0 || value.limited))
  )
    return false;
  const source = value.source;
  if (
    value.status === 'ready' &&
    (Number(source.sourceRevision) < 1 || Number(source.metadataRevision) < 1)
  )
    return false;
  const ids = new Set<string>();
  return value.matches.every((m: unknown) => {
    if (
      !obj(m) ||
      !keys(m, [...contextKeys, 'title', 'evidence']) ||
      !context(m) ||
      (typeof m.documentId === 'string' &&
        m.documentId.toLowerCase() ===
          String(source.documentId).toLowerCase()) ||
      typeof m.documentId !== 'string' ||
      ids.has(m.documentId.toLowerCase()) ||
      typeof m.title !== 'string' ||
      !m.title.trim() ||
      m.title.length > 200 ||
      !validUnicode(m.title) ||
      !obj(m.evidence) ||
      !keys(m.evidence, [
        'sourceProvider',
        'sourceDate',
        'candidateProvider',
        'candidateDate',
      ])
    )
      return false;
    ids.add(m.documentId.toLowerCase());
    const {
      sourceProvider: sp,
      sourceDate: sd,
      candidateProvider: cp,
      candidateDate: cd,
    } = m.evidence;
    if (
      !isMetadataSuggestion(sp) ||
      !isMetadataSuggestion(sd) ||
      !isMetadataSuggestion(cp) ||
      !isMetadataSuggestion(cd)
    )
      return false;
    return (
      sp.kind === 'provider' &&
      cp.kind === 'provider' &&
      sd.kind === 'date' &&
      cd.kind === 'date' &&
      [sp, sd, cp, cd].every((s) => s.confidence === 'explicit') &&
      sp.value === cp.value &&
      sd.value === cd.value &&
      sd.dateRole === cd.dateRole &&
      isRelatedIsoDate(sd.value) &&
      Number(m.sourceRevision) > 0 &&
      Number(m.metadataRevision) > 0 &&
      Number(source.sourceRevision) > 0 &&
      Number(source.metadataRevision) > 0
    );
  });
}
