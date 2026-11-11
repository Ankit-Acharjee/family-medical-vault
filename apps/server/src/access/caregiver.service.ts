import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { Principal } from '../identity/person.store.js';
import type {
  PermissionScope,
  PermissionAction,
  FamilyAccessResult,
} from '@fmv/contracts';
import { AccessStore } from './access.store.js';
import type { AccessSnapshot, StoredGrant } from './access.store.js';
import { PermissionService, isUuid } from './permission.service.js';
import {
  generateInvitationToken,
  hashInvitationToken,
  validateProposal,
  ProposalError,
} from './invitation.js';

type Tx = Prisma.TransactionClient;
type Row = {
  id: string;
  kind: 'invitation' | 'request';
  patientId: string | null;
  issuerAccountId: string;
  recipientAccountId: string | null;
  actions: PermissionAction[];
  scopeKind: PermissionScope['kind'];
  categoryId: string | null;
  documentId: string | null;
  expiresAt: Date;
  state: 'pending' | 'claimed' | 'accepted' | 'revoked';
};
const scope = (r: {
  scopeKind: PermissionScope['kind'];
  categoryId: string | null;
  documentId: string | null;
}): PermissionScope =>
  r.scopeKind === 'patient'
    ? { kind: 'patient' }
    : r.scopeKind === 'category'
      ? { kind: 'category', categoryId: r.categoryId! }
      : { kind: 'document', documentId: r.documentId! };
const columns = `id,kind,patient_id AS "patientId",issuer_account_id AS "issuerAccountId",recipient_account_id AS "recipientAccountId",actions,scope_kind AS "scopeKind",category_id AS "categoryId",document_id AS "documentId",expires_at AS "expiresAt",state`;
async function actor(db: Tx, { issuer, subject }: Principal) {
  const [a] = await db.$queryRaw<
    { id: string }[]
  >`SELECT id FROM fmv.app_accounts WHERE issuer=${issuer} AND subject=${subject}`;
  if (!a) throw new NotFoundException();
  return a.id;
}
async function clock(db: Tx) {
  const [c] = await db.$queryRaw<
    { now: Date }[]
  >`SELECT statement_timestamp() AS now`;
  return c!.now;
}
async function event(
  db: Tx,
  patientId: string,
  actorId: string,
  kind: string,
  grantId: string | null = null,
) {
  await db.$executeRaw`INSERT INTO fmv.access_events(id,patient_id,actor_account_id,kind,grant_id) VALUES (${randomUUID()}::uuid,${patientId}::uuid,${actorId}::uuid,${kind},${grantId}::uuid)`;
}
// Transaction-local reads share the same locks/connection as approval and audit.
class TransactionAccessStore extends AccessStore {
  constructor(private readonly db: Tx) {
    super();
  }
  async load(principal: Principal, patientId: string): Promise<AccessSnapshot> {
    const accountId = await actor(this.db, principal);
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
      grants: rows.map((r) => ({ ...r, scope: scope(r) })),
      now: await clock(this.db),
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
      }[]
    >`SELECT id,patient_id AS "patientId",category_id AS "categoryId",state FROM fmv.documents WHERE id=${id}::uuid`;
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

export class CaregiverService implements OnModuleDestroy {
  private readonly db: PrismaClient | null;
  constructor(url: string | null) {
    this.db = url
      ? new PrismaClient({
          adapter: new PrismaPg({
            connectionString: url,
            options: '-c timezone=UTC',
            max: 3,
            connectionTimeoutMillis: 5000,
          }),
          log: [],
        })
      : null;
  }
  private async tx<T>(work: (db: Tx) => Promise<T>) {
    if (!this.db) throw new ServiceUnavailableException();
    try {
      return await this.db.$transaction(work, {
        maxWait: 5000,
        timeout: 15000,
      });
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ProposalError) throw e;
      throw new ServiceUnavailableException();
    }
  }
  private async lock(db: Tx, p: string) {
    if (!isUuid(p)) throw new NotFoundException();
    await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'access-patient:' + p},0))`;
  }
  private async delegate(
    db: Tx,
    principal: Principal,
    p: string,
    actions: PermissionAction[],
    target: PermissionScope,
    until?: Date,
  ) {
    const store = new TransactionAccessStore(db),
      permissions = new PermissionService(store);
    const s = await permissions.snapshot(principal, p);
    const resource =
      target.kind === 'document'
        ? await store.document(target.documentId)
        : undefined;
    if (target.kind === 'document' && (!resource || resource.patientId !== p))
      throw new NotFoundException();
    if (
      target.kind === 'category' &&
      !(await store.category(target.categoryId))
    )
      throw new NotFoundException();
    const evaluated = until
      ? { ...s, now: new Date(Math.max(s.now.getTime(), until.getTime() - 1)) }
      : s;
    if (
      !['manage', ...actions].every((a) =>
        permissions.allows(
          evaluated,
          a as PermissionAction,
          target,
          resource ?? undefined,
        ),
      )
    )
      throw new NotFoundException();
    const parentIds =
      s.patient?.ownerAccountId === s.accountId
        ? []
        : [
            ...new Set(
              ['manage', ...actions].map((a) => {
                const support = s.grants.find((g) =>
                  permissions.allows(
                    { ...evaluated, grants: [g] },
                    a as PermissionAction,
                    target,
                    resource ?? undefined,
                  ),
                );
                if (!support) throw new NotFoundException();
                return support.id;
              }),
            ),
          ];
    return { accountId: s.accountId!, parentIds };
  }
  async create(principal: Principal, p: string | null, input: unknown) {
    const proposal = validateProposal(input);
    return this.tx(async (db) => {
      if (p) await this.lock(db, p);
      const accountId = await actor(db, principal),
        now = await clock(db),
        expiresAt = new Date(now.getTime() + proposal.expiresInHours * 3600000);
      if (p)
        await this.delegate(
          db,
          principal,
          p,
          proposal.actions,
          proposal.scope,
          expiresAt,
        );
      const { token, tokenHash } = generateInvitationToken(),
        id = randomUUID(),
        kind = p ? 'invitation' : 'request',
        recipient = p ? null : accountId;
      await db.$executeRaw`INSERT INTO fmv.access_invitations(id,token_hash,kind,patient_id,issuer_account_id,recipient_account_id,actions,scope_kind,category_id,document_id,state,expires_at) VALUES (${id}::uuid,${tokenHash},${kind},${p}::uuid,${accountId}::uuid,${recipient}::uuid,${proposal.actions}::text[],${proposal.scope.kind},${proposal.scope.kind === 'category' ? proposal.scope.categoryId : null}::uuid,${proposal.scope.kind === 'document' ? proposal.scope.documentId : null}::uuid,'pending',${expiresAt.toISOString()}::timestamptz)`;
      if (p) await event(db, p, accountId, 'invitation.created');
      return { id, token, expiresAt: expiresAt.toISOString() };
    });
  }
  async claim(principal: Principal, token: unknown) {
    const hash = hashInvitationToken(token);
    if (!hash) throw new NotFoundException();
    return this.tx(async (db) => {
      const accountId = await actor(db, principal);
      const [r] = await db.$queryRawUnsafe<Row[]>(
        `SELECT ${columns} FROM fmv.access_invitations WHERE token_hash=$1 FOR UPDATE`,
        hash,
      );
      if (
        !r ||
        r.kind !== 'invitation' ||
        r.state !== 'pending' ||
        r.expiresAt <= (await clock(db)) ||
        r.issuerAccountId === accountId
      )
        throw new NotFoundException();
      await db.$executeRaw`UPDATE fmv.access_invitations SET recipient_account_id=${accountId}::uuid,state='claimed' WHERE id=${r.id}::uuid`;
      await event(db, r.patientId!, accountId, 'invitation.claimed');
      return { id: r.id, state: 'claimed' as const };
    });
  }
  async inspect(principal: Principal, token: unknown) {
    const hash = hashInvitationToken(token);
    if (!hash) throw new NotFoundException();
    return this.tx(async (db) => {
      await actor(db, principal);
      const [r] = await db.$queryRawUnsafe<
        (Row & {
          requesterName: string | null;
          requesterPersonId: string | null;
        })[]
      >(
        `SELECT ${columns},(SELECT display_name FROM fmv.persons WHERE owner_account_id=i.issuer_account_id) AS "requesterName",(SELECT id FROM fmv.persons WHERE owner_account_id=i.issuer_account_id) AS "requesterPersonId" FROM fmv.access_invitations i WHERE token_hash=$1`,
        hash,
      );
      if (!r || r.state !== 'pending' || r.expiresAt <= (await clock(db)))
        throw new NotFoundException();
      return {
        kind: r.kind,
        actions: r.actions,
        scope: scope(r),
        expiresAt: r.expiresAt.toISOString(),
        requesterName: r.requesterName,
        requesterPersonId: r.requesterPersonId,
      };
    });
  }
  async list(principal: Principal, p: string): Promise<FamilyAccessResult> {
    return this.tx(async (db) => {
      const store = new TransactionAccessStore(db),
        permissions = new PermissionService(store);
      let current = await permissions.snapshot(principal, p);
      const hasManage = () =>
        current.patient?.ownerAccountId === current.accountId ||
        current.grants.some(
          (g) =>
            g.actions.includes('manage') &&
            !g.revokedAt &&
            (!g.expiresAt || g.expiresAt > current.now),
        );
      if (!hasManage()) throw new NotFoundException();
      const grants = await db.$queryRawUnsafe<
        (Omit<StoredGrant, 'scope'> & {
          scopeKind: PermissionScope['kind'];
          categoryId: string | null;
          documentId: string | null;
          recipientName: string | null;
          recipientPersonId: string | null;
        })[]
      >(
        `SELECT id,actions,scope_kind AS "scopeKind",category_id AS "categoryId",document_id AS "documentId",expires_at AS "expiresAt",revoked_at AS "revokedAt",(SELECT display_name FROM fmv.persons WHERE owner_account_id=g.grantee_account_id) AS "recipientName",(SELECT id FROM fmv.persons WHERE owner_account_id=g.grantee_account_id) AS "recipientPersonId" FROM fmv.access_grants g WHERE patient_id=$1::uuid ORDER BY created_at DESC,id`,
        p,
      );
      const rows = await db.$queryRawUnsafe<
        (Row & {
          recipientName: string | null;
          recipientPersonId: string | null;
        })[]
      >(
        `SELECT ${columns
          .split(',')
          .map((c) => (c.trim().startsWith('id') ? 'i.' + c : c))
          .join(
            ',',
          )},(SELECT display_name FROM fmv.persons WHERE owner_account_id=i.recipient_account_id) AS "recipientName",(SELECT id FROM fmv.persons WHERE owner_account_id=i.recipient_account_id) AS "recipientPersonId" FROM fmv.access_invitations i WHERE patient_id=$1::uuid ORDER BY created_at DESC,id`,
        p,
      );
      current = await permissions.snapshot(principal, p);
      if (!hasManage()) throw new NotFoundException();
      const visible = async (r: {
        scopeKind: PermissionScope['kind'];
        categoryId: string | null;
        documentId: string | null;
      }) =>
        permissions.allows(
          current,
          'manage',
          scope(r),
          r.scopeKind === 'document'
            ? ((await store.document(r.documentId!)) ?? undefined)
            : undefined,
        );
      const visibleGrants = await Promise.all(grants.map(visible));
      const visibleInvitations = await Promise.all(rows.map(visible));
      return {
        grants: grants
          .filter((_, i) => visibleGrants[i])
          .map((g) => ({
            id: g.id,
            recipientName: g.recipientName,
            recipientPersonId: g.recipientPersonId,
            actions: g.actions,
            scope: scope(g),
            expiresAt: g.expiresAt?.toISOString() ?? null,
            revokedAt: g.revokedAt?.toISOString() ?? null,
          })),
        invitations: rows
          .filter((_, i) => visibleInvitations[i])
          .map((r) => ({
            id: r.id,
            actions: r.actions,
            scope: scope(r),
            expiresAt: r.expiresAt.toISOString(),
            state: r.state,
            recipientName: r.recipientName,
            recipientPersonId: r.recipientPersonId,
          })),
      };
    });
  }
  async approve(
    principal: Principal,
    p: string,
    idOrToken: string,
    request = false,
  ) {
    return this.tx(async (db) => {
      await this.lock(db, p);
      const key = request ? hashInvitationToken(idOrToken) : idOrToken;
      if (!key || (!request && !isUuid(key))) throw new NotFoundException();
      const [r] = await db.$queryRawUnsafe<Row[]>(
        `SELECT ${columns} FROM fmv.access_invitations WHERE ${request ? 'token_hash=$1' : 'id=$1::uuid'} FOR UPDATE`,
        key,
      );
      if (
        !r ||
        r.kind !== (request ? 'request' : 'invitation') ||
        r.state !== (request ? 'pending' : 'claimed') ||
        !r.recipientAccountId ||
        r.expiresAt <= (await clock(db)) ||
        (!request && r.patientId !== p)
      )
        throw new NotFoundException();
      const { accountId: actorId, parentIds } = await this.delegate(
        db,
        principal,
        p,
        r.actions,
        scope(r),
        r.expiresAt,
      );
      if (actorId === r.recipientAccountId) throw new NotFoundException();
      if (!request) {
        const issuerStore = new TransactionAccessStore(db);
        const s = await issuerStore.loadActor(r.issuerAccountId, p);
        const resource =
          r.scopeKind === 'document'
            ? await issuerStore.document(r.documentId!)
            : undefined;
        const permissions = new PermissionService(issuerStore);
        if (
          !['manage', ...r.actions].every((a) =>
            permissions.allows(
              {
                ...s,
                now: new Date(
                  Math.max(s.now.getTime(), r.expiresAt.getTime() - 1),
                ),
              },
              a as PermissionAction,
              scope(r),
              resource ?? undefined,
            ),
          )
        )
          throw new NotFoundException();
      }
      const grantId = randomUUID();
      await db.$executeRaw`INSERT INTO fmv.access_grants(id,patient_id,grantee_account_id,issuer_account_id,actions,scope_kind,category_id,document_id,expires_at) VALUES (${grantId}::uuid,${p}::uuid,${r.recipientAccountId}::uuid,${actorId}::uuid,${r.actions}::text[],${r.scopeKind},${r.categoryId}::uuid,${r.documentId}::uuid,${r.expiresAt.toISOString()}::timestamptz)`;
      for (const parent of parentIds)
        await db.$executeRaw`INSERT INTO fmv.access_grant_dependencies(patient_id,grant_id,parent_grant_id) VALUES (${p}::uuid,${grantId}::uuid,${parent}::uuid)`;
      await db.$executeRaw`UPDATE fmv.access_invitations SET state='accepted',patient_id=${p}::uuid WHERE id=${r.id}::uuid`;
      await event(db, p, actorId, 'grant.created', grantId);
      return { grantId };
    });
  }
  async revoke(
    principal: Principal,
    p: string,
    id: string,
    invitation = false,
  ) {
    if (!isUuid(id)) throw new NotFoundException();
    return this.tx(async (db) => {
      await this.lock(db, p);
      if (invitation) {
        const [r] = await db.$queryRawUnsafe<Row[]>(
          `SELECT ${columns} FROM fmv.access_invitations WHERE id=$1::uuid AND patient_id=$2::uuid FOR UPDATE`,
          id,
          p,
        );
        if (!r) throw new NotFoundException();
        const a = await this.delegate(db, principal, p, [], scope(r));
        if (r.state === 'accepted') throw new NotFoundException();
        if (r.state === 'revoked') return {};
        const changed =
          await db.$executeRaw`UPDATE fmv.access_invitations SET state='revoked' WHERE id=${id}::uuid AND state IN ('pending','claimed')`;
        if (changed !== 1) throw new NotFoundException();
        await event(db, p, a.accountId, 'invitation.revoked');
        return {};
      }
      const [g] = await db.$queryRaw<
        {
          granteeAccountId: string;
          scopeKind: PermissionScope['kind'];
          categoryId: string | null;
          documentId: string | null;
        }[]
      >`SELECT grantee_account_id AS "granteeAccountId",scope_kind AS "scopeKind",category_id AS "categoryId",document_id AS "documentId" FROM fmv.access_grants WHERE id=${id}::uuid AND patient_id=${p}::uuid`;
      if (!g) throw new NotFoundException();
      const a = await this.delegate(db, principal, p, [], scope(g));
      // Revoke only grants derived from this exact authority; unrelated independent
      // grants for the same caregiver remain intact. Expiry cannot exceed parents.
      const revoked = await db.$queryRaw<
        { id: string }[]
      >`WITH RECURSIVE descendants AS (SELECT id FROM fmv.access_grants WHERE id=${id}::uuid AND patient_id=${p}::uuid UNION SELECT dep.grant_id FROM fmv.access_grant_dependencies dep JOIN descendants d ON dep.parent_grant_id=d.id WHERE dep.patient_id=${p}::uuid) UPDATE fmv.access_grants SET revoked_at=statement_timestamp() WHERE id IN (SELECT id FROM descendants) AND revoked_at IS NULL RETURNING id`;
      for (const r of revoked)
        await event(db, p, a.accountId, 'grant.revoked', r.id);
      return {};
    });
  }
  async onModuleDestroy() {
    await this.db?.$disconnect();
  }
}
