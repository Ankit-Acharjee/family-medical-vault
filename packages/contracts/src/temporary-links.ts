import {
  isOriginalExportPreview,
  isOriginalExportSelection,
} from './original-export.js';
export type CreateTemporaryLink = {
  requestId: string;
  documentIds: string[];
  expiresInHours: number;
  selectionSha256: string;
  confirmed: true;
};
const uuid = (v: unknown) =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    v,
  );
export function isCreateTemporaryLink(v: unknown): v is CreateTemporaryLink {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    Object.keys(o).length === 5 &&
    [
      'requestId',
      'documentIds',
      'expiresInHours',
      'selectionSha256',
      'confirmed',
    ].every((k) => Object.hasOwn(o, k)) &&
    uuid(o.requestId) &&
    isOriginalExportSelection({ documentIds: o.documentIds }) &&
    Number.isInteger(o.expiresInHours) &&
    (o.expiresInHours as number) >= 1 &&
    (o.expiresInHours as number) <= 168 &&
    typeof o.selectionSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(o.selectionSha256) &&
    o.confirmed === true
  );
}
export type TemporaryLinkSummary = {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  state: 'active' | 'expired' | 'revoked' | 'source-invalid';
  documentIds: string[];
};

export const isTemporaryLinkToken = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const timestamp = (v: unknown): v is string =>
  typeof v === 'string' &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
export function isTemporaryLinkSummary(v: unknown): v is TemporaryLinkSummary {
  return (
    object(v) &&
    Object.keys(v).length === 6 &&
    uuid(v.id) &&
    timestamp(v.createdAt) &&
    timestamp(v.expiresAt) &&
    (v.revokedAt === null || timestamp(v.revokedAt)) &&
    ['active', 'expired', 'revoked', 'source-invalid'].includes(
      v.state as string,
    ) &&
    isOriginalExportSelection({ documentIds: v.documentIds })
  );
}
export type TemporaryLinksList = {
  patientId: string;
  links: TemporaryLinkSummary[];
  limited: boolean;
};
export function isTemporaryLinksList(v: unknown): v is TemporaryLinksList {
  return (
    object(v) &&
    Object.keys(v).length === 3 &&
    uuid(v.patientId) &&
    Array.isArray(v.links) &&
    v.links.length <= 50 &&
    v.links.every(isTemporaryLinkSummary) &&
    new Set(v.links.map((l) => l.id)).size === v.links.length &&
    typeof v.limited === 'boolean'
  );
}
export type TemporaryLinkCreated = {
  link: TemporaryLinkSummary;
  token: string | null;
  created: boolean;
};
export function isTemporaryLinkCreated(v: unknown): v is TemporaryLinkCreated {
  return (
    object(v) &&
    Object.keys(v).length === 3 &&
    isTemporaryLinkSummary(v.link) &&
    typeof v.created === 'boolean' &&
    (v.created ? isTemporaryLinkToken(v.token) : v.token === null)
  );
}
export type TemporaryRecipientSelection = {
  linkId: string;
  expiresAt: string;
  selection: import('./original-export.js').OriginalExportPreview;
};
export function isTemporaryRecipientSelection(
  v: unknown,
): v is TemporaryRecipientSelection {
  return (
    object(v) &&
    Object.keys(v).length === 3 &&
    uuid(v.linkId) &&
    timestamp(v.expiresAt) &&
    isOriginalExportPreview(v.selection)
  );
}

export type TemporaryLinkActivity = {
  patientId: string;
  linkId: string;
  events: {
    id: string;
    documentId: string | null;
    kind: 'link.opened' | 'original.accessed';
    recordedAt: string;
  }[];
  limited: boolean;
};
export function isTemporaryLinkActivity(
  v: unknown,
): v is TemporaryLinkActivity {
  return (
    object(v) &&
    Object.keys(v).length === 4 &&
    uuid(v.patientId) &&
    uuid(v.linkId) &&
    typeof v.limited === 'boolean' &&
    Array.isArray(v.events) &&
    v.events.length <= 20 &&
    new Set(v.events.map((e) => (object(e) ? e.id : null))).size ===
      v.events.length &&
    v.events.every(
      (e) =>
        object(e) &&
        Object.keys(e).length === 4 &&
        uuid(e.id) &&
        timestamp(e.recordedAt) &&
        ((e.kind === 'link.opened' && e.documentId === null) ||
          (e.kind === 'original.accessed' && uuid(e.documentId))),
    )
  );
}
