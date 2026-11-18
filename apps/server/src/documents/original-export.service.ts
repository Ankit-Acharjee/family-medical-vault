import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  isOriginalExportSelection,
  isOriginalExportRequest,
  maximumOriginalExportContentBytes,
  maximumOriginalExportArchiveBytes,
  isOriginalExportPreview,
} from '@fmv/contracts';
import type { OriginalExportPreview } from '@fmv/contracts';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PermissionService, isUuid } from '../access/permission.service.js';
import {
  TransactionAccessStore,
  lockAccessPatient,
} from '../access/transaction-access.store.js';
import type { Principal } from '../identity/person.store.js';
import { DocumentsService } from './documents.service.js';
import { zipBuffers } from '../archives/zip.js';
import { IntakeError } from './intake.js';
type Source = OriginalExportPreview['files'][number] & {
  patientId: string;
  categoryId: string;
  state: 'pending' | 'ready' | 'failed';
  deletedAt: Date | null;
  objectKey: string;
  lifecycle: number;
  active: boolean;
};
type Snapshot = { rows: Source[]; preview: OriginalExportPreview };
export async function originalArchive(
  snapshot: Snapshot,
  files: Buffer[],
  signal: AbortSignal,
) {
  const extensions = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  const manifest = {
    patientId: snapshot.preview.patientId,
    patientName: snapshot.preview.patientName,
    meaning: 'selected-originals',
    files: snapshot.preview.files.map((f) => ({
      ...f,
      path: `documents/${f.id}/original.${extensions[f.mimeType]}`,
    })),
  };
  const entries: [string, Buffer][] = manifest.files.map((f, i) => [
    f.path,
    files[i]!,
  ]);
  entries.push(
    ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')],
    [
      'README.txt',
      Buffer.from(
        'Private selected original documents. Original bytes are unchanged; manifest.json maps safe generated paths to titles and SHA-256 fingerprints. No extracted text or clinical interpretation is included. Downloaded copies cannot be revoked.\n',
      ),
    ],
  );
  return zipBuffers(entries, maximumOriginalExportArchiveBytes, signal);
}
export class OriginalExportService implements OnModuleDestroy {
  private readonly db: PrismaClient | null;
  private active = 0;
  constructor(
    url: string | null,
    private readonly documents: DocumentsService,
    private readonly archive: typeof originalArchive = originalArchive,
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
  private async snapshot(
    db: Prisma.TransactionClient,
    principal: Principal,
    p: string,
    ids: string[],
  ): Promise<Snapshot> {
    const rows = await db.$queryRaw<
      Source[]
    >`SELECT d.id,d.patient_id AS "patientId",d.category_id AS "categoryId",d.state,d.deleted_at AS "deletedAt",COALESCE(d.display_title,d.title) AS title,d.title AS "originalTitle",d.mime_type AS "mimeType",d.bytes,d.sha256,d.object_key AS "objectKey",d.extraction_lifecycle AS lifecycle,EXISTS(SELECT 1 FROM fmv.document_object_attempts a WHERE a.object_key=d.object_key AND a.document_id=d.id AND a.retired_at IS NULL) AS active FROM fmv.documents d WHERE d.patient_id=${p}::uuid AND d.id=ANY(${ids}::uuid[]) ORDER BY d.id FOR NO KEY UPDATE OF d`;
    const permissions = new PermissionService(new TransactionAccessStore(db)),
      auth = await permissions.snapshot(principal, p);
    if (
      rows.length !== ids.length ||
      rows.some(
        (d) =>
          d.state !== 'ready' ||
          d.deletedAt ||
          !d.active ||
          !permissions.allows(
            auth,
            'export',
            { kind: 'document', documentId: d.id },
            d,
          ),
      )
    )
      throw new NotFoundException();
    if (
      rows.reduce((n, d) => n + d.bytes, 0) > maximumOriginalExportContentBytes
    )
      throw new PayloadTooLargeException();
    const snapshotSha256 = createHash('sha256')
      .update(
        JSON.stringify({
          patientId: p,
          patientName: auth.patient!.displayName,
          rows,
        }),
      )
      .digest('hex');
    const preview: OriginalExportPreview = {
      patientId: p,
      patientName: auth.patient!.displayName,
      snapshotSha256,
      files: rows.map(
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
    return { rows, preview };
  }
  private async transaction<T>(
    p: string,
    work: (db: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!isUuid(p)) throw new NotFoundException();
    if (!this.db) throw new ServiceUnavailableException();
    return this.db.$transaction(
      async (db) => {
        await db.$executeRaw`SET LOCAL statement_timeout='8s'`;
        await lockAccessPatient(db, p);
        return work(db);
      },
      { maxWait: 5000, timeout: 15000 },
    );
  }
  private rethrow(error: unknown): never {
    if (
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof NotFoundException ||
      error instanceof PayloadTooLargeException ||
      error instanceof ServiceUnavailableException
    )
      throw error;
    if (error instanceof IntakeError) {
      if (error.status === 404) throw new NotFoundException();
    }
    throw new ServiceUnavailableException();
  }
  async prepare(principal: Principal, patientId: string, input: unknown) {
    if (!isOriginalExportSelection(input)) throw new BadRequestException();
    const p = patientId.toLowerCase();
    try {
      return (
        await this.transaction(p, (db) =>
          this.snapshot(
            db,
            principal,
            p,
            input.documentIds.map((id) => id.toLowerCase()),
          ),
        )
      ).preview;
    } catch (e) {
      this.rethrow(e);
    }
  }
  async export(
    principal: Principal,
    patientId: string,
    input: unknown,
    signal: AbortSignal,
  ) {
    if (!isOriginalExportRequest(input)) throw new BadRequestException();
    const p = patientId.toLowerCase(),
      ids = input.documentIds.map((id) => id.toLowerCase());
    let acquired = false;
    try {
      signal.throwIfAborted();
      const prepared = await this.transaction(p, async (db) => {
        const s = await this.snapshot(db, principal, p, ids);
        if (s.preview.snapshotSha256 !== input.snapshotSha256)
          throw new ConflictException();
        if (this.active >= 1) throw new ServiceUnavailableException();
        this.active++;
        acquired = true;
        return s;
      });
      const files: Buffer[] = [];
      for (const source of prepared.rows) {
        signal.throwIfAborted();
        const file = await this.documents.read(
          principal,
          p,
          source.id,
          'export',
        );
        signal.throwIfAborted();
        if (
          file.record.objectKey !== source.objectKey ||
          file.record.sha256 !== source.sha256 ||
          file.record.bytes !== source.bytes ||
          file.bytes.length !== source.bytes ||
          createHash('sha256').update(file.bytes).digest('hex') !==
            source.sha256
        )
          throw new ConflictException();
        files.push(file.bytes);
      }
      const bytes = await this.archive(prepared, files, signal);
      signal.throwIfAborted();
      await this.transaction(p, async (db) => {
        const current = await this.snapshot(db, principal, p, ids);
        if (current.preview.snapshotSha256 !== input.snapshotSha256)
          throw new ConflictException();
        signal.throwIfAborted();
      });
      return { bytes };
    } catch (e) {
      this.rethrow(e);
    } finally {
      if (acquired) this.active--;
    }
  }
}
