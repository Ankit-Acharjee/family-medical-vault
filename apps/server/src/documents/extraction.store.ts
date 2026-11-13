import { createHash, randomUUID } from 'node:crypto';
import { isExtractionResult } from '@fmv/contracts';
import type {
  ExtractionReadResult,
  SaveExtraction,
  SaveExtractionResult,
  SavedExtraction,
} from '@fmv/contracts';
import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import type {
  ExtractionAuthorization,
  ExtractionSource,
} from './document.store.js';

type Row = {
  revision: number;
  sourceSha256: string;
  lifecycleVersion: number;
  requestId: string;
  payloadHash: string;
  actorAccountId: string;
  result: unknown;
  savedAt: Date;
};
const transactionOptions = { maxWait: 5000, timeout: 15000 };
async function source(
  db: Prisma.TransactionClient,
  patientId: string,
  documentId: string,
) {
  const rows = await db.$queryRaw<
    ExtractionSource[]
  >`SELECT id AS "documentId",patient_id AS "patientId",category_id AS "categoryId",mime_type AS "mimeType",state,deleted_at AS "deletedAt",sha256,extraction_lifecycle AS "lifecycleVersion" FROM fmv.documents WHERE patient_id=${patientId}::uuid AND id=${documentId}::uuid AND state='ready' AND deleted_at IS NULL FOR NO KEY UPDATE`;
  return rows[0] ?? null;
}
async function latest(db: Prisma.TransactionClient, documentId: string) {
  const rows = await db.$queryRaw<
    Row[]
  >`SELECT revision,source_sha256 AS "sourceSha256",lifecycle_version AS "lifecycleVersion",request_id AS "requestId",payload_hash AS "payloadHash",actor_account_id AS "actorAccountId",result,saved_at AS "savedAt" FROM fmv.document_extractions WHERE document_id=${documentId}::uuid`;
  return rows[0] ?? null;
}
export function extractionFingerprint(input: SaveExtraction) {
  const r = input.result;
  return createHash('sha256')
    .update(
      JSON.stringify({
        requestId: input.requestId.toLowerCase(),
        expectedRevision: input.expectedRevision,
        lifecycleVersion: input.lifecycleVersion,
        sourceSha256: input.sourceSha256,
        result: {
          method: r.method,
          engineVersion: r.engineVersion,
          pages: r.pages.map(({ page, text }) => ({ page, text })),
          partial: r.partial,
          partialReason: r.partialReason,
          downsized: r.downsized,
        },
      }),
    )
    .digest('hex');
}
export async function readExtraction(
  client: PrismaClient,
  patientId: string,
  documentId: string,
  authorize: ExtractionAuthorization,
  includeSnapshot = true,
): Promise<ExtractionReadResult | null> {
  return client.$transaction(async (db) => {
    const original = await source(db, patientId, documentId);
    if (!original) return null;
    const actor = await authorize(original);
    // Metadata acquisition never requires loading the saved clinical text.
    const saved = includeSnapshot ? await latest(db, documentId) : null;
    const revisions = includeSnapshot
      ? []
      : await db.$queryRaw<
          { revision: number }[]
        >`SELECT revision FROM fmv.document_extractions WHERE document_id=${documentId}::uuid`;
    const revision = saved?.revision ?? revisions[0]?.revision ?? 0;
    let snapshot: SavedExtraction | null = null;
    if (saved) {
      if (
        !isExtractionResult(saved.result) ||
        saved.sourceSha256 !== original.sha256
      )
        throw new Error('Unavailable extraction');
      snapshot = {
        ...saved.result,
        revision: saved.revision,
        sourceSha256: saved.sourceSha256,
        savedAt: saved.savedAt.toISOString(),
        unverified: true,
      };
      await db.$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) VALUES (${randomUUID()}::uuid,${patientId}::uuid,${documentId}::uuid,${actor.accountId}::uuid,'document.viewed')`;
    }
    const current = await authorize(original);
    if (current.accountId !== actor.accountId)
      throw new Error('Unavailable extraction');
    return {
      context: {
        sourceSha256: original.sha256,
        lifecycleVersion: original.lifecycleVersion,
        revision,
        canSave: current.canSave,
      },
      snapshot,
    };
  }, transactionOptions);
}
export async function saveExtraction(
  client: PrismaClient,
  patientId: string,
  documentId: string,
  input: SaveExtraction,
  authorize: ExtractionAuthorization,
): Promise<SaveExtractionResult | 'missing' | 'conflict'> {
  return client.$transaction(async (db) => {
    const original = await source(db, patientId, documentId);
    if (!original) return 'missing';
    const actor = await authorize(original);
    if (!actor.canSave) throw new Error('Unavailable extraction');
    const saved = await latest(db, documentId);
    if (
      original.sha256 !== input.sourceSha256 ||
      original.lifecycleVersion !== input.lifecycleVersion
    )
      return 'conflict';
    const fingerprint = extractionFingerprint(input);
    if (saved?.requestId === input.requestId.toLowerCase()) {
      if (
        saved.actorAccountId !== actor.accountId ||
        saved.payloadHash !== fingerprint ||
        saved.lifecycleVersion !== original.lifecycleVersion
      )
        return 'conflict';
      const current = await authorize(original);
      if (!current.canSave || current.accountId !== actor.accountId)
        throw new Error('Unavailable extraction');
      return { saved: true, revision: saved.revision };
    }
    if (
      (saved?.revision ?? 0) !== input.expectedRevision ||
      (saved?.revision ?? 0) === 2_147_483_647
    )
      return 'conflict';
    const revision = (saved?.revision ?? 0) + 1;
    const result = JSON.stringify(input.result);
    if (saved) {
      await db.$executeRaw`UPDATE fmv.document_extractions SET source_sha256=${original.sha256},lifecycle_version=${original.lifecycleVersion},revision=${revision},request_id=${input.requestId}::uuid,payload_hash=${fingerprint},actor_account_id=${actor.accountId}::uuid,result=${result}::jsonb WHERE document_id=${documentId}::uuid`;
    } else {
      await db.$executeRaw`INSERT INTO fmv.document_extractions(document_id,patient_id,source_sha256,lifecycle_version,revision,request_id,payload_hash,actor_account_id,result) VALUES (${documentId}::uuid,${patientId}::uuid,${original.sha256},${original.lifecycleVersion},${revision},${input.requestId}::uuid,${fingerprint},${actor.accountId}::uuid,${result}::jsonb)`;
    }
    await db.$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) VALUES (${randomUUID()}::uuid,${patientId}::uuid,${documentId}::uuid,${actor.accountId}::uuid,'document.extraction_saved')`;
    const current = await authorize(original);
    if (!current.canSave || current.accountId !== actor.accountId)
      throw new Error('Unavailable extraction');
    return { saved: true, revision };
  }, transactionOptions);
}
