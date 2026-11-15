import { createHash, randomUUID } from 'node:crypto';
import {
  extractMedicationFields,
  medicationFieldsEqual,
  isMedicationReviewResult,
  isMedicationHistoryResult,
  isMedicationCandidate,
  isExtractionResult,
} from '@fmv/contracts';
import type {
  MedicationReviewResult,
  MedicationHistoryResult,
  MedicationReviewSnapshot,
  SaveMedicationReview,
  WithdrawMedicationReview,
  MedicationCandidate,
} from '@fmv/contracts';
import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import type { ClinicalAuthorization } from './clinical-review.store.js';
import { extractionSource, latestExtraction } from './extraction.store.js';
const options = { maxWait: 5000, timeout: 15000 };
type Row = {
  revision: number;
  sourceRevision: number;
  sourceSha256: string;
  lifecycleVersion: number;
  requestId: string;
  payloadHash: string;
  actorAccountId: string;
  sourceContext: unknown;
  statements: unknown;
  withdrawnStatements: unknown;
  action: 'confirmation' | 'withdrawal';
  meaning: 'source-fields-only';
  ruleVersion: 'labeled-medication-blocks-v1';
  confirmedAt: Date;
};
async function row(db: Prisma.TransactionClient, d: string, before?: number) {
  const rows = await db.$queryRaw<
    Row[]
  >`SELECT revision,source_revision AS "sourceRevision",source_sha256 AS "sourceSha256",lifecycle_version AS "lifecycleVersion",request_id AS "requestId",payload_hash AS "payloadHash",actor_account_id AS "actorAccountId",source_context AS "sourceContext",statements,withdrawn_statements AS "withdrawnStatements",action,meaning,rule_version AS "ruleVersion",confirmed_at AS "confirmedAt" FROM fmv.document_medication_reviews WHERE document_id=${d}::uuid AND revision<=${before === undefined ? 2147483647 : before - 1} ORDER BY revision DESC LIMIT 1`;
  return rows[0] ?? null;
}
function snapshot(r: Row) {
  return {
    revision: r.revision,
    sourceRevision: r.sourceRevision,
    sourceSha256: r.sourceSha256,
    confirmedAt: r.confirmedAt.toISOString(),
    action: r.action,
    meaning: r.meaning,
    ruleVersion: r.ruleVersion,
    extraction: r.sourceContext,
    statements: r.statements,
    withdrawnStatements: r.withdrawnStatements,
  } as MedicationReviewSnapshot;
}
export async function readMedicationReview(
  client: PrismaClient,
  p: string,
  d: string,
  authorize: ClinicalAuthorization,
): Promise<MedicationReviewResult | null>;
export async function readMedicationReview(
  client: PrismaClient,
  p: string,
  d: string,
  authorize: ClinicalAuthorization,
  before: number,
): Promise<MedicationHistoryResult | null>;
export async function readMedicationReview(
  client: PrismaClient,
  p: string,
  d: string,
  authorize: ClinicalAuthorization,
  before?: number,
): Promise<MedicationReviewResult | MedicationHistoryResult | null> {
  return client.$transaction(async (db) => {
    const original = await extractionSource(db, p, d);
    if (!original) return null;
    const actor = await authorize(original),
      e = await latestExtraction(db, d);
    if (
      e &&
      (!isExtractionResult(e.result) || e.sourceSha256 !== original.sha256)
    )
      throw Error('Unavailable medication source');
    const latest = await row(db, d),
      target = before === undefined ? latest : await row(db, d, before);
    const context = {
      sourceRevision: e?.revision ?? 0,
      sourceSha256: original.sha256,
      lifecycleVersion: original.lifecycleVersion,
      revision: latest?.revision ?? 0,
      canVerify: actor.canVerify,
    };
    let result: MedicationReviewResult | MedicationHistoryResult;
    if (before === undefined) {
      result = {
        context,
        candidates:
          e && isExtractionResult(e.result)
            ? extractMedicationFields(e.result.pages, {
                truncatedFinalLine: e.result.partialReason === 'characters',
              })
            : [],
        snapshot: target ? snapshot(target) : null,
      };
      if (!isMedicationReviewResult(result))
        throw Error('Unavailable medication review');
    } else {
      const older = target ? await row(db, d, target.revision) : null;
      result = {
        context,
        snapshot: target ? snapshot(target) : null,
        nextBefore: older && target ? target.revision : null,
      };
      if (!isMedicationHistoryResult(result))
        throw Error('Unavailable medication history');
    }
    if (target || e)
      await db.$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) VALUES (${randomUUID()}::uuid,${p}::uuid,${d}::uuid,${actor.accountId}::uuid,'document.viewed')`;
    const final = await authorize(original);
    if (final.accountId !== actor.accountId)
      throw Error('Unavailable medication review');
    return { ...result, context: { ...context, canVerify: final.canVerify } };
  }, options);
}
export async function writeMedicationReview(
  client: PrismaClient,
  p: string,
  d: string,
  input: SaveMedicationReview | WithdrawMedicationReview,
  action: 'confirmation' | 'withdrawal',
  authorize: ClinicalAuthorization,
): Promise<{ saved: true; revision: number } | 'missing' | 'conflict'> {
  return client.$transaction(async (db) => {
    const original = await extractionSource(db, p, d);
    if (!original) return 'missing';
    const actor = await authorize(original);
    if (!actor.canVerify) throw Error('Unavailable medication review');
    if (
      original.sha256 !== input.sourceSha256 ||
      original.lifecycleVersion !== input.lifecycleVersion
    )
      return 'conflict';
    const e = action === 'confirmation' ? await latestExtraction(db, d) : null;
    if (
      action === 'confirmation' &&
      (!('sourceRevision' in input) ||
        !e ||
        e.revision !== input.sourceRevision ||
        e.sourceSha256 !== original.sha256)
    )
      return 'conflict';
    if (e && !isExtractionResult(e.result))
      throw Error('Unavailable medication source');
    const previous = await row(db, d);
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          action,
          requestId: input.requestId.toLowerCase(),
          expectedRevision: input.expectedRevision,
          sourceRevision:
            'sourceRevision' in input ? input.sourceRevision : null,
          sourceSha256: input.sourceSha256,
          lifecycleVersion: input.lifecycleVersion,
          confirmed: true,
          meaning: input.meaning,
          candidateIds: [...input.candidateIds].sort(),
        }),
      )
      .digest('hex');
    if (previous?.requestId === input.requestId.toLowerCase()) {
      if (
        previous.action !== action ||
        previous.payloadHash !== hash ||
        previous.actorAccountId !== actor.accountId ||
        previous.lifecycleVersion !== original.lifecycleVersion
      )
        return 'conflict';
      const final = await authorize(original);
      if (!final.canVerify || final.accountId !== actor.accountId)
        throw Error('Unavailable medication review');
      return { saved: true, revision: previous.revision };
    }
    if (
      (previous?.revision ?? 0) !== input.expectedRevision ||
      (previous?.revision ?? 0) === 2147483647
    )
      return 'conflict';
    const used = await db.$queryRaw<
      { present: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM fmv.document_medication_reviews WHERE document_id=${d}::uuid AND request_id=${input.requestId}::uuid) present`;
    if (used[0]?.present) return 'conflict';
    if (
      previous &&
      (!Array.isArray(previous.statements) ||
        !previous.statements.every(isMedicationCandidate))
    )
      throw Error('Unavailable medication set');
    const old = (previous?.statements ?? []) as MedicationCandidate[];
    let statements: MedicationCandidate[],
      withdrawn: MedicationCandidate[] = [],
      sourceRevision: number,
      sourceContext: unknown;
    const ids = new Set(input.candidateIds);
    if (action === 'withdrawal') {
      if (!previous || [...ids].some((id) => !old.some((s) => s.id === id)))
        return 'conflict';
      statements = old.filter((s) => !ids.has(s.id));
      withdrawn = old.filter((s) => ids.has(s.id));
      sourceRevision = previous.sourceRevision;
      sourceContext = previous.sourceContext;
    } else {
      if (!e || !isExtractionResult(e.result))
        throw Error('Unavailable medication source');
      const candidates = extractMedicationFields(e.result.pages, {
        truncatedFinalLine: e.result.partialReason === 'characters',
      });
      if ([...ids].some((id) => !candidates.some((s) => s.id === id)))
        return 'conflict';
      const combined = new Map<string, MedicationCandidate>();
      if (previous?.sourceRevision === e.revision)
        for (const s of old) {
          if (
            !candidates.some(
              (c) =>
                c.id === s.id &&
                c.page === s.page &&
                medicationFieldsEqual(c.fields, s.fields),
            )
          )
            return 'conflict';
          combined.set(s.id, s);
        }
      for (const s of candidates) if (ids.has(s.id)) combined.set(s.id, s);
      statements = [...combined.values()];
      sourceRevision = e.revision;
      sourceContext = {
        method: e.result.method,
        engineVersion: e.result.engineVersion,
        partial: e.result.partial,
        partialReason: e.result.partialReason,
        downsized: e.result.downsized,
      };
    }
    const revision = (previous?.revision ?? 0) + 1;
    await db.$executeRaw`INSERT INTO fmv.document_medication_reviews(id,document_id,patient_id,revision,source_revision,source_sha256,lifecycle_version,request_id,payload_hash,actor_account_id,source_context,action,statements,withdrawn_statements) VALUES (${randomUUID()}::uuid,${d}::uuid,${p}::uuid,${revision},${sourceRevision},${original.sha256},${original.lifecycleVersion},${input.requestId}::uuid,${hash},${actor.accountId}::uuid,${JSON.stringify(sourceContext)}::jsonb,${action},${JSON.stringify(statements)}::jsonb,${JSON.stringify(withdrawn)}::jsonb)`;
    const event =
      action === 'confirmation'
        ? 'document.medication_confirmed'
        : 'document.medication_withdrawn';
    await db.$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) VALUES (${randomUUID()}::uuid,${p}::uuid,${d}::uuid,${actor.accountId}::uuid,${event})`;
    const final = await authorize(original);
    if (!final.canVerify || final.accountId !== actor.accountId)
      throw Error('Unavailable medication review');
    return { saved: true, revision };
  }, options);
}
