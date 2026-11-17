import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  isManualReadingCursor,
  isManualReadingEntry,
  isManualReadingHistory,
  isManualReadingsPage,
  isSaveManualReading,
  isWithdrawManualReading,
} from '@fmv/contracts';
import type {
  ManualReading,
  ManualReadingEntry,
  ManualReadingCursor,
  ManualReadingHistory,
  ManualReadingsPage,
  SaveManualReading,
  WithdrawManualReading,
} from '@fmv/contracts';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { Principal } from '../identity/person.store.js';
import { PermissionService, isUuid } from '../access/permission.service.js';
import {
  TransactionAccessStore,
  lockAccessPatient,
} from '../access/transaction-access.store.js';
type Tx = Prisma.TransactionClient;
type Row = {
  id: string;
  readingId: string;
  patientId: string;
  revision: number;
  action: ManualReadingEntry['action'];
  requestId: string;
  payloadHash: string;
  actorAccountId: string;
  reading: ManualReading;
  recordedAt: Date;
};
const canonical = (r: ManualReading) => ({
  kind: r.kind,
  unit: r.unit,
  observedAt: r.observedAt,
  values:
    r.kind === 'blood-pressure'
      ? { systolic: r.values.systolic, diastolic: r.values.diastolic }
      : { value: r.values.value },
});
const entry = (r: Row): ManualReadingEntry => ({
  readingId: r.readingId,
  patientId: r.patientId,
  revision: r.revision,
  action: r.action,
  reading: r.reading,
  recordedAt: r.recordedAt.toISOString(),
  provenance: 'manual',
});
export class ManualReadingsService implements OnModuleDestroy {
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
      snapshot = await permissions.snapshot(principal, p);
    const owner = snapshot.patient?.ownerAccountId === snapshot.accountId;
    if (
      !permissions.allows(snapshot, 'view', { kind: 'patient' }) ||
      (write && !owner)
    )
      throw new NotFoundException();
    return { accountId: snapshot.accountId!, owner };
  }
  private async latest(db: Tx, id: string) {
    const rows = await db.$queryRaw<
      Row[]
    >`SELECT id,reading_id AS "readingId",patient_id AS "patientId",revision,action,request_id AS "requestId",payload_hash AS "payloadHash",actor_account_id AS "actorAccountId",reading,recorded_at AS "recordedAt" FROM fmv.manual_measurements WHERE reading_id=${id}::uuid ORDER BY revision DESC LIMIT 1`;
    const row = rows[0];
    if (row && !isManualReadingEntry(entry(row)))
      throw new ServiceUnavailableException();
    return row;
  }
  private async audit(
    db: Tx,
    p: string,
    actor: string,
    rows: Row[],
    kind: string,
  ) {
    for (const r of rows)
      await db.$executeRaw`INSERT INTO fmv.manual_measurement_events(id,patient_id,reading_id,entry_id,actor_account_id,kind) VALUES(${randomUUID()}::uuid,${p}::uuid,${r.readingId}::uuid,${r.id}::uuid,${actor}::uuid,${kind})`;
  }
  async list(principal: Principal, patientId: string, query: unknown = {}) {
    const p = patientId.toLowerCase();
    return this.tx(p, async (db) => {
      const actor = await this.auth(db, principal, p);
      if (
        !query ||
        typeof query !== 'object' ||
        Array.isArray(query) ||
        Object.keys(query).some((k) => k !== 'cursor')
      )
        throw new BadRequestException();
      const raw = (query as Record<string, unknown>).cursor;
      let cursor: ManualReadingCursor | null = null;
      if (raw !== undefined) {
        if (typeof raw !== 'string' || raw.length > 180)
          throw new BadRequestException();
        try {
          cursor = JSON.parse(raw) as ManualReadingCursor;
        } catch {
          throw new BadRequestException();
        }
        if (!isManualReadingCursor(cursor)) throw new BadRequestException();
      }
      const stamp = cursor?.recordedAt ?? '1970-01-01T00:00:00.000Z',
        id = cursor?.readingId ?? '00000000-0000-4000-8000-000000000000';
      const rows = await db.$queryRaw<
        Row[]
      >`WITH latest AS(SELECT DISTINCT ON(reading_id) id,reading_id AS "readingId",patient_id AS "patientId",revision,action,request_id AS "requestId",payload_hash AS "payloadHash",actor_account_id AS "actorAccountId",reading,recorded_at AS "recordedAt" FROM fmv.manual_measurements WHERE patient_id=${p}::uuid ORDER BY reading_id,revision DESC) SELECT * FROM latest WHERE (${cursor === null} OR ("recordedAt","readingId")<(${stamp}::timestamptz,${id}::uuid)) ORDER BY "recordedAt" DESC,"readingId" DESC LIMIT 21`;
      const visible = rows.slice(0, 20),
        last = visible.at(-1);
      const result: ManualReadingsPage = {
        patientId: p,
        canWrite: actor.owner,
        entries: visible.map(entry),
        nextCursor:
          rows.length > 20 && last
            ? {
                recordedAt: last.recordedAt.toISOString(),
                readingId: last.readingId,
              }
            : null,
      };
      if (!isManualReadingsPage(result))
        throw new ServiceUnavailableException();
      await this.audit(db, p, actor.accountId, visible, 'manual.viewed');
      result.canWrite = (await this.auth(db, principal, p)).owner;
      return result;
    });
  }
  async history(
    principal: Principal,
    patientId: string,
    readingId: string,
    query: unknown = {},
  ) {
    const p = patientId.toLowerCase(),
      id = readingId.toLowerCase();
    return this.tx(p, async (db) => {
      const actor = await this.auth(db, principal, p);
      if (!isUuid(id)) throw new NotFoundException();
      const row = await this.latest(db, id);
      if (!row || row.patientId !== p) throw new NotFoundException();
      if (
        !query ||
        typeof query !== 'object' ||
        Array.isArray(query) ||
        Object.keys(query).some((k) => k !== 'beforeRevision')
      )
        throw new BadRequestException();
      const raw = (query as Record<string, unknown>).beforeRevision;
      const before =
        raw === undefined
          ? row.revision
          : typeof raw === 'string' &&
              /^[1-9][0-9]{0,9}$/.test(raw) &&
              String(Number(raw)) === raw
            ? Number(raw)
            : 0;
      if (before < 1 || before > 2147483647) throw new BadRequestException();
      const rows = await db.$queryRaw<
        Row[]
      >`SELECT id,reading_id AS "readingId",patient_id AS "patientId",revision,action,request_id AS "requestId",payload_hash AS "payloadHash",actor_account_id AS "actorAccountId",reading,recorded_at AS "recordedAt" FROM fmv.manual_measurements WHERE patient_id=${p}::uuid AND reading_id=${id}::uuid AND revision<=${before} ORDER BY revision DESC LIMIT 21`;
      const visible = rows.slice(0, 20);
      const result: ManualReadingHistory = {
        current: entry(row),
        canWrite: actor.owner && row.action !== 'withdrawal',
        history: visible.map(entry),
        nextBeforeRevision:
          rows.length > 20 ? visible.at(-1)!.revision - 1 : null,
      };
      if (!isManualReadingHistory(result))
        throw new ServiceUnavailableException();
      await this.audit(
        db,
        p,
        actor.accountId,
        [...new Map([row, ...visible].map((r) => [r.id, r])).values()],
        'manual.viewed',
      );
      result.canWrite =
        (await this.auth(db, principal, p)).owner &&
        row.action !== 'withdrawal';
      return result;
    });
  }
  async save(principal: Principal, p: string, id: string, input: unknown) {
    return this.write(principal, p, id, input, false);
  }
  async withdraw(principal: Principal, p: string, id: string, input: unknown) {
    return this.write(principal, p, id, input, true);
  }
  private async write(
    principal: Principal,
    patientId: string,
    readingId: string,
    input: unknown,
    withdraw: boolean,
  ) {
    const p = patientId.toLowerCase(),
      id = readingId.toLowerCase();
    return this.tx(p, async (db) => {
      const actor = await this.auth(db, principal, p, true);
      if (!isUuid(id)) throw new NotFoundException();
      if (
        !(withdraw
          ? isWithdrawManualReading(input)
          : isSaveManualReading(input))
      )
        throw new BadRequestException();
      const body = input as SaveManualReading | WithdrawManualReading;
      await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'manual-reading:' + id},0))`;
      const row = await this.latest(db, id);
      if (row && row.patientId !== p) throw new NotFoundException();
      if (withdraw && !row) throw new NotFoundException();
      const action = withdraw
        ? 'withdrawal'
        : body.expectedRevision === 0
          ? 'record'
          : 'correction';
      const reading = canonical(
        'reading' in body ? body.reading : row!.reading,
      ) as ManualReading;
      const hash = createHash('sha256')
        .update(
          JSON.stringify({
            action,
            expectedRevision: body.expectedRevision,
            confirmed: true,
            reading,
          }),
        )
        .digest('hex');
      const requestId = body.requestId.toLowerCase();
      if (row?.requestId === requestId) {
        if (
          row.payloadHash === hash &&
          row.actorAccountId === actor.accountId &&
          row.action === action
        )
          return { saved: true as const, revision: row.revision };
        throw new ConflictException();
      }
      const [used] = await db.$queryRaw<
        { present: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM fmv.manual_measurements WHERE reading_id=${id}::uuid AND request_id=${requestId}::uuid) AS present`;
      if (
        used?.present ||
        body.expectedRevision !== (row?.revision ?? 0) ||
        body.expectedRevision === 2147483647 ||
        row?.action === 'withdrawal' ||
        (row && reading.kind !== row.reading.kind)
      )
        throw new ConflictException();
      const revision = body.expectedRevision + 1,
        eventId = randomUUID();
      await db.$executeRaw`INSERT INTO fmv.manual_measurements(id,reading_id,patient_id,revision,action,request_id,payload_hash,actor_account_id,reading) VALUES(${eventId}::uuid,${id}::uuid,${p}::uuid,${revision},${action},${requestId}::uuid,${hash},${actor.accountId}::uuid,${JSON.stringify(reading)}::jsonb)`;
      await this.audit(
        db,
        p,
        actor.accountId,
        [{ id: eventId, readingId: id } as Row],
        action === 'record'
          ? 'manual.recorded'
          : action === 'correction'
            ? 'manual.corrected'
            : 'manual.withdrawn',
      );
      await this.auth(db, principal, p, true);
      return { saved: true as const, revision };
    });
  }
}
