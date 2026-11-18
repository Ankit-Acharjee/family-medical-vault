import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { isCreateManagedProfile, permissionActions } from '@fmv/contracts';
import { PrismaClient } from '../generated/prisma/client.js';
import { digest } from '../auth/auth.crypto.js';
import type { Principal } from './person.store.js';
import {
  transactionActor,
  TransactionAccessStore,
  lockAccessPatient,
} from '../access/transaction-access.store.js';
import { PermissionService } from '../access/permission.service.js';
export class ManagedProfilesService implements OnModuleDestroy {
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
  async create(principal: Principal, input: unknown) {
    if (!isCreateManagedProfile(input)) throw new BadRequestException();
    if (!this.db) throw new ServiceUnavailableException();
    const hash = digest(JSON.stringify({ displayName: input.displayName }));
    try {
      return await this.db.$transaction(
        async (db) => {
          await db.$executeRaw`SET LOCAL statement_timeout='8s'`;
          const actor = await transactionActor(db, principal);
          await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'managed-create:' + actor},0))`;
          if (
            !(
              await db.$queryRaw<
                { id: string }[]
              >`SELECT id FROM fmv.persons WHERE owner_account_id=${actor}::uuid`
            )[0]
          )
            throw new NotFoundException();
          const existing = (
            await db.$queryRaw<
              { id: string; displayName: string; hash: string }[]
            >`SELECT p.id,p.display_name AS "displayName",m.payload_sha256 AS hash FROM fmv.managed_profile_creations m JOIN fmv.persons p ON p.id=m.patient_id WHERE m.creator_account_id=${actor}::uuid AND m.request_id=${input.requestId}::uuid`
          )[0];
          if (existing) {
            if (existing.hash !== hash) throw new ConflictException();
            await lockAccessPatient(db, existing.id);
            const permissions = new PermissionService(
                new TransactionAccessStore(db),
              ),
              snapshot = await permissions.snapshot(principal, existing.id);
            if (!permissions.allows(snapshot, 'manage', { kind: 'patient' }))
              throw new NotFoundException();
            return {
              id: existing.id,
              displayName: existing.displayName,
              relationship: 'caregiver' as const,
              created: false,
            };
          }
          const id = randomUUID(),
            grant = randomUUID();
          await lockAccessPatient(db, id);
          await db.$executeRaw`INSERT INTO fmv.persons(id,owner_account_id,display_name) VALUES(${id}::uuid,NULL,${input.displayName})`;
          await db.$executeRaw`INSERT INTO fmv.access_grants(id,patient_id,grantee_account_id,issuer_account_id,actions,scope_kind) VALUES(${grant}::uuid,${id}::uuid,${actor}::uuid,${actor}::uuid,${[...permissionActions]}::text[],'patient')`;
          await db.$executeRaw`INSERT INTO fmv.managed_profile_creations(patient_id,creator_account_id,request_id,payload_sha256,initial_grant_id) VALUES(${id}::uuid,${actor}::uuid,${input.requestId}::uuid,${hash},${grant}::uuid)`;
          await db.$executeRaw`INSERT INTO fmv.access_events(id,patient_id,actor_account_id,kind,grant_id) VALUES(${randomUUID()}::uuid,${id}::uuid,${actor}::uuid,'grant.created',${grant}::uuid)`;
          return {
            id,
            displayName: input.displayName,
            relationship: 'caregiver' as const,
            created: true,
          };
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
}
