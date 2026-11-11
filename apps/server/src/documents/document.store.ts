import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { DocumentCategory } from '@fmv/contracts';
import type { IntakeStore, IntakeMetadata, IntakeRecord } from './intake.js';

export abstract class DocumentStore {
  abstract asActor(accountId: string): IntakeStore;
  abstract list(patientId: string): Promise<IntakeRecord[]>;
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
              },
              setState: async (id, state) => {
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
    return this.db.$queryRawUnsafe<IntakeRecord[]>(
      `SELECT ${columns} FROM fmv.documents WHERE patient_id=$1::uuid AND state='ready' ORDER BY created_at DESC,id`,
      patientId,
    );
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
    await this.db.$disconnect();
  }
}
