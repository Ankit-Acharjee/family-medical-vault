import { createHash, randomUUID } from 'node:crypto';
import {
  isExtractionResult,
  isMetadataSuggestionsReadResult,
  metadataSuggestionRuleVersion,
  suggestMetadata,
} from '@fmv/contracts';
import type {
  MetadataSuggestionsReadResult,
  SaveMetadataSuggestions,
  SaveMetadataSuggestionsResult,
} from '@fmv/contracts';
import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import type { ExtractionAuthorization } from './document.store.js';
import { extractionSource, latestExtraction } from './extraction.store.js';

type Row = {
  revision: number;
  sourceRevision: number;
  sourceSha256: string;
  lifecycleVersion: number;
  requestId: string;
  payloadHash: string;
  actorAccountId: string;
  ruleVersion: string;
  suggestions: unknown;
  savedAt: Date;
};
const options = { maxWait: 5000, timeout: 15000 };
async function latest(db: Prisma.TransactionClient, d: string) {
  const rows = await db.$queryRaw<
    Row[]
  >`SELECT revision,source_revision AS "sourceRevision",source_sha256 AS "sourceSha256",lifecycle_version AS "lifecycleVersion",request_id AS "requestId",payload_hash AS "payloadHash",actor_account_id AS "actorAccountId",rule_version AS "ruleVersion",suggestions,saved_at AS "savedAt" FROM fmv.document_metadata_snapshots WHERE document_id=${d}::uuid`;
  return rows[0] ?? null;
}
export function metadataFingerprint(i: SaveMetadataSuggestions) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        requestId: i.requestId.toLowerCase(),
        expectedRevision: i.expectedRevision,
        sourceRevision: i.sourceRevision,
        sourceSha256: i.sourceSha256,
        lifecycleVersion: i.lifecycleVersion,
        ruleVersion: i.ruleVersion,
      }),
    )
    .digest('hex');
}
export async function readMetadata(
  client: PrismaClient,
  p: string,
  d: string,
  authorize: ExtractionAuthorization,
): Promise<MetadataSuggestionsReadResult | null> {
  return client.$transaction(async (db) => {
    const original = await extractionSource(db, p, d);
    if (!original) return null;
    const actor = await authorize(original);
    const extraction = await latestExtraction(db, d);
    if (
      extraction &&
      (!isExtractionResult(extraction.result) ||
        extraction.sourceSha256 !== original.sha256)
    )
      throw new Error('Unavailable metadata');
    const row = await latest(db, d);
    const context = {
      sourceRevision: extraction?.revision ?? 0,
      sourceSha256: original.sha256,
      lifecycleVersion: original.lifecycleVersion,
      revision: row?.revision ?? 0,
      canSave: actor.canSave,
    };
    const visible =
      row &&
      extraction &&
      row.sourceRevision === extraction.revision &&
      row.sourceSha256 === original.sha256;
    const snapshot = visible
      ? {
          revision: row.revision,
          sourceRevision: row.sourceRevision,
          sourceSha256: row.sourceSha256,
          ruleVersion: row.ruleVersion,
          suggestions: row.suggestions,
          savedAt: row.savedAt.toISOString(),
          unverified: true as const,
        }
      : null;
    const result = { context, snapshot };
    if (!isMetadataSuggestionsReadResult(result))
      throw new Error('Unavailable metadata');
    if (snapshot)
      await db.$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) VALUES (${randomUUID()}::uuid,${p}::uuid,${d}::uuid,${actor.accountId}::uuid,'document.viewed')`;
    const current = await authorize(original);
    if (current.accountId !== actor.accountId)
      throw new Error('Unavailable metadata');
    return { ...result, context: { ...context, canSave: current.canSave } };
  }, options);
}
export async function saveMetadata(
  client: PrismaClient,
  p: string,
  d: string,
  input: SaveMetadataSuggestions,
  authorize: ExtractionAuthorization,
): Promise<SaveMetadataSuggestionsResult | 'missing' | 'conflict'> {
  return client.$transaction(async (db) => {
    const original = await extractionSource(db, p, d);
    if (!original) return 'missing';
    const actor = await authorize(original);
    if (!actor.canSave) throw new Error('Unavailable metadata');
    const extraction = await latestExtraction(db, d);
    if (
      !extraction ||
      extraction.revision !== input.sourceRevision ||
      extraction.sourceSha256 !== input.sourceSha256 ||
      original.sha256 !== input.sourceSha256 ||
      original.lifecycleVersion !== input.lifecycleVersion ||
      input.ruleVersion !== metadataSuggestionRuleVersion
    )
      return 'conflict';
    if (!isExtractionResult(extraction.result))
      throw new Error('Unavailable metadata');
    const row = await latest(db, d);
    const fingerprint = metadataFingerprint(input);
    if (row?.requestId === input.requestId.toLowerCase()) {
      if (
        row.actorAccountId !== actor.accountId ||
        row.payloadHash !== fingerprint ||
        row.lifecycleVersion !== original.lifecycleVersion ||
        row.sourceRevision !== extraction.revision
      )
        return 'conflict';
      const current = await authorize(original);
      if (!current.canSave || current.accountId !== actor.accountId)
        throw new Error('Unavailable metadata');
      return { saved: true, revision: row.revision };
    }
    if (
      (row?.revision ?? 0) !== input.expectedRevision ||
      (row?.revision ?? 0) === 2147483647
    )
      return 'conflict';
    const revision = (row?.revision ?? 0) + 1;
    const suggestions = JSON.stringify(
      suggestMetadata(extraction.result.pages, {
        truncatedFinalLine: extraction.result.partialReason === 'characters',
      }),
    );
    if (row) {
      await db.$executeRaw`UPDATE fmv.document_metadata_snapshots SET source_revision=${extraction.revision},source_sha256=${original.sha256},lifecycle_version=${original.lifecycleVersion},revision=${revision},request_id=${input.requestId}::uuid,payload_hash=${fingerprint},actor_account_id=${actor.accountId}::uuid,rule_version=${input.ruleVersion},suggestions=${suggestions}::jsonb WHERE document_id=${d}::uuid`;
    } else {
      await db.$executeRaw`INSERT INTO fmv.document_metadata_snapshots(document_id,patient_id,source_revision,source_sha256,lifecycle_version,revision,request_id,payload_hash,actor_account_id,rule_version,suggestions) VALUES (${d}::uuid,${p}::uuid,${extraction.revision},${original.sha256},${original.lifecycleVersion},${revision},${input.requestId}::uuid,${fingerprint},${actor.accountId}::uuid,${input.ruleVersion},${suggestions}::jsonb)`;
    }
    await db.$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) VALUES (${randomUUID()}::uuid,${p}::uuid,${d}::uuid,${actor.accountId}::uuid,'document.metadata_saved')`;
    const current = await authorize(original);
    if (!current.canSave || current.accountId !== actor.accountId)
      throw new Error('Unavailable metadata');
    return { saved: true, revision };
  }, options);
}
