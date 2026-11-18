import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { isEmergencyProfile, isSaveEmergencyProfile } from '@fmv/contracts';
import type { EmergencyProfileFields } from '@fmv/contracts';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { Principal } from '../identity/person.store.js';
import { PermissionService, isUuid } from '../access/permission.service.js';
import {
  TransactionAccessStore,
  lockAccessPatient,
} from '../access/transaction-access.store.js';
import { digest } from '../auth/auth.crypto.js';
type Tx = Prisma.TransactionClient;
type Row = {
  revision: number;
  fields: EmergencyProfileFields;
  recordedAt: Date;
};
export class EmergencyProfileService implements OnModuleDestroy {
  private readonly db: PrismaClient | null;
  constructor(url: string | null) {
    this.db = url
      ? new PrismaClient({
          adapter: new PrismaPg({
            connectionString: url,
            options: '-c timezone=UTC',
            max: 2,
            connectionTimeoutMillis: 5000,
          }),
          log: [],
        })
      : null;
  }
  async onModuleDestroy() {
    await this.db?.$disconnect();
  }
  private async tx<T>(p: string, work: (db: Tx) => Promise<T>) {
    if (!isUuid(p)) throw new NotFoundException();
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
        e instanceof BadRequestException ||
        e instanceof ConflictException ||
        e instanceof NotFoundException
      )
        throw e;
      throw new ServiceUnavailableException();
    }
  }
  private async auth(db: Tx, principal: Principal, p: string, write = false) {
    const permissions = new PermissionService(new TransactionAccessStore(db)),
      snapshot = await permissions.snapshot(principal, p),
      owner = snapshot.patient?.ownerAccountId === snapshot.accountId;
    if (
      !permissions.allows(snapshot, 'view', { kind: 'patient' }) ||
      (write && !owner)
    )
      throw new NotFoundException();
    return { accountId: snapshot.accountId!, owner };
  }
  private async latest(db: Tx, p: string) {
    return (
      (
        await db.$queryRaw<
          Row[]
        >`SELECT revision,fields,recorded_at AS "recordedAt" FROM fmv.emergency_profile_entries WHERE patient_id=${p}::uuid ORDER BY revision DESC LIMIT 1`
      )[0] ?? null
    );
  }
  private async audit(db: Tx, p: string, actor: string, kind: string) {
    await db.$executeRaw`INSERT INTO fmv.emergency_profile_events(id,patient_id,actor_account_id,kind) VALUES(${randomUUID()}::uuid,${p}::uuid,${actor}::uuid,${kind})`;
  }
  async read(principal: Principal, patientId: string) {
    const p = patientId.toLowerCase();
    return this.tx(p, async (db) => {
      const actor = await this.auth(db, principal, p),
        row = await this.latest(db, p),
        result = {
          patientId: p,
          canWrite: actor.owner,
          profile: row
            ? {
                revision: row.revision,
                fields: row.fields,
                recordedAt: row.recordedAt.toISOString(),
                provenance: 'owner-reported' as const,
              }
            : null,
        };
      if (!isEmergencyProfile(result)) throw new ServiceUnavailableException();
      await this.audit(db, p, actor.accountId, 'emergency.viewed');
      await this.auth(db, principal, p);
      return result;
    });
  }
  async save(principal: Principal, patientId: string, input: unknown) {
    if (!isSaveEmergencyProfile(input)) throw new BadRequestException();
    const p = patientId.toLowerCase(),
      fields = {
        contactName: input.fields.contactName,
        contactRelationship: input.fields.contactRelationship,
        contactPhone: input.fields.contactPhone,
        note: input.fields.note,
      },
      hash = digest(
        JSON.stringify({ expectedRevision: input.expectedRevision, fields }),
      );
    return this.tx(p, async (db) => {
      const actor = await this.auth(db, principal, p, true),
        prior = (
          await db.$queryRaw<
            { revision: number; hash: string }[]
          >`SELECT revision,payload_sha256 AS hash FROM fmv.emergency_profile_entries WHERE patient_id=${p}::uuid AND request_id=${input.requestId}::uuid`
        )[0];
      if (prior) {
        if (prior.hash !== hash) throw new ConflictException();
        await this.auth(db, principal, p, true);
        return { saved: true, revision: prior.revision };
      }
      const current = await this.latest(db, p);
      if ((current?.revision ?? 0) !== input.expectedRevision)
        throw new ConflictException();
      const revision = input.expectedRevision + 1;
      await db.$executeRaw`INSERT INTO fmv.emergency_profile_entries(id,patient_id,actor_account_id,revision,request_id,payload_sha256,fields) VALUES(${randomUUID()}::uuid,${p}::uuid,${actor.accountId}::uuid,${revision},${input.requestId}::uuid,${hash},${JSON.stringify(fields)}::jsonb)`;
      await this.audit(db, p, actor.accountId, 'emergency.saved');
      await this.auth(db, principal, p, true);
      return { saved: true, revision };
    });
  }
}
