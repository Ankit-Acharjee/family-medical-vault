import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { createObjectKey } from './object-key.js';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { DocumentCategory } from '@fmv/contracts';
import type { IntakeStore, IntakeMetadata, IntakeRecord } from './intake.js';

export abstract class DocumentStore {
  abstract asActor(accountId: string): IntakeStore;
  abstract list(
    patientId: string,
  ): Promise<(IntakeRecord & { displayTitle?: string | null })[]>;
  abstract rename(
    patientId: string,
    documentId: string,
    title: string,
    accountId: string,
    authorize: () => Promise<void>,
  ): Promise<boolean>;
  abstract categories(): Promise<DocumentCategory[]>;
  abstract audit(
    patientId: string,
    documentId: string,
    accountId: string,
    kind: 'document.viewed' | 'document.exported',
  ): Promise<void>;
}
const columns = `id AS "documentId", upload_id AS "uploadId", patient_id AS "patientId", category_id AS "categoryId", title, mime_type AS "mimeType", bytes, sha256, idempotency_key AS "idempotencyKey", object_key AS "objectKey", state, created_at AS "createdAt"`;
// Column names are a static internal constant; all external values stay bound.
async function find(
  db: Prisma.TransactionClient,
  where: 'upload_id' | 'id' | 'idempotency_key',
  patientId: string,
  value: string,
) {
  const rows = await db.$queryRawUnsafe<IntakeRecord[]>(
    `SELECT ${columns} FROM fmv.documents WHERE patient_id=$1::uuid AND ${where}=$2${where === 'idempotency_key' ? '' : '::uuid'}`,
    patientId,
    value,
  );
  return rows[0] ?? null;
}
export class PrismaDocumentStore
  extends DocumentStore
  implements OnModuleDestroy
{
  private readonly db: PrismaClient;
  private readonly manifests: PrismaClient;
  constructor(url: string) {
    super();
    this.db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: url,
        options: '-c timezone=UTC',
        max: 3,
        connectionTimeoutMillis: 5000,
      }),
      log: [],
    });
    // Durable reservation/retirement cannot share a connection held by the
    // upload transaction. A dedicated small pool prevents nested starvation.
    this.manifests = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: url,
        options: '-c timezone=UTC',
        max: 1,
        connectionTimeoutMillis: 5000,
      }),
      log: [],
    });
  }
  asActor(accountId: string): IntakeStore {
    return {
      withLock: async <T>(
        key: string,
        work: (metadata: IntakeMetadata) => Promise<T>,
      ) =>
        this.db.$transaction(
          async (db) => {
            await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key},0))`;
            return work({
              resolveStorageScope: async (patientId) => {
                const rows = await db.$queryRaw<
                  { scope: string }[]
                >`SELECT replace(storage_namespace::text,'-','') AS scope FROM fmv.persons WHERE id=${patientId}::uuid`;
                return rows[0]?.scope ?? null;
              },
              resolveCategory: async (id) => {
                const rows = id
                  ? await db.$queryRaw<
                      { id: string }[]
                    >`SELECT id FROM fmv.document_categories WHERE id=${id}::uuid`
                  : await db.$queryRaw<
                      { id: string }[]
                    >`SELECT id FROM fmv.document_categories WHERE slug='unclassified'`;
                return rows[0]?.id ?? null;
              },
              findByIdempotency: (p, k) => find(db, 'idempotency_key', p, k),
              findUpload: (p, k) => find(db, 'upload_id', p, k),
              findDocument: (p, k) => find(db, 'id', p, k),
              create: async (r) => {
                await db.$executeRaw`INSERT INTO fmv.documents(id,upload_id,patient_id,category_id,title,mime_type,bytes,sha256,idempotency_key,object_key,state,created_at) VALUES (${r.documentId}::uuid,${r.uploadId}::uuid,${r.patientId}::uuid,${r.categoryId}::uuid,${r.title},${r.mimeType},${r.bytes},${r.sha256},${r.idempotencyKey},${r.objectKey},${r.state},${r.createdAt.toISOString()}::timestamptz)`;
                await db.$executeRaw`INSERT INTO fmv.document_object_attempts(object_key,document_id) VALUES (${r.objectKey},${r.documentId}::uuid)`;
              },
              reserveObject: async (documentId) => {
                const rows = await this.manifests.$queryRaw<
                  { scope: string }[]
                >`SELECT replace(p.storage_namespace::text,'-','') AS scope FROM fmv.documents d JOIN fmv.persons p ON p.id=d.patient_id WHERE d.id=${documentId}::uuid`;
                if (!rows[0]) throw new Error('Storage identity unavailable');
                const objectKey = createObjectKey(rows[0].scope, documentId);
                await this.manifests
                  .$executeRaw`INSERT INTO fmv.document_object_attempts(object_key,document_id) VALUES (${objectKey},${documentId}::uuid)`;
                return objectKey;
              },
              useObject: async (uploadId, objectKey) => {
                const changed =
                  await db.$executeRaw`UPDATE fmv.documents d SET object_key=${objectKey} WHERE upload_id=${uploadId}::uuid AND state<>'ready' AND EXISTS(SELECT 1 FROM fmv.document_object_attempts a WHERE a.object_key=${objectKey} AND a.document_id=d.id AND a.retired_at IS NULL)`;
                if (changed !== 1)
                  throw new Error('Object generation unavailable');
              },
              objectActive: async (objectKey) =>
                (
                  await db.$queryRaw<
                    { objectKey: string }[]
                  >`SELECT object_key AS "objectKey" FROM fmv.document_object_attempts WHERE object_key=${objectKey} AND retired_at IS NULL`
                ).length === 1,
              retireObject: async (documentId, objectKey) => {
                const changed = await this.manifests
                  .$executeRaw`UPDATE fmv.document_object_attempts a SET retired_at=COALESCE(retired_at,statement_timestamp()) WHERE a.object_key=${objectKey} AND a.document_id=${documentId}::uuid AND NOT EXISTS(SELECT 1 FROM fmv.documents d WHERE d.id=a.document_id AND d.object_key=a.object_key AND d.state='ready')`;
                if (changed !== 1)
                  throw new Error('Object generation unavailable');
              },
              setState: async (id, state) => {
                if (state === 'ready') {
                  const rows = await db.$queryRaw<
                    { active: boolean }[]
                  >`SELECT EXISTS(SELECT 1 FROM fmv.document_object_attempts a WHERE a.object_key=d.object_key AND a.document_id=d.id AND a.retired_at IS NULL) AS active FROM fmv.documents d WHERE upload_id=${id}::uuid`;
                  if (!rows[0]?.active)
                    throw new Error('Object generation unavailable');
                }
                const rows = await db.$queryRaw<
                  { id: string; patientId: string }[]
                >`UPDATE fmv.documents SET state=${state} WHERE upload_id=${id}::uuid AND state<>${state} RETURNING id,patient_id AS "patientId"`;
                if (state === 'ready' && rows[0])
                  await db.$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) VALUES (${randomUUID()}::uuid,${rows[0].patientId}::uuid,${rows[0].id}::uuid,${accountId}::uuid,'document.uploaded')`;
              },
            });
          },
          { maxWait: 5000, timeout: 60000 },
        ),
    };
  }
  async list(patientId: string) {
    return this.db.$queryRawUnsafe<
      (IntakeRecord & { displayTitle: string | null })[]
    >(
      `SELECT ${columns}, display_title AS "displayTitle" FROM fmv.documents WHERE patient_id=$1::uuid AND state='ready' ORDER BY created_at DESC,id`,
      patientId,
    );
  }
  async rename(
    patientId: string,
    documentId: string,
    title: string,
    accountId: string,
    authorize: () => Promise<void>,
  ) {
    return this.db.$transaction(async (db) => {
      const rows = await db.$queryRaw<
        { title: string; displayTitle: string | null }[]
      >`SELECT title,display_title AS "displayTitle" FROM fmv.documents WHERE patient_id=${patientId}::uuid AND id=${documentId}::uuid AND state='ready' FOR UPDATE`;
      if (!rows[0]) return false;
      await authorize();
      if ((rows[0].displayTitle ?? rows[0].title) !== title) {
        await db.$executeRaw`UPDATE fmv.documents SET display_title=${title} WHERE patient_id=${patientId}::uuid AND id=${documentId}::uuid AND state='ready'`;
        await db.$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) VALUES (${randomUUID()}::uuid,${patientId}::uuid,${documentId}::uuid,${accountId}::uuid,'document.renamed')`;
      }
      await authorize();
      return true;
    });
  }
  async categories() {
    return this.db.$queryRaw<
      DocumentCategory[]
    >`SELECT id,name FROM fmv.document_categories ORDER BY name,id`;
  }
  async audit(
    patientId: string,
    documentId: string,
    accountId: string,
    kind: 'document.viewed' | 'document.exported',
  ) {
    await this.db
      .$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) VALUES (${randomUUID()}::uuid,${patientId}::uuid,${documentId}::uuid,${accountId}::uuid,${kind})`;
  }
  async onModuleDestroy() {
    await Promise.all([this.db.$disconnect(), this.manifests.$disconnect()]);
  }
}
