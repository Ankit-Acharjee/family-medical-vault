import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  isIssueProfileActivation,
  isApproveProfileActivation,
} from '@fmv/contracts';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { opaque, digest, validOpaque } from '../auth/auth.crypto.js';
import { isUuid } from '../access/permission.service.js';
import {
  transactionActor,
  transactionClock,
  lockAccessPatient,
} from '../access/transaction-access.store.js';
import type { Principal } from './person.store.js';
type Tx = Prisma.TransactionClient;
type Row = {
  id: string;
  patientId: string;
  issuerId: string;
  payloadHash: string;
  state: 'pending' | 'claimed' | 'accepted' | 'revoked';
  claimantId: string | null;
  claimantRef: string | null;
  expiresAt: Date;
  createdAt: Date;
};
const columns = `id,patient_id AS "patientId",issuer_account_id AS "issuerId",payload_sha256 AS "payloadHash",state,claimant_account_id AS "claimantId",claimant_ref AS "claimantRef",expires_at AS "expiresAt",created_at AS "createdAt"`;
export const hashActivationToken = (token: unknown) =>
  validOpaque(token) ? digest('fmv-profile-activation-v1:' + token) : null;
const view = (r: Row, now: Date) => ({
  id: r.id,
  patientId: r.patientId,
  state:
    r.state === 'accepted' || r.state === 'revoked'
      ? r.state
      : r.expiresAt <= now
        ? 'expired'
        : r.state,
  claimantRef: r.claimantRef,
  expiresAt: r.expiresAt.toISOString(),
  createdAt: r.createdAt.toISOString(),
});
export class ProfileActivationService implements OnModuleDestroy {
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
  private async tx<T>(work: (db: Tx) => Promise<T>) {
    if (!this.db) throw new ServiceUnavailableException();
    try {
      return await this.db.$transaction(
        async (db) => {
          await db.$executeRaw`SET LOCAL statement_timeout='8s'`;
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
  private async creator(db: Tx, principal: Principal, p: string) {
    if (!isUuid(p)) throw new NotFoundException();
    const actor = await transactionActor(db, principal),
      allowed = (
        await db.$queryRaw<
          { allowed: boolean }[]
        >`SELECT fmv.activation_creator_current(${p}::uuid,${actor}::uuid) allowed`
      )[0]?.allowed;
    if (!allowed) throw new NotFoundException();
    return actor;
  }
  async issue(principal: Principal, patientId: string, input: unknown) {
    if (!isIssueProfileActivation(input)) throw new BadRequestException();
    const p = patientId.toLowerCase();
    if (!isUuid(p)) throw new NotFoundException();
    return this.tx(async (db) => {
      await lockAccessPatient(db, p);
      const actor = await this.creator(db, principal, p),
        hash = digest(JSON.stringify({ expiresInHours: input.expiresInHours })),
        prior = (
          await db.$queryRawUnsafe<Row[]>(
            `SELECT ${columns} FROM fmv.profile_activations WHERE patient_id=$1::uuid AND request_id=$2::uuid`,
            p,
            input.requestId,
          )
        )[0];
      if (prior) {
        if (prior.payloadHash !== hash) throw new ConflictException();
        return {
          activation: view(prior, await transactionClock(db)),
          token: null,
          created: false,
        };
      }
      if (
        !(
          await db.$queryRaw<
            { id: string }[]
          >`SELECT id FROM fmv.persons WHERE id=${p}::uuid AND owner_account_id IS NULL`
        )[0]
      )
        throw new ConflictException();
      if (
        (
          await db.$queryRaw<
            { id: string }[]
          >`SELECT id FROM fmv.profile_activations WHERE patient_id=${p}::uuid AND state IN ('pending','claimed') AND expires_at>clock_timestamp() LIMIT 1`
        )[0]
      )
        throw new ConflictException();
      const id = randomUUID(),
        token = opaque(),
        now = await transactionClock(db),
        expires = new Date(now.getTime() + input.expiresInHours * 3600000);
      await db.$executeRaw`INSERT INTO fmv.profile_activations(id,patient_id,issuer_account_id,request_id,payload_sha256,token_sha256,expires_at,state,transition_account_id) VALUES(${id}::uuid,${p}::uuid,${actor}::uuid,${input.requestId}::uuid,${hash},${hashActivationToken(token)},${expires}::timestamptz,'pending',${actor}::uuid)`;
      const row = (
        await db.$queryRawUnsafe<Row[]>(
          `SELECT ${columns} FROM fmv.profile_activations WHERE id=$1::uuid`,
          id,
        )
      )[0]!;
      await this.creator(db, principal, p);
      return {
        activation: view(row, await transactionClock(db)),
        token,
        created: true,
      };
    });
  }
  async list(principal: Principal, patientId: string) {
    const p = patientId.toLowerCase();
    return this.tx(async (db) => {
      await lockAccessPatient(db, p);
      await this.creator(db, principal, p);
      const rows = await db.$queryRawUnsafe<Row[]>(
        `SELECT ${columns} FROM fmv.profile_activations WHERE patient_id=$1::uuid ORDER BY (state IN ('pending','claimed') AND expires_at>clock_timestamp()) DESC,created_at DESC,id DESC LIMIT 21`,
        p,
      );
      await this.creator(db, principal, p);
      const now = await transactionClock(db);
      return {
        patientId: p,
        activations: rows.slice(0, 20).map((r) => view(r, now)),
        limited: rows.length > 20,
      };
    });
  }
  async inspect(principal: Principal, token: unknown) {
    const hash = hashActivationToken(token);
    if (!hash) throw new NotFoundException();
    return this.tx(async (db) => {
      const found = (
        await db.$queryRawUnsafe<Row[]>(
          `SELECT ${columns} FROM fmv.profile_activations WHERE token_sha256=$1`,
          hash,
        )
      )[0];
      if (!found) throw new NotFoundException();
      await lockAccessPatient(db, found.patientId);
      const row = (
        await db.$queryRawUnsafe<Row[]>(
          `SELECT ${columns} FROM fmv.profile_activations WHERE id=$1::uuid`,
          found.id,
        )
      )[0]!;
      const actor = (
        await db.$queryRaw<
          { id: string }[]
        >`SELECT id FROM fmv.app_accounts WHERE issuer=${principal.issuer} AND subject=${principal.subject}`
      )[0];
      if (
        !['pending', 'claimed'].includes(row.state) ||
        row.expiresAt <= (await transactionClock(db)) ||
        (
          await db.$queryRaw<
            { allowed: boolean }[]
          >`SELECT fmv.activation_creator_current(${row.patientId}::uuid,${row.issuerId}::uuid) allowed`
        )[0]?.allowed !== true
      )
        throw new NotFoundException();
      if (
        actor &&
        (
          await db.$queryRaw<
            { id: string }[]
          >`SELECT id FROM fmv.persons WHERE owner_account_id=${actor.id}::uuid`
        )[0]
      )
        throw new ConflictException();
      if (row.state === 'claimed' && row.claimantId !== actor?.id)
        throw new NotFoundException();
      const patient = (
        await db.$queryRaw<
          { name: string }[]
        >`SELECT display_name AS name FROM fmv.persons WHERE id=${row.patientId}::uuid AND owner_account_id IS NULL`
      )[0];
      if (!patient) throw new NotFoundException();
      return {
        patientId: row.patientId,
        patientName: patient.name,
        expiresAt: row.expiresAt.toISOString(),
        claimantRef: row.claimantRef,
        state: row.state,
      };
    });
  }
  async status(principal: Principal, token: unknown) {
    const hash = hashActivationToken(token);
    if (!hash) throw new NotFoundException();
    return this.tx(async (db) => {
      const actor = await transactionActor(db, principal),
        found = (
          await db.$queryRawUnsafe<Row[]>(
            `SELECT ${columns} FROM fmv.profile_activations WHERE token_sha256=$1 AND claimant_account_id=$2::uuid`,
            hash,
            actor,
          )
        )[0];
      if (!found) throw new NotFoundException();
      await lockAccessPatient(db, found.patientId);
      const row = (
        await db.$queryRawUnsafe<Row[]>(
          `SELECT ${columns} FROM fmv.profile_activations WHERE id=$1::uuid`,
          found.id,
        )
      )[0]!;
      if (row.state === 'accepted') {
        if (
          !(
            await db.$queryRaw<
              { id: string }[]
            >`SELECT id FROM fmv.persons WHERE id=${row.patientId}::uuid AND owner_account_id=${actor}::uuid`
          )[0]
        )
          throw new NotFoundException();
        return {
          patientId: row.patientId,
          claimantRef: row.claimantRef,
          state: 'accepted' as const,
        };
      }
      if (
        row.state !== 'claimed' ||
        row.expiresAt <= (await transactionClock(db)) ||
        (
          await db.$queryRaw<
            { allowed: boolean }[]
          >`SELECT fmv.activation_creator_current(${row.patientId}::uuid,${row.issuerId}::uuid) allowed`
        )[0]?.allowed !== true
      )
        throw new NotFoundException();
      return {
        patientId: row.patientId,
        claimantRef: row.claimantRef,
        state: 'claimed' as const,
      };
    });
  }
  async claim(principal: Principal, token: unknown) {
    const hash = hashActivationToken(token);
    if (!hash) throw new NotFoundException();
    return this.tx(async (db) => {
      const found = (
        await db.$queryRawUnsafe<Row[]>(
          `SELECT ${columns} FROM fmv.profile_activations WHERE token_sha256=$1`,
          hash,
        )
      )[0];
      if (!found) throw new NotFoundException();
      await db.$executeRaw`INSERT INTO fmv.app_accounts(id,issuer,subject) VALUES(${randomUUID()}::uuid,${principal.issuer},${principal.subject}) ON CONFLICT(issuer,subject) DO NOTHING`;
      const actor = await transactionActor(db, principal);
      await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'identity-account:' + actor},0))`;
      await lockAccessPatient(db, found.patientId);
      const row = (
        await db.$queryRawUnsafe<Row[]>(
          `SELECT ${columns} FROM fmv.profile_activations WHERE id=$1::uuid FOR UPDATE`,
          found.id,
        )
      )[0]!;
      if (
        !['pending', 'claimed'].includes(row.state) ||
        row.expiresAt <= (await transactionClock(db)) ||
        (
          await db.$queryRaw<
            { allowed: boolean }[]
          >`SELECT fmv.activation_creator_current(${row.patientId}::uuid,${row.issuerId}::uuid) allowed`
        )[0]?.allowed !== true
      )
        throw new NotFoundException();
      if (
        (
          await db.$queryRaw<
            { id: string }[]
          >`SELECT id FROM fmv.persons WHERE owner_account_id=${actor}::uuid`
        )[0]
      )
        throw new ConflictException();
      if (row.state === 'claimed' && row.claimantId !== actor)
        throw new NotFoundException();
      const ref = row.claimantRef ?? randomUUID();
      if (row.state === 'pending')
        await db.$executeRaw`UPDATE fmv.profile_activations SET state='claimed',claimant_account_id=${actor}::uuid,claimant_ref=${ref}::uuid,transition_account_id=${actor}::uuid WHERE id=${row.id}::uuid`;
      if (
        row.expiresAt <= (await transactionClock(db)) ||
        (
          await db.$queryRaw<
            { allowed: boolean }[]
          >`SELECT fmv.activation_creator_current(${row.patientId}::uuid,${row.issuerId}::uuid) allowed`
        )[0]?.allowed !== true
      )
        throw new NotFoundException();
      return {
        patientId: row.patientId,
        claimantRef: ref,
        state: 'claimed' as const,
      };
    });
  }
  async revoke(principal: Principal, patientId: string, id: string) {
    if (!isUuid(id)) throw new NotFoundException();
    const p = patientId.toLowerCase();
    return this.tx(async (db) => {
      await lockAccessPatient(db, p);
      const actor = await this.creator(db, principal, p),
        row = (
          await db.$queryRawUnsafe<Row[]>(
            `SELECT ${columns} FROM fmv.profile_activations WHERE patient_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
            p,
            id,
          )
        )[0];
      if (!row) throw new NotFoundException();
      if (row.state === 'accepted') throw new ConflictException();
      if (row.state !== 'revoked')
        await db.$executeRaw`UPDATE fmv.profile_activations SET state='revoked',transition_account_id=${actor}::uuid WHERE id=${row.id}::uuid`;
      await this.creator(db, principal, p);
      return { revoked: true };
    });
  }
  async approve(
    principal: Principal,
    patientId: string,
    id: string,
    input: unknown,
  ) {
    if (!isApproveProfileActivation(input)) throw new BadRequestException();
    if (!isUuid(id) || !isUuid(patientId)) throw new NotFoundException();
    const p = patientId.toLowerCase();
    return this.tx(async (db) => {
      const actor = await this.creator(db, principal, p),
        row = (
          await db.$queryRaw<
            { id: string }[]
          >`SELECT id FROM fmv.profile_activations WHERE id=${id}::uuid AND patient_id=${p}::uuid AND issuer_account_id=${actor}::uuid`
        )[0];
      if (!row) throw new NotFoundException();
      try {
        const result = (
          await db.$queryRaw<
            { id: string }[]
          >`SELECT fmv.approve_profile_activation(${id}::uuid,${actor}::uuid,${input.claimantRef}::uuid,${input.requestId}::uuid) id`
        )[0];
        if (result?.id !== p) throw new ConflictException();
      } catch (error) {
        const code =
          (
            error as {
              meta?: {
                code?: unknown;
                driverAdapterError?: { cause?: { originalCode?: unknown } };
              };
            }
          )?.meta?.driverAdapterError?.cause?.originalCode ??
          (error as { meta?: { code?: unknown } })?.meta?.code;
        if (code === '23514' || code === '23505') throw new ConflictException();
        throw error;
      }
      return { activated: true, patientId: p };
    });
  }
}
