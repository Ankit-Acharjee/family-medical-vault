import { NotFoundException } from '@nestjs/common';
import type { PermissionScope } from '@fmv/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import type { Principal } from '../identity/person.store.js';
import { AccessStore } from './access.store.js';
import type { AccessSnapshot, StoredGrant } from './access.store.js';
import { isUuid } from './permission.service.js';
type Tx = Prisma.TransactionClient;
export const scopeFromGrant = (r: {
  scopeKind: PermissionScope['kind'];
  categoryId: string | null;
  documentId: string | null;
}): PermissionScope =>
  r.scopeKind === 'patient'
    ? { kind: 'patient' }
    : r.scopeKind === 'category'
      ? { kind: 'category', categoryId: r.categoryId! }
      : { kind: 'document', documentId: r.documentId! };
export async function transactionActor(db: Tx, { issuer, subject }: Principal) {
  const [a] = await db.$queryRaw<
    { id: string }[]
  >`SELECT id FROM fmv.app_accounts WHERE issuer=${issuer} AND subject=${subject}`;
  if (!a) throw new NotFoundException();
  return a.id;
}
export async function transactionClock(db: Tx) {
  const [c] = await db.$queryRaw<
    { now: Date }[]
  >`SELECT statement_timestamp() AS now`;
  return c!.now;
}
// Transaction-local reads share the same locks/connection as approval and audit.
export class TransactionAccessStore extends AccessStore {
  constructor(private readonly db: Tx) {
    super();
  }
  async load(principal: Principal, patientId: string): Promise<AccessSnapshot> {
    const accountId = await transactionActor(this.db, principal);
    return this.loadActor(accountId, patientId);
  }
  async loadActor(
    accountId: string,
    patientId: string,
  ): Promise<AccessSnapshot> {
    const [patient] = await this.db.$queryRaw<
      NonNullable<AccessSnapshot['patient']>[]
    >`SELECT id,display_name AS "displayName",owner_account_id AS "ownerAccountId" FROM fmv.persons WHERE id=${patientId}::uuid`;
    const rows = await this.db.$queryRaw<
      (Omit<StoredGrant, 'scope'> & {
        scopeKind: PermissionScope['kind'];
        categoryId: string | null;
        documentId: string | null;
      })[]
    >`SELECT id,patient_id AS "patientId",grantee_account_id AS "granteeAccountId",actions,scope_kind AS "scopeKind",category_id AS "categoryId",document_id AS "documentId",expires_at AS "expiresAt",revoked_at AS "revokedAt" FROM fmv.access_grants WHERE patient_id=${patientId}::uuid AND grantee_account_id=${accountId}::uuid`;
    return {
      accountId,
      patient: patient ?? null,
      grants: rows.map((r) => ({ ...r, scope: scopeFromGrant(r) })),
      now: await transactionClock(this.db),
    };
  }
  async list() {
    return [];
  }
  async document(id: string) {
    const [r] = await this.db.$queryRaw<
      {
        id: string;
        patientId: string;
        categoryId: string;
        state: 'pending' | 'ready' | 'failed';
        deletedAt: Date | null;
      }[]
    >`SELECT id,patient_id AS "patientId",category_id AS "categoryId",state,deleted_at AS "deletedAt" FROM fmv.documents WHERE id=${id}::uuid`;
    return r ?? null;
  }
  async category(id: string) {
    return (
      (
        (await this.db
          .$queryRaw`SELECT id FROM fmv.document_categories WHERE id=${id}::uuid`) as unknown[]
      ).length === 1
    );
  }
}

/** Shared lock order: patient access lock before resource/source locks. */
export async function lockAccessPatient(db: Tx, patientId: string) {
  if (!isUuid(patientId)) throw new NotFoundException();
  await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'access-patient:' + patientId.toLowerCase()},0))`;
}
