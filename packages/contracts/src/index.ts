// Public API shapes never contain provider tokens or patient grants.
export type AuthBootstrap = { enabled: boolean; csrf: string | null };
export type AuthAccount = { email: string; contextId: string };
export type AuthNotice = { message: string };
export type AuthCredentials = { email: string; password: string };
export type OwnPerson = { id: string; displayName: string };
export type OwnPersonResult = { person: OwnPerson | null };

export const permissionActions = [
  'view',
  'upload',
  'edit',
  'export',
  'manage',
] as const;
export type PermissionAction = (typeof permissionActions)[number];
export type PermissionScope =
  | { kind: 'patient' }
  | { kind: 'category'; categoryId: string }
  | { kind: 'document'; documentId: string };
export type PatientCapability = {
  action: PermissionAction;
  scope: PermissionScope;
};
// Capabilities describe context only; every protected request checks current grants.
export type PatientSummary = {
  id: string;
  displayName: string;
  relationship: 'self' | 'caregiver';
  capabilities: PatientCapability[];
};
export type PatientsResult = { patients: PatientSummary[] };

export const documentMimeTypes = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type DocumentMimeType = (typeof documentMimeTypes)[number];
export const maximumDocumentBytes = 25 * 1024 * 1024;
export type DocumentSummary = {
  id: string;
  patientId: string;
  title: string;
  mimeType: DocumentMimeType;
  bytes: number;
  createdAt: string;
  categoryId: string;
  canView: boolean;
  canExport: boolean;
};
export type DocumentsResult = {
  documents: DocumentSummary[];
  storageReady: boolean;
};
export type DocumentCategory = { id: string; name: string };
export type UploadState = 'pending' | 'ready' | 'failed';
export type UploadResult = {
  uploadId: string;
  documentId: string;
  state: UploadState;
};
export type AccessProposal = {
  actions: PermissionAction[];
  scope: PermissionScope;
  expiresInHours: number;
};
export type AccessLinkResult = { id: string; token: string; expiresAt: string };
export type AccessGrantSummary = {
  id: string;
  recipientPersonId: string | null;
  recipientName: string | null;
  actions: PermissionAction[];
  scope: PermissionScope;
  expiresAt: string | null;
  revokedAt: string | null;
};
export type AccessInvitationSummary = {
  id: string;
  recipientPersonId: string | null;
  actions: PermissionAction[];
  scope: PermissionScope;
  expiresAt: string;
  state: 'pending' | 'claimed' | 'accepted' | 'revoked';
  recipientName: string | null;
};
export type FamilyAccessResult = {
  grants: AccessGrantSummary[];
  invitations: AccessInvitationSummary[];
};
export type BeginUpload = {
  title: string;
  mimeType: DocumentMimeType;
  bytes: number;
  sha256: string;
  idempotencyKey: string;
  categoryId?: string;
};
