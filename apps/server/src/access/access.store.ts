import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { permissionActions } from '@fmv/contracts';
import type {
  PatientSummary,
  PermissionAction,
  PermissionScope,
} from '@fmv/contracts';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Principal } from '../identity/person.store.js';

export type StoredGrant = {
  id: string;
  patientId: string;
  granteeAccountId: string;
  actions: PermissionAction[];
  scope: PermissionScope;
  expiresAt: Date | null;
  revokedAt: Date | null;
};
export type AccessSnapshot = {
  accountId: string | null;
  patient: { id: string; displayName: string; ownerAccountId: string } | null;
  grants: StoredGrant[];
  now: Date;
};
export type DocumentAuthority = {
  id: string;
  patientId: string;
  categoryId: string;
  state: 'pending' | 'ready' | 'failed';
};
export abstract class AccessStore {
  abstract load(
    principal: Principal,
    patientId: string,
  ): Promise<AccessSnapshot>;
  abstract list(principal: Principal): Promise<PatientSummary[]>;
  abstract document(documentId: string): Promise<DocumentAuthority | null>;
  abstract category(categoryId: string): Promise<boolean>;
}

type GrantRow = Omit<StoredGrant, 'scope'> & {
  scopeKind: 'patient' | 'category' | 'document';
  categoryId: string | null;
  documentId: string | null;
};
function grant(row: GrantRow): StoredGrant {
  const scope: PermissionScope =
    row.scopeKind === 'patient'
      ? { kind: 'patient' }
      : row.scopeKind === 'category'
        ? { kind: 'category', categoryId: row.categoryId! }
        : { kind: 'document', documentId: row.documentId! };
  return {
    id: row.id,
    patientId: row.patientId,
    granteeAccountId: row.granteeAccountId,
    actions: row.actions,
    scope,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

export class PrismaAccessStore extends AccessStore implements OnModuleDestroy {
  private readonly db: PrismaClient;
  constructor(url: string) {
    super();
    this.db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: url,
        options: '-c timezone=UTC',
        max: 3,
        connectionTimeoutMillis: 5000,
      }),
      log: [],
    });
  }
  async load(
    { issuer, subject }: Principal,
    patientId: string,
  ): Promise<AccessSnapshot> {
    return this.db.$transaction(async (db) => {
      const [clock] = await db.$queryRaw<
        { now: Date }[]
      >`SELECT statement_timestamp() AS now`;
      const [account] = await db.$queryRaw<
        { id: string }[]
      >`SELECT id FROM fmv.app_accounts WHERE issuer = ${issuer} AND subject = ${subject}`;
      const [patient] = await db.$queryRaw<
        NonNullable<AccessSnapshot['patient']>[]
      >`
        SELECT id, display_name AS "displayName", owner_account_id AS "ownerAccountId" FROM fmv.persons WHERE id = ${patientId}::uuid`;
      const rows = account
        ? await db.$queryRaw<GrantRow[]>`
        SELECT id, patient_id AS "patientId", grantee_account_id AS "granteeAccountId", actions,
          scope_kind AS "scopeKind", category_id AS "categoryId", document_id AS "documentId",
          expires_at AS "expiresAt", revoked_at AS "revokedAt"
        FROM fmv.access_grants WHERE patient_id = ${patientId}::uuid AND grantee_account_id = ${account.id}::uuid`
        : [];
      return {
        accountId: account?.id ?? null,
        patient: patient ?? null,
        grants: rows.map(grant),
        now: clock!.now,
      };
    });
  }
  async list({ issuer, subject }: Principal): Promise<PatientSummary[]> {
    return this.db.$transaction(async (db) => {
      const [account] = await db.$queryRaw<
        { id: string }[]
      >`SELECT id FROM fmv.app_accounts WHERE issuer = ${issuer} AND subject = ${subject}`;
      if (!account) return [];
      const patients = await db.$queryRaw<
        { id: string; displayName: string; ownerAccountId: string }[]
      >`
        SELECT p.id, p.display_name AS "displayName", p.owner_account_id AS "ownerAccountId" FROM fmv.persons p
        WHERE p.owner_account_id = ${account.id}::uuid OR EXISTS (
          SELECT 1 FROM fmv.access_grants g WHERE g.patient_id = p.id AND g.grantee_account_id = ${account.id}::uuid
          AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > statement_timestamp()))
        ORDER BY p.display_name, p.id`;
      const rows = await db.$queryRaw<GrantRow[]>`
        SELECT id, patient_id AS "patientId", grantee_account_id AS "granteeAccountId", actions,
          scope_kind AS "scopeKind", category_id AS "categoryId", document_id AS "documentId",
          expires_at AS "expiresAt", revoked_at AS "revokedAt" FROM fmv.access_grants
        WHERE grantee_account_id = ${account.id}::uuid AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > statement_timestamp())`;
      return patients.flatMap((p) => {
        const own = p.ownerAccountId === account.id;
        const active = rows.filter((g) => g.patientId === p.id).map(grant);
        if (!own && active.length === 0) return [];
        return [
          {
            id: p.id,
            displayName: p.displayName,
            relationship: own ? ('self' as const) : ('caregiver' as const),
            capabilities: own
              ? permissionActions.map((action) => ({
                  action,
                  scope: { kind: 'patient' as const },
                }))
              : active.flatMap((g) =>
                  g.actions.map((action) => ({ action, scope: g.scope })),
                ),
          },
        ];
      });
    });
  }
  async document(documentId: string) {
    const rows = await this.db.$queryRaw<
      DocumentAuthority[]
    >`SELECT id, patient_id AS "patientId", category_id AS "categoryId", state FROM fmv.documents WHERE id = ${documentId}::uuid`;
    return rows[0] ?? null;
  }
  async category(categoryId: string) {
    const rows = await this.db.$queryRaw<
      { id: string }[]
    >`SELECT id FROM fmv.document_categories WHERE id = ${categoryId}::uuid`;
    return rows.length === 1;
  }
  async onModuleDestroy() {
    await this.db.$disconnect();
  }
}
