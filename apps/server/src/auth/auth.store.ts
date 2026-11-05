import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export type StoredSession = {
  idHash: string;
  userId: string | null;
  payload: string;
  expiresAt: Date;
};
export type SessionTransaction = {
  put: (record: StoredSession) => Promise<void>;
  remove: (idHash: string) => Promise<void>;
  removeUser: (userId: string) => Promise<void>;
};
export abstract class AuthStore {
  abstract insert(record: StoredSession): Promise<void>;
  abstract locked<T>(
    idHash: string,
    work: (record: StoredSession | null, tx: SessionTransaction) => Promise<T>,
  ): Promise<T>;
  abstract limit(id: string, until: Date, maximum: number): Promise<boolean>;
  abstract close(): Promise<void>;
  abstract cleanup(): Promise<void>;
  // These return only after consumption has committed, before provider effects.
  abstract take(idHash: string): Promise<StoredSession | null>;
  abstract takeUser(idHash: string): Promise<boolean>;
}

export class PrismaAuthStore extends AuthStore {
  private readonly db: PrismaClient;
  constructor(url: string) {
    super();
    this.db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: url,
        max: 4,
        connectionTimeoutMillis: 5000,
      }),
      log: [],
    });
  }
  async insert(record: StoredSession) {
    await this.db.authSession.create({ data: record });
  }
  async locked<T>(
    idHash: string,
    work: (record: StoredSession | null, tx: SessionTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.$transaction(
      async (db) => {
        await db.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        const rows = await db.$queryRaw<
          StoredSession[]
        >`SELECT id_hash AS "idHash", user_id AS "userId", payload, expires_at AS "expiresAt" FROM fmv.auth_sessions WHERE id_hash = ${idHash} FOR UPDATE`;
        return work(rows[0] ?? null, {
          put: async (record) => {
            await db.authSession.upsert({
              where: { idHash: record.idHash },
              create: record,
              update: record,
            });
          },
          remove: async (hash) => {
            await db.authSession.deleteMany({ where: { idHash: hash } });
          },
          removeUser: async (userId) => {
            await db.authSession.deleteMany({ where: { userId } });
          },
        });
      },
      { timeout: 20_000, maxWait: 5000 },
    );
  }
  async take(idHash: string) {
    return this.locked(idHash, async (row, tx) => {
      await tx.remove(idHash);
      return row;
    });
  }
  async takeUser(idHash: string) {
    return this.locked(idHash, async (row, tx) => {
      if (!row?.userId || row.expiresAt.getTime() <= Date.now()) return false;
      await tx.removeUser(row.userId);
      return true;
    });
  }
  async limit(id: string, until: Date, maximum: number) {
    const rows = await this.db.$queryRaw<
      { count: number }[]
    >`INSERT INTO fmv.auth_rate_limits (id, count, expires_at) VALUES (${id}, 1, ${until}) ON CONFLICT (id) DO UPDATE SET count = LEAST(fmv.auth_rate_limits.count + 1, ${maximum + 1}) RETURNING count`;
    return (rows[0]?.count ?? maximum + 1) <= maximum;
  }
  async cleanup() {
    await this.db
      .$executeRaw`DELETE FROM fmv.auth_sessions WHERE id_hash IN (SELECT id_hash FROM fmv.auth_sessions WHERE expires_at < now() LIMIT 1000)`;
    await this.db
      .$executeRaw`DELETE FROM fmv.auth_rate_limits WHERE id IN (SELECT id FROM fmv.auth_rate_limits WHERE expires_at < now() LIMIT 1000)`;
  }
  async close() {
    await this.db.$disconnect();
  }
}
