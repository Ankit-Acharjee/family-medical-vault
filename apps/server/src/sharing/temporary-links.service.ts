import { validateBytes } from '../documents/intake.js';
import { UnavailableObjectStore } from '../documents/object-store.js';
import type { ObjectStore } from '../documents/object-store.js';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  isCreateTemporaryLink,
  isOriginalExportSelection,
  isOriginalExportPreview,
} from '@fmv/contracts';
import type { TemporaryLinkSummary } from '@fmv/contracts';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { opaque, digest, validOpaque } from '../auth/auth.crypto.js';
import { PermissionService, isUuid } from '../access/permission.service.js';
import {
  TransactionAccessStore,
  lockAccessPatient,
  transactionClock,
} from '../access/transaction-access.store.js';
import type { Principal } from '../identity/person.store.js';
import { readOriginalSelection } from '../documents/original-export.service.js';
type Tx = Prisma.TransactionClient;
type Link = {
  id: string;
  patientId: string;
  creatorId: string;
  patientName: string;
  requestId: string;
  payloadHash: string;
  selectionHash: string;
  sources: Awaited<ReturnType<typeof readOriginalSelection>>['rows'];
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  current: boolean;
};
const columns = `l.id,l.patient_id AS "patientId",l.creator_account_id AS "creatorId",l.patient_name AS "patientName",l.request_id AS "requestId",l.payload_sha256 AS "payloadHash",l.selection_sha256 AS "selectionHash",l.source_snapshot AS sources,l.created_at AS "createdAt",l.expires_at AS "expiresAt",l.revoked_at AS "revokedAt",(EXISTS(SELECT 1 FROM fmv.persons p WHERE p.id=l.patient_id AND p.owner_account_id=l.creator_account_id AND p.display_name=l.patient_name) AND fmv.share_sources_current(l.patient_id,l.source_snapshot)) AS current`;
export const hashTemporaryLink = (token: unknown) =>
  validOpaque(token) ? digest(`fmv-temporary-link-v1:${token}`) : null;
function summary(row: Link, now: Date): TemporaryLinkSummary {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    state: row.revokedAt
      ? 'revoked'
      : row.expiresAt <= now
        ? 'expired'
        : !row.current
          ? 'source-invalid'
          : 'active',
    documentIds: row.sources.map((s) => s.id),
  };
}
export class TemporaryLinksService implements OnModuleDestroy {
  private readonly db: PrismaClient | null;
  private activeReads = 0;
  constructor(
    url: string | null,
    private readonly objects: ObjectStore = new UnavailableObjectStore(),
  ) {
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
  private async transaction<T>(
    p: string,
    work: (db: Tx) => Promise<T>,
  ): Promise<T> {
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
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException();
    }
  }
  private async owner(db: Tx, principal: Principal, p: string) {
    const permissions = new PermissionService(new TransactionAccessStore(db)),
      s = await permissions.snapshot(principal, p);
    if (s.patient!.ownerAccountId !== s.accountId)
      throw new NotFoundException();
    return s.accountId!;
  }
  private async row(db: Tx, p: string, id: string) {
    return (
      (
        await db.$queryRawUnsafe<Link[]>(
          `SELECT ${columns} FROM fmv.temporary_links l WHERE l.patient_id=$1::uuid AND l.id=$2::uuid FOR NO KEY UPDATE OF l`,
          p,
          id,
        )
      )[0] ?? null
    );
  }
  async prepare(principal: Principal, patientId: string, input: unknown) {
    if (!isOriginalExportSelection(input)) throw new BadRequestException();
    const p = patientId.toLowerCase();
    return this.transaction(p, async (db) => {
      await this.owner(db, principal, p);
      const selection = await readOriginalSelection(
        db,
        principal,
        p,
        input.documentIds.map((id) => id.toLowerCase()),
      );
      await this.owner(db, principal, p);
      return selection.preview;
    });
  }
  async create(principal: Principal, patientId: string, input: unknown) {
    if (!isCreateTemporaryLink(input)) throw new BadRequestException();
    const p = patientId.toLowerCase(),
      ids = input.documentIds.map((id) => id.toLowerCase()).sort(),
      payloadHash = digest(
        JSON.stringify({
          ids,
          expiresInHours: input.expiresInHours,
          selectionHash: input.selectionSha256,
        }),
      );
    return this.transaction(p, async (db) => {
      const account = await this.owner(db, principal, p),
        existing = (
          await db.$queryRawUnsafe<Link[]>(
            `SELECT ${columns} FROM fmv.temporary_links l WHERE l.patient_id=$1::uuid AND l.request_id=$2::uuid FOR NO KEY UPDATE OF l`,
            p,
            input.requestId,
          )
        )[0];
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new ConflictException();
        await this.owner(db, principal, p);
        return {
          link: summary(existing, await transactionClock(db)),
          token: null,
          created: false,
        };
      }
      const selection = await readOriginalSelection(db, principal, p, ids);
      if (selection.preview.snapshotSha256 !== input.selectionSha256)
        throw new ConflictException();
      const count = (
        await db.$queryRaw<
          { n: number }[]
        >`SELECT count(*)::int AS n FROM fmv.temporary_links WHERE patient_id=${p}::uuid AND revoked_at IS NULL AND expires_at>clock_timestamp()`
      )[0]!.n;
      if (count >= 20) throw new ConflictException();
      const now = await transactionClock(db),
        expires = new Date(now.getTime() + input.expiresInHours * 3600000),
        id = randomUUID(),
        token = opaque();
      await db.$executeRaw`INSERT INTO fmv.temporary_links(id,patient_id,creator_account_id,patient_name,request_id,payload_sha256,token_sha256,selection_sha256,source_snapshot,expires_at) VALUES(${id}::uuid,${p}::uuid,${account}::uuid,${selection.preview.patientName},${input.requestId}::uuid,${payloadHash},${hashTemporaryLink(token)},${input.selectionSha256},${JSON.stringify(selection.rows)}::jsonb,${expires}::timestamptz)`;
      await this.owner(db, principal, p);
      const row = await this.row(db, p, id);
      if (!row || !row.current) throw new ConflictException();
      return {
        link: summary(row, await transactionClock(db)),
        token,
        created: true,
      };
    });
  }
  async list(principal: Principal, patientId: string) {
    const p = patientId.toLowerCase();
    return this.transaction(p, async (db) => {
      await this.owner(db, principal, p);
      const rows = await db.$queryRawUnsafe<Link[]>(
        `SELECT ${columns} FROM fmv.temporary_links l WHERE l.patient_id=$1::uuid ORDER BY (l.revoked_at IS NULL AND l.expires_at>clock_timestamp()) DESC,l.created_at DESC,l.id DESC LIMIT 51`,
        p,
      );
      await this.owner(db, principal, p);
      const now = await transactionClock(db);
      return {
        patientId: p,
        links: rows.slice(0, 50).map((row) => summary(row, now)),
        limited: rows.length > 50,
      };
    });
  }
  async activity(principal: Principal, patientId: string, id: string) {
    if (!isUuid(id)) throw new NotFoundException();
    const p = patientId.toLowerCase();
    return this.transaction(p, async (db) => {
      await this.owner(db, principal, p);
      if (!(await this.row(db, p, id.toLowerCase())))
        throw new NotFoundException();
      const rows = await db.$queryRaw<
        {
          id: string;
          documentId: string | null;
          kind: 'link.opened' | 'original.accessed';
          recordedAt: Date;
        }[]
      >`SELECT id,document_id AS "documentId",kind,recorded_at AS "recordedAt" FROM fmv.temporary_link_access_events WHERE link_id=${id.toLowerCase()}::uuid AND retention_until>clock_timestamp() ORDER BY recorded_at DESC,id DESC LIMIT 21`;
      await this.owner(db, principal, p);
      return {
        patientId: p,
        linkId: id.toLowerCase(),
        events: rows
          .slice(0, 20)
          .map((row) => ({ ...row, recordedAt: row.recordedAt.toISOString() })),
        limited: rows.length > 20,
      };
    });
  }
  async revoke(principal: Principal, patientId: string, id: string) {
    if (!isUuid(id)) throw new NotFoundException();
    const p = patientId.toLowerCase();
    return this.transaction(p, async (db) => {
      const account = await this.owner(db, principal, p),
        row = await this.row(db, p, id.toLowerCase());
      if (!row) throw new NotFoundException();
      if (!row.revokedAt)
        await db.$executeRaw`UPDATE fmv.temporary_links SET revoked_at=date_trunc('milliseconds',clock_timestamp()),revoker_account_id=${account}::uuid WHERE id=${row.id}::uuid AND patient_id=${p}::uuid`;
      await this.owner(db, principal, p);
      return { revoked: true };
    });
  }
  private async capability(db: Tx, p: string, id: string) {
    const initial = await this.row(db, p, id);
    if (!initial) throw new NotFoundException();
    const ids = initial.sources.map((s) => s.id);
    await db.$queryRaw`SELECT id FROM fmv.documents WHERE patient_id=${p}::uuid AND id=ANY(${ids}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
    const row = await this.row(db, p, id),
      now = await transactionClock(db);
    if (!row || row.revokedAt || row.expiresAt <= now || !row.current)
      throw new NotFoundException();
    return row;
  }
  async readOriginal(token: unknown, documentId: string, signal: AbortSignal) {
    const hash = hashTemporaryLink(token);
    if (!hash || !isUuid(documentId)) throw new NotFoundException();
    if (!this.db) throw new ServiceUnavailableException();
    let acquired = false;
    try {
      signal.throwIfAborted();
      const found = (
        await this.db.$queryRawUnsafe<Link[]>(
          `SELECT ${columns} FROM fmv.temporary_links l WHERE l.token_sha256=$1`,
          hash,
        )
      )[0];
      if (!found) throw new NotFoundException();
      const source = await this.transaction(found.patientId, async (db) => {
        const row = await this.capability(db, found.patientId, found.id),
          source = row.sources.find((s) => s.id === documentId.toLowerCase());
        if (!source) throw new NotFoundException();
        if (this.activeReads >= 1) throw new ServiceUnavailableException();
        this.activeReads++;
        acquired = true;
        return source;
      });
      if (!this.objects.ready) throw new ServiceUnavailableException();
      signal.throwIfAborted();
      const bytes = await this.objects.get(source.objectKey);
      signal.throwIfAborted();
      validateBytes(bytes, source);
      await this.transaction(found.patientId, async (db) => {
        await this.capability(db, found.patientId, found.id);
        await db.$executeRaw`INSERT INTO fmv.temporary_link_access_events(id,link_id,document_id,kind) VALUES(${randomUUID()}::uuid,${found.id}::uuid,${source.id}::uuid,'original.accessed')`;
        await this.capability(db, found.patientId, found.id);
        signal.throwIfAborted();
      });
      return { bytes, mimeType: source.mimeType };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException();
    } finally {
      if (acquired) this.activeReads--;
    }
  }
  /** Current capability metadata; every use still revalidates authority and sources. */
  async inspect(token: unknown) {
    const hash = hashTemporaryLink(token);
    if (!hash) throw new NotFoundException();
    if (!this.db) throw new ServiceUnavailableException();
    let found: Link | undefined;
    try {
      found = (
        await this.db.$queryRawUnsafe<Link[]>(
          `SELECT ${columns} FROM fmv.temporary_links l WHERE l.token_sha256=$1`,
          hash,
        )
      )[0];
    } catch {
      throw new ServiceUnavailableException();
    }
    if (!found) throw new NotFoundException();
    return this.transaction(found.patientId, async (db) => {
      const row = await this.capability(db, found!.patientId, found!.id);
      await db.$executeRaw`INSERT INTO fmv.temporary_link_access_events(id,link_id,kind) VALUES(${randomUUID()}::uuid,${row.id}::uuid,'link.opened')`;
      await this.capability(db, row.patientId, row.id);
      const preview = {
        patientId: row.patientId,
        patientName: row.patientName,
        snapshotSha256: row.selectionHash,
        files: row.sources.map(
          ({ id, title, originalTitle, mimeType, bytes, sha256 }) => ({
            id,
            title,
            originalTitle,
            mimeType,
            bytes,
            sha256,
          }),
        ),
      };
      if (!isOriginalExportPreview(preview))
        throw new ServiceUnavailableException();
      return {
        linkId: row.id,
        expiresAt: row.expiresAt.toISOString(),
        selection: preview,
      };
    });
  }
}
