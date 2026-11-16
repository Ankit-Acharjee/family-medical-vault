import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomUUID } from 'node:crypto';
import {
  canonicalComparisonMembers,
  isConfirmMeasurementComparison,
  isWithdrawMeasurementComparison,
  projectConfirmedMeasurements,
} from '@fmv/contracts';
import type {
  MeasurementComparisonMember,
  ConfirmedMeasurement,
} from '@fmv/contracts';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { Principal } from '../identity/person.store.js';
import {
  TransactionAccessStore,
  lockAccessPatient,
} from '../access/transaction-access.store.js';
import { PermissionService, isUuid } from '../access/permission.service.js';

type Tx = Prisma.TransactionClient;
type Row = {
  revision: number;
  action: 'confirmation' | 'withdrawal';
  requestId: string;
  payloadHash: string;
  actorAccountId: string;
  members: MeasurementComparisonMember[];
};
export class MeasurementComparisonsService implements OnModuleDestroy {
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
  async onModuleDestroy() {
    await this.db?.$disconnect();
  }
  private async tx<T>(
    p: string,
    id: string,
    work: (db: Tx) => Promise<T>,
  ): Promise<T> {
    if (!isUuid(p) || !isUuid(id)) throw new NotFoundException();
    if (!this.db) throw new ServiceUnavailableException();
    try {
      return await this.db.$transaction(
        async (db) => {
          await db.$executeRaw`SET LOCAL statement_timeout='8s'`;
          await lockAccessPatient(db, p);
          return work(db);
        },
        { maxWait: 5000, timeout: 15000 },
      );
    } catch (e) {
      if (
        e instanceof NotFoundException ||
        e instanceof BadRequestException ||
        e instanceof ConflictException ||
        e instanceof ServiceUnavailableException
      )
        throw e;
      throw new ServiceUnavailableException();
    }
  }
  private async latest(db: Tx, p: string, id: string) {
    const [row] = await db.$queryRaw<
      Row[]
    >`SELECT revision,action,request_id AS "requestId",payload_hash AS "payloadHash",actor_account_id AS "actorAccountId",members FROM fmv.measurement_comparisons WHERE patient_id=${p}::uuid AND set_id=${id}::uuid ORDER BY revision DESC LIMIT 1`;
    return row ?? null;
  }
  private async auth(
    db: Tx,
    principal: Principal,
    p: string,
    members: MeasurementComparisonMember[],
    ownerOnly: boolean,
    allowTrash: boolean,
  ) {
    const store = new TransactionAccessStore(db),
      permissions = new PermissionService(store);
    const s = await permissions.snapshot(principal, p);
    const owner = s.patient?.ownerAccountId === s.accountId;
    if (ownerOnly && !owner) throw new NotFoundException();
    for (const d of [...new Set(members.map((m) => m.documentId))].sort()) {
      const resource = await store.document(d);
      if (
        !resource ||
        resource.patientId !== p ||
        !permissions.allows(
          s,
          'view',
          { kind: 'document', documentId: d },
          resource,
          allowTrash && owner,
        )
      )
        throw new NotFoundException();
    }
    return { accountId: s.accountId!, owner };
  }
  private async lockDocs(
    db: Tx,
    p: string,
    members: MeasurementComparisonMember[],
  ) {
    for (const d of [...new Set(members.map((m) => m.documentId))].sort())
      await db.$queryRaw`SELECT id FROM fmv.documents WHERE id=${d}::uuid AND patient_id=${p}::uuid FOR NO KEY UPDATE`;
  }
  private async current(
    db: Tx,
    p: string,
    members: MeasurementComparisonMember[],
  ): Promise<ConfirmedMeasurement[] | null> {
    const result: ConfirmedMeasurement[] = [];
    for (const m of members) {
      const [d] = await db.$queryRaw<
        {
          state: string;
          deletedAt: Date | null;
          sha256: string;
          lifecycleVersion: number;
        }[]
      >`SELECT state,deleted_at AS "deletedAt",sha256,extraction_lifecycle AS "lifecycleVersion" FROM fmv.documents WHERE id=${m.documentId}::uuid AND patient_id=${p}::uuid`;
      if (
        !d ||
        d.state !== 'ready' ||
        d.deletedAt ||
        d.sha256 !== m.sourceSha256 ||
        d.lifecycleVersion !== m.lifecycleVersion
      )
        return null;
      const [extraction] = await db.$queryRaw<
        { revision: number; sourceSha256: string; lifecycleVersion: number }[]
      >`SELECT revision,source_sha256 AS "sourceSha256",lifecycle_version AS "lifecycleVersion" FROM fmv.document_extractions WHERE document_id=${m.documentId}::uuid AND patient_id=${p}::uuid`;
      if (
        !extraction ||
        extraction.revision !== m.sourceRevision ||
        extraction.sourceSha256 !== m.sourceSha256 ||
        extraction.lifecycleVersion !== m.lifecycleVersion
      )
        return null;
      const [r] = await db.$queryRaw<
        {
          revision: number;
          sourceRevision: number;
          sourceSha256: string;
          lifecycleVersion: number;
          action: 'confirmation' | 'withdrawal';
          withdrawnItems: unknown;
          items: unknown;
          extraction: unknown;
          ruleVersion: 'labeled-lab-blocks-v1';
          verifiedAt: Date;
        }[]
      >`SELECT revision,source_revision AS "sourceRevision",source_sha256 AS "sourceSha256",lifecycle_version AS "lifecycleVersion",action,withdrawn_items AS "withdrawnItems",items,source_context AS extraction,rule_version AS "ruleVersion",verified_at AS "verifiedAt" FROM fmv.document_clinical_reviews WHERE patient_id=${p}::uuid AND document_id=${m.documentId}::uuid ORDER BY revision DESC LIMIT 1`;
      if (
        !r ||
        r.revision !== m.reviewRevision ||
        r.sourceRevision !== m.sourceRevision ||
        r.sourceSha256 !== m.sourceSha256 ||
        r.lifecycleVersion !== m.lifecycleVersion ||
        !Array.isArray(r.items)
      )
        return null;
      const review = {
        context: {
          sourceRevision: m.sourceRevision,
          sourceSha256: m.sourceSha256,
          lifecycleVersion: m.lifecycleVersion,
          revision: r.revision,
          canVerify: false,
        },
        candidates: [],
        snapshot: {
          action: r.action,
          withdrawnItems: r.withdrawnItems,
          revision: r.revision,
          sourceRevision: r.sourceRevision,
          sourceSha256: r.sourceSha256,
          items: r.items,
          extraction: r.extraction,
          ruleVersion: r.ruleVersion,
          verifiedAt: r.verifiedAt.toISOString(),
          verified: r.items.length > 0,
        },
      };
      const selected = projectConfirmedMeasurements(
        p,
        m.documentId,
        review,
      ).find((x) => x.source.id === m.candidateId);
      if (!selected) return null;
      result.push(selected);
    }
    return result;
  }
  private compatible(ms: ConfirmedMeasurement[]) {
    const first = ms[0]?.fields;
    return (
      !!first?.unit &&
      ms.every(
        (m) =>
          m.fields.analyte === first.analyte && m.fields.unit === first.unit,
      ) &&
      ['specimen', 'method'].every(
        (k) =>
          new Set(
            ms
              .map((m) => m.fields[k as 'specimen' | 'method'])
              .filter((v) => v !== null),
          ).size <= 1,
      )
    );
  }
  async read(principal: Principal, p: string, id: string) {
    p = p.toLowerCase();
    id = id.toLowerCase();
    return this.tx(p, id, async (db) => {
      const row = await this.latest(db, p, id);
      if (!row) {
        const actor = await this.auth(db, principal, p, [], true, false);
        return {
          setId: id,
          revision: 0,
          status: 'missing' as const,
          canConfirm: actor.owner,
          members: [],
          measurements: [],
        };
      }
      await this.lockDocs(db, p, row.members);
      let actor = await this.auth(db, principal, p, row.members, false, false);
      const measurements =
        row.action === 'confirmation'
          ? await this.current(db, p, row.members)
          : null;
      for (const d of [...new Set(row.members.map((m) => m.documentId))])
        await db.$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) VALUES (${randomUUID()}::uuid,${p}::uuid,${d}::uuid,${actor.accountId}::uuid,'document.viewed')`;
      actor = await this.auth(db, principal, p, row.members, false, false);
      return {
        setId: id,
        revision: row.revision,
        status:
          row.action === 'withdrawal'
            ? ('withdrawn' as const)
            : measurements
              ? ('current' as const)
              : ('invalid' as const),
        canConfirm: actor.owner,
        members: row.members,
        measurements: measurements ?? [],
      };
    });
  }
  async confirm(principal: Principal, p: string, id: string, input: unknown) {
    return this.write(principal, p, id, 'confirmation', input);
  }
  async withdraw(principal: Principal, p: string, id: string, input: unknown) {
    return this.write(principal, p, id, 'withdrawal', input);
  }
  private async write(
    principal: Principal,
    p: string,
    id: string,
    action: 'confirmation' | 'withdrawal',
    input: unknown,
  ) {
    p = p.toLowerCase();
    id = id.toLowerCase();
    return this.tx(p, id, async (db) => {
      await this.auth(db, principal, p, [], true, false);
      const valid =
        action === 'confirmation'
          ? isConfirmMeasurementComparison(input)
          : isWithdrawMeasurementComparison(input);
      if (!valid) throw new BadRequestException();
      const body = input as
        | import('@fmv/contracts').ConfirmMeasurementComparison
        | import('@fmv/contracts').WithdrawMeasurementComparison;
      const { requestId, expectedRevision } = body;
      const requested =
        'members' in body ? canonicalComparisonMembers(body.members) : null;
      const row = await this.latest(db, p, id);
      const members = requested ?? row?.members;
      if (!members) {
        await this.auth(db, principal, p, [], true, false);
        throw new NotFoundException();
      }
      await this.lockDocs(db, p, members);
      await this.auth(db, principal, p, members, true, action === 'withdrawal');
      const hash = createHash('sha256')
        .update(
          JSON.stringify({
            action,
            expectedRevision,
            confirmed: true,
            ...(requested ? { members } : {}),
          }),
        )
        .digest('hex');
      const current =
        action === 'confirmation' ? await this.current(db, p, members) : null;
      if (action === 'confirmation' && (!current || !this.compatible(current)))
        throw new ConflictException();
      const actor = await this.auth(
        db,
        principal,
        p,
        members,
        true,
        action === 'withdrawal',
      );
      if (row?.requestId === requestId.toLowerCase()) {
        if (
          row.action === action &&
          row.payloadHash === hash &&
          row.actorAccountId === actor.accountId
        )
          return { saved: true as const, revision: row.revision };
        throw new ConflictException();
      }
      const [used] = await db.$queryRaw<
        { present: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM fmv.measurement_comparisons WHERE set_id=${id}::uuid AND request_id=${requestId}::uuid) AS present`;
      if (
        expectedRevision === 2147483647 ||
        used?.present ||
        expectedRevision !== (row?.revision ?? 0) ||
        (action === 'withdrawal' && (!row || row.action !== 'confirmation'))
      )
        throw new ConflictException();
      const revision = expectedRevision + 1;
      await db.$executeRaw`INSERT INTO fmv.measurement_comparisons(id,set_id,patient_id,revision,action,request_id,payload_hash,actor_account_id,members) VALUES (${randomUUID()}::uuid,${id}::uuid,${p}::uuid,${revision},${action},${requestId}::uuid,${hash},${actor.accountId}::uuid,${JSON.stringify(members)}::jsonb)`;
      for (const d of [...new Set(members.map((m) => m.documentId))])
        await db.$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) VALUES (${randomUUID()}::uuid,${p}::uuid,${d}::uuid,${actor.accountId}::uuid,${action === 'confirmation' ? 'measurement.comparability_confirmed' : 'measurement.comparability_withdrawn'})`;
      await this.auth(db, principal, p, members, true, action === 'withdrawal');
      return { saved: true as const, revision };
    });
  }
}
