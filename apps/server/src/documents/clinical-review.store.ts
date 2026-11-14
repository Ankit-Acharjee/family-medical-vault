import { createHash, randomUUID } from 'node:crypto';
import {
  extractLabFields,
  isClinicalReviewResult,
  isExtractionResult,
  isLabFieldCandidate,
  isReviewedLabFields,
  labFieldKeys,
} from '@fmv/contracts';
import type {
  ClinicalReviewResult,
  SaveClinicalReview,
  LabFieldCandidate,
  ReviewedLabFields,
} from '@fmv/contracts';
import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import type { ExtractionSource } from './document.store.js';
import { extractionSource, latestExtraction } from './extraction.store.js';
export type ClinicalAuthority = { accountId: string; canVerify: boolean };
export type ClinicalAuthorization = (
  source: ExtractionSource,
) => Promise<ClinicalAuthority>;
const options = { maxWait: 5000, timeout: 15000 };
type Row = {
  revision: number;
  sourceRevision: number;
  sourceSha256: string;
  requestId: string;
  payloadHash: string;
  actorAccountId: string;
  lifecycleVersion: number;
  items: unknown;
  extraction: unknown;
  ruleVersion: string;
  verifiedAt: Date;
};
async function latest(db: Prisma.TransactionClient, d: string) {
  const rows = await db.$queryRaw<
    Row[]
  >`SELECT revision,source_revision AS "sourceRevision",source_sha256 AS "sourceSha256",request_id AS "requestId",payload_hash AS "payloadHash",actor_account_id AS "actorAccountId",lifecycle_version AS "lifecycleVersion",items,source_context AS "extraction",rule_version AS "ruleVersion",verified_at AS "verifiedAt" FROM fmv.document_clinical_reviews WHERE document_id=${d}::uuid ORDER BY revision DESC LIMIT 1`;
  return rows[0] ?? null;
}
function fingerprint(i: SaveClinicalReview) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        requestId: i.requestId.toLowerCase(),
        expectedRevision: i.expectedRevision,
        sourceRevision: i.sourceRevision,
        sourceSha256: i.sourceSha256,
        lifecycleVersion: i.lifecycleVersion,
        confirmed: true,
        selections: i.selections.map((s) => ({
          candidateId: s.candidateId,
          fields: Object.fromEntries(labFieldKeys.map((k) => [k, s.fields[k]])),
        })),
      }),
    )
    .digest('hex');
}
export async function readClinicalReview(
  client: PrismaClient,
  p: string,
  d: string,
  authorize: ClinicalAuthorization,
): Promise<ClinicalReviewResult | null> {
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
      throw new Error('Unavailable clinical review');
    const candidates =
      extraction && isExtractionResult(extraction.result)
        ? extractLabFields(extraction.result.pages, {
            truncatedFinalLine:
              extraction.result.partialReason === 'characters',
          })
        : [];
    const row = await latest(db, d);
    const result = {
      context: {
        sourceRevision: extraction?.revision ?? 0,
        sourceSha256: original.sha256,
        lifecycleVersion: original.lifecycleVersion,
        revision: row?.revision ?? 0,
        canVerify: actor.canVerify,
      },
      candidates,
      snapshot: row
        ? {
            revision: row.revision,
            sourceRevision: row.sourceRevision,
            sourceSha256: row.sourceSha256,
            verifiedAt: row.verifiedAt.toISOString(),
            ruleVersion: row.ruleVersion,
            items: row.items,
            extraction: row.extraction,
            verified: true,
          }
        : null,
    };
    if (!isClinicalReviewResult(result))
      throw new Error('Unavailable clinical review');
    if (extraction || row)
      await db.$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) VALUES (${randomUUID()}::uuid,${p}::uuid,${d}::uuid,${actor.accountId}::uuid,'document.viewed')`;
    const current = await authorize(original);
    if (current.accountId !== actor.accountId)
      throw new Error('Unavailable clinical review');
    return {
      ...result,
      context: { ...result.context, canVerify: current.canVerify },
    };
  }, options);
}
export async function saveClinicalReview(
  client: PrismaClient,
  p: string,
  d: string,
  input: SaveClinicalReview,
  authorize: ClinicalAuthorization,
): Promise<{ saved: true; revision: number } | 'missing' | 'conflict'> {
  return client.$transaction(async (db) => {
    const original = await extractionSource(db, p, d);
    if (!original) return 'missing';
    const actor = await authorize(original);
    if (!actor.canVerify) throw new Error('Unavailable clinical review');
    const extraction = await latestExtraction(db, d);
    if (
      !extraction ||
      extraction.revision !== input.sourceRevision ||
      extraction.sourceSha256 !== input.sourceSha256 ||
      original.sha256 !== input.sourceSha256 ||
      original.lifecycleVersion !== input.lifecycleVersion
    )
      return 'conflict';
    if (!isExtractionResult(extraction.result))
      throw new Error('Unavailable clinical review');
    const row = await latest(db, d),
      hash = fingerprint(input);
    if (row?.requestId === input.requestId.toLowerCase()) {
      if (
        row.payloadHash !== hash ||
        row.actorAccountId !== actor.accountId ||
        row.lifecycleVersion !== original.lifecycleVersion
      )
        return 'conflict';
      const current = await authorize(original);
      if (!current.canVerify || current.accountId !== actor.accountId)
        throw new Error('Unavailable clinical review');
      return { saved: true, revision: row.revision };
    }
    if (
      (row?.revision ?? 0) !== input.expectedRevision ||
      (row?.revision ?? 0) === 2147483647
    )
      return 'conflict';
    const previousRequest = await db.$queryRaw<
      { exists: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM fmv.document_clinical_reviews WHERE document_id=${d}::uuid AND request_id=${input.requestId}::uuid) AS exists`;
    if (previousRequest[0]?.exists) return 'conflict';
    const candidates = extractLabFields(extraction.result.pages, {
      truncatedFinalLine: extraction.result.partialReason === 'characters',
    });
    const itemsById = new Map<
      string,
      { source: LabFieldCandidate; fields: ReviewedLabFields }
    >();
    if (row?.sourceRevision === extraction.revision) {
      if (!Array.isArray(row.items))
        throw new Error('Unavailable clinical review');
      for (const item of row.items) {
        if (
          !item ||
          typeof item !== 'object' ||
          !('source' in item) ||
          !('fields' in item) ||
          !isLabFieldCandidate(item.source) ||
          !isReviewedLabFields(item.fields)
        )
          throw new Error('Unavailable clinical review');
        if (!candidates.some((c) => c.id === item.source.id)) return 'conflict';
        itemsById.set(item.source.id, {
          source: item.source,
          fields: item.fields,
        });
      }
    }
    for (const selection of input.selections) {
      const source = candidates.find((c) => c.id === selection.candidateId);
      if (!source) return 'conflict';
      itemsById.set(source.id, { source, fields: selection.fields });
    }
    const items = [...itemsById.values()];
    const revision = (row?.revision ?? 0) + 1;
    // Append a new owner-confirmed set; prior confirmations remain immutable.
    await db.$executeRaw`INSERT INTO fmv.document_clinical_reviews(id,document_id,patient_id,revision,source_revision,source_sha256,lifecycle_version,request_id,payload_hash,actor_account_id,source_context,items) VALUES (${randomUUID()}::uuid,${d}::uuid,${p}::uuid,${revision},${extraction.revision},${original.sha256},${original.lifecycleVersion},${input.requestId}::uuid,${hash},${actor.accountId}::uuid,${JSON.stringify({ method: extraction.result.method, engineVersion: extraction.result.engineVersion, partial: extraction.result.partial, partialReason: extraction.result.partialReason, downsized: extraction.result.downsized })}::jsonb,${JSON.stringify(items)}::jsonb)`;
    await db.$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) VALUES (${randomUUID()}::uuid,${p}::uuid,${d}::uuid,${actor.accountId}::uuid,'document.clinical_verified')`;
    const current = await authorize(original);
    if (!current.canVerify || current.accountId !== actor.accountId)
      throw new Error('Unavailable clinical review');
    return { saved: true, revision };
  }, options);
}
