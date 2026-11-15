import { createHash, randomUUID } from 'node:crypto';
import {
  isProcessingConsentResult,
  isProcessingConsentHistoryResult,
  isProcessingProviderPolicy,
} from '@fmv/contracts';
import type {
  SaveProcessingConsent,
  WithdrawProcessingConsent,
  ProcessingConsentSnapshot,
  ProcessingConsentResult,
  ProcessingConsentHistoryResult,
  ProcessingProviderPolicy,
} from '@fmv/contracts';
import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import type { ClinicalAuthorization } from './clinical-review.store.js';
import { extractionSource, latestExtraction } from './extraction.store.js';
const options = { maxWait: 5000, timeout: 15000 };
type Row = {
  revision: number;
  requestId: string;
  payloadHash: string;
  actorAccountId: string;
  action: 'grant' | 'withdrawal';
  sourceSha256: string;
  sourceRevision: number;
  lifecycleVersion: number;
  policyGeneration: string;
  providerId: string;
  policyVersion: string;
  purpose: 'document-extraction';
  dataCategories: ('original-document' | 'saved-text')[];
  expiresAt: Date;
  recordedAt: Date;
};
type Policy = ProcessingProviderPolicy & { generation: string };
async function latest(
  db: Prisma.TransactionClient,
  d: string,
  before = 2147483647,
) {
  const rows = await db.$queryRaw<
    Row[]
  >`SELECT revision,request_id AS "requestId",payload_hash AS "payloadHash",actor_account_id AS "actorAccountId",action,source_sha256 AS "sourceSha256",source_revision AS "sourceRevision",lifecycle_version AS "lifecycleVersion",policy_generation AS "policyGeneration",provider_id AS "providerId",policy_version AS "policyVersion",purpose,data_categories AS "dataCategories",expires_at AS "expiresAt",recorded_at AS "recordedAt" FROM fmv.document_processing_consents WHERE document_id=${d}::uuid AND revision<=${before} ORDER BY revision DESC LIMIT 1`;
  return rows[0] ?? null;
}
async function policies(db: Prisma.TransactionClient): Promise<Policy[]> {
  const rows = await db.$queryRaw<
    {
      generation: string;
      providerId: string;
      policyVersion: string;
      purposes: ['document-extraction'];
      dataCategories: ('original-document' | 'saved-text')[];
      expiresAt: Date;
    }[]
  >`SELECT generation,provider_id AS "providerId",policy_version AS "policyVersion",purposes,data_categories AS "dataCategories",expires_at AS "expiresAt" FROM fmv.processing_provider_policies WHERE enabled AND expires_at>clock_timestamp() ORDER BY provider_id LIMIT 21`;
  if (rows.length > 20) throw Error('Unavailable processing policies');
  return rows.map((r) => {
    const { generation, ...policy } = r;
    const result = { ...policy, expiresAt: r.expiresAt.toISOString() };
    if (!isProcessingProviderPolicy(result))
      throw Error('Unavailable processing policy');
    return { ...result, generation };
  });
}
function snapshot(r: Row): ProcessingConsentSnapshot {
  return {
    revision: r.revision,
    action: r.action,
    sourceSha256: r.sourceSha256,
    sourceRevision: r.sourceRevision,
    lifecycleVersion: r.lifecycleVersion,
    providerId: r.providerId,
    policyVersion: r.policyVersion,
    purpose: r.purpose,
    dataCategories: r.dataCategories,
    expiresAt: r.expiresAt.toISOString(),
    recordedAt: r.recordedAt.toISOString(),
  };
}
export async function readProcessingConsent(
  client: PrismaClient,
  p: string,
  d: string,
  authorize: ClinicalAuthorization,
  before?: number,
): Promise<ProcessingConsentResult | ProcessingConsentHistoryResult | null> {
  return client.$transaction(async (db) => {
    const original = await extractionSource(db, p, d);
    if (!original) return null;
    const actor = await authorize(original);
    if (!actor.canVerify) throw Error('Unavailable consent owner');
    const e = await latestExtraction(db, d),
      current = await latest(db, d);
    const context = {
      sourceSha256: original.sha256,
      sourceRevision: e?.revision ?? 0,
      lifecycleVersion: original.lifecycleVersion,
      revision: current?.revision ?? 0,
    };
    let result: ProcessingConsentResult | ProcessingConsentHistoryResult;
    if (before === undefined) {
      const catalog = await policies(db);
      const policy =
        current &&
        catalog.find(
          (v) =>
            v.generation === current.policyGeneration &&
            v.providerId === current.providerId &&
            v.policyVersion === current.policyVersion,
        );
      const now = (
        await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      )[0]!.now;
      const effective = !!(
        current?.action === 'grant' &&
        current.sourceSha256 === context.sourceSha256 &&
        current.sourceRevision === context.sourceRevision &&
        current.lifecycleVersion === context.lifecycleVersion &&
        current.expiresAt > now &&
        policy &&
        policy.purposes.includes(current.purpose) &&
        current.dataCategories.every((c) =>
          policy.dataCategories.includes(c),
        ) &&
        current.expiresAt.toISOString() <= policy.expiresAt
      );
      result = {
        context,
        snapshot: current ? snapshot(current) : null,
        policies: catalog.map(({ generation, ...value }) => {
          void generation;
          return value;
        }),
        effective,
        externalProcessingEnabled: false,
      };
      if (!isProcessingConsentResult(result))
        throw Error('Unavailable consent result');
    } else {
      const target = await latest(db, d, before - 1),
        older = target && (await latest(db, d, target.revision - 1));
      result = {
        context,
        snapshot: target ? snapshot(target) : null,
        nextBefore: older && target ? target.revision : null,
      };
      if (!isProcessingConsentHistoryResult(result))
        throw Error('Unavailable consent history');
    }
    const final = await authorize(original);
    if (!final.canVerify || final.accountId !== actor.accountId)
      throw Error('Unavailable consent owner');
    return result;
  }, options);
}
export async function writeProcessingConsent(
  client: PrismaClient,
  p: string,
  d: string,
  input: SaveProcessingConsent | WithdrawProcessingConsent,
  action: 'grant' | 'withdrawal',
  authorize: ClinicalAuthorization,
): Promise<
  | { saved: true; revision: number }
  | 'missing'
  | 'conflict'
  | 'unavailable'
  | 'invalid'
> {
  return client.$transaction(async (db) => {
    const original = await extractionSource(db, p, d);
    if (!original) return 'missing';
    const actor = await authorize(original);
    if (!actor.canVerify) throw Error('Unavailable consent owner');
    const previous = await latest(db, d);
    const extraction =
      action === 'grant' ? await latestExtraction(db, d) : null;
    const payload =
      'providerId' in input
        ? {
            requestId: input.requestId.toLowerCase(),
            expectedRevision: input.expectedRevision,
            sourceSha256: input.sourceSha256,
            sourceRevision: input.sourceRevision,
            lifecycleVersion: input.lifecycleVersion,
            providerId: input.providerId,
            policyVersion: input.policyVersion,
            purpose: input.purpose,
            dataCategories: [...input.dataCategories].sort(),
            expiresAt: input.expiresAt,
            confirmed: input.confirmed,
          }
        : {
            requestId: input.requestId.toLowerCase(),
            expectedRevision: input.expectedRevision,
          };
    const hash = createHash('sha256')
      .update(JSON.stringify({ action, ...payload }))
      .digest('hex');
    if (
      'sourceSha256' in input &&
      (input.sourceSha256 !== original.sha256 ||
        input.lifecycleVersion !== original.lifecycleVersion ||
        input.sourceRevision !== (extraction?.revision ?? 0))
    )
      return 'conflict';
    if (previous?.requestId === input.requestId.toLowerCase()) {
      if (
        previous.payloadHash !== hash ||
        previous.actorAccountId !== actor.accountId ||
        previous.action !== action
      )
        return 'conflict';
      const final = await authorize(original);
      if (!final.canVerify || final.accountId !== actor.accountId)
        throw Error('Unavailable consent owner');
      return { saved: true, revision: previous.revision };
    }
    if (
      (previous?.revision ?? 0) !== input.expectedRevision ||
      input.expectedRevision === 2147483647
    )
      return 'conflict';
    const used = await db.$queryRaw<
      { used: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM fmv.document_processing_consents WHERE document_id=${d}::uuid AND request_id=${input.requestId}::uuid) AS used`;
    if (used[0]?.used) return 'conflict';
    let binding: Pick<
      Row,
      | 'sourceSha256'
      | 'sourceRevision'
      | 'lifecycleVersion'
      | 'policyGeneration'
      | 'providerId'
      | 'policyVersion'
      | 'purpose'
      | 'dataCategories'
      | 'expiresAt'
    >;
    if (action === 'withdrawal') {
      if (!previous || previous.action !== 'grant') return 'conflict';
      binding = previous;
    } else {
      if (!('providerId' in input)) return 'invalid';
      const e = extraction;
      if (input.dataCategories.includes('saved-text') && !e) return 'invalid';
      const policy = (await policies(db)).find(
        (v) =>
          v.providerId === input.providerId &&
          v.policyVersion === input.policyVersion,
      );
      if (!policy) return 'unavailable';
      const now = (
        await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      )[0]!.now;
      if (
        new Date(input.expiresAt) <= now ||
        input.expiresAt > policy.expiresAt ||
        !policy.purposes.includes(input.purpose) ||
        !input.dataCategories.every((c) => policy.dataCategories.includes(c))
      )
        return 'invalid';
      binding = {
        ...input,
        policyGeneration: policy.generation,
        dataCategories: [...input.dataCategories].sort(),
        expiresAt: new Date(input.expiresAt),
      };
    }
    const r = binding,
      revision = (previous?.revision ?? 0) + 1;
    await db.$executeRaw`INSERT INTO fmv.document_processing_consents(id,document_id,patient_id,revision,request_id,payload_hash,actor_account_id,action,source_sha256,source_revision,lifecycle_version,policy_generation,provider_id,policy_version,purpose,data_categories,expires_at) VALUES (${randomUUID()}::uuid,${d}::uuid,${p}::uuid,${revision},${input.requestId}::uuid,${hash},${actor.accountId}::uuid,${action},${r.sourceSha256},${r.sourceRevision},${r.lifecycleVersion},${r.policyGeneration}::uuid,${r.providerId},${r.policyVersion},${r.purpose},ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(r.dataCategories)}::jsonb)),${r.expiresAt})`;
    const event =
      action === 'grant'
        ? 'processing.consent_granted'
        : 'processing.consent_withdrawn';
    await db.$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) VALUES (${randomUUID()}::uuid,${p}::uuid,${d}::uuid,${actor.accountId}::uuid,${event})`;
    const final = await authorize(original);
    if (!final.canVerify || final.accountId !== actor.accountId)
      throw Error('Unavailable consent owner');
    return { saved: true, revision };
  }, options);
}
