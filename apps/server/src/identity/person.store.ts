import { randomUUID } from 'node:crypto';
import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import type { OwnPerson } from '@fmv/contracts';
import { PrismaClient } from '../generated/prisma/client.js';

export type Principal = { issuer: string; subject: string };
export abstract class PersonStore {
  abstract find(principal: Principal): Promise<OwnPerson | null>;
  abstract create(
    principal: Principal,
    displayName: string,
  ): Promise<OwnPerson>;
}

export class PrismaPersonStore extends PersonStore implements OnModuleDestroy {
  private readonly db: PrismaClient;
  constructor(url: string) {
    super();
    this.db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: url,
        max: 2,
        connectionTimeoutMillis: 5000,
      }),
      log: [],
    });
  }
  async find({ issuer, subject }: Principal) {
    const rows = await this.db.$queryRaw<OwnPerson[]>`
      SELECT p.id, p.display_name AS "displayName"
      FROM fmv.persons p JOIN fmv.app_accounts a ON a.id = p.owner_account_id
      WHERE a.issuer = ${issuer} AND a.subject = ${subject}`;
    return rows[0] ?? null;
  }
  async create({ issuer, subject }: Principal, displayName: string) {
    return this.db.$transaction(
      async (db) => {
        // Conflicts wait for the winning transaction. The subsequent statement at
        // READ COMMITTED sees its committed row; no UPDATE privilege is needed.
        await db.$executeRaw`INSERT INTO fmv.app_accounts (id, issuer, subject)
        VALUES (${randomUUID()}::uuid, ${issuer}, ${subject})
        ON CONFLICT (issuer, subject) DO NOTHING`;
        const accounts = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM fmv.app_accounts WHERE issuer = ${issuer} AND subject = ${subject}`;
        const account = accounts[0];
        if (!account) throw new Error('Identity transaction failed');
        await db.$executeRaw`INSERT INTO fmv.persons (id, owner_account_id, display_name)
        VALUES (${randomUUID()}::uuid, ${account.id}::uuid, ${displayName})
        ON CONFLICT (owner_account_id) DO NOTHING`;
        const people = await db.$queryRaw<OwnPerson[]>`
        SELECT id, display_name AS "displayName" FROM fmv.persons
        WHERE owner_account_id = ${account.id}::uuid`;
        if (!people[0]) throw new Error('Identity transaction failed');
        return people[0];
      },
      { isolationLevel: 'ReadCommitted', timeout: 10000, maxWait: 5000 },
    );
  }
  async onModuleDestroy() {
    await this.db.$disconnect();
  }
}
