import { isOriginalExportSelection } from './original-export.js';
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
