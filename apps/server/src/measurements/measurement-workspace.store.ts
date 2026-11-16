import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  isClinicalReviewResult,
  isMeasurementComparisonMembers,
  isMeasurementWorkspace,
  measurementMember,
  projectConfirmedMeasurements,
} from '@fmv/contracts';
import type {
  ClinicalReviewResult,
  MeasurementWorkspace,
  MeasurementComparisonMember,
  DocumentMimeType,
} from '@fmv/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import type { Principal } from '../identity/person.store.js';
import { TransactionAccessStore } from '../access/transaction-access.store.js';
import { PermissionService } from '../access/permission.service.js';
type Tx = Prisma.TransactionClient;
type Doc = {
  documentId: string;
  patientId: string;
  categoryId: string;
  state: 'pending' | 'ready' | 'failed';
  deletedAt: Date | null;
};
type Row = Doc & {
  title: string;
  bytes: bigint | number;
  mimeType: DocumentMimeType;
  sha256: string;
  lifecycleVersion: number;
  sourceRevision: number | null;
  extractionSha: string | null;
  extractionLifecycle: number | null;
  reviewRevision: number | null;
  reviewSourceRevision: number | null;
  reviewSha: string | null;
  reviewLifecycle: number | null;
  action: 'confirmation' | 'withdrawal' | null;
  items: unknown;
  withdrawnItems: unknown;
  extraction: unknown;
  verifiedAt: Date | null;
  ruleVersion: string | null;
};
type SetRow = {
  setId: string;
  revision: number;
  action: 'confirmation' | 'withdrawal';
  members: unknown;
  recordedAt: Date;
};
function review(row: Row): ClinicalReviewResult | null {
  if (
    row.sourceRevision === null ||
    row.reviewRevision === null ||
    row.sourceRevision !== row.reviewSourceRevision ||
    row.sha256 !== row.extractionSha ||
    row.sha256 !== row.reviewSha ||
    row.lifecycleVersion !== row.extractionLifecycle ||
    row.lifecycleVersion !== row.reviewLifecycle
  )
    return null;
  const value = {
    context: {
      sourceRevision: row.sourceRevision,
      sourceSha256: row.sha256,
      lifecycleVersion: row.lifecycleVersion,
      revision: row.reviewRevision,
      canVerify: false,
    },
    candidates: [],
    snapshot: {
      action: row.action,
      withdrawnItems: row.withdrawnItems,
      revision: row.reviewRevision,
      sourceRevision: row.reviewSourceRevision,
      sourceSha256: row.reviewSha,
      verifiedAt: row.verifiedAt?.toISOString(),
      ruleVersion: row.ruleVersion,
      items: row.items,
      extraction: row.extraction,
      verified: Array.isArray(row.items) && row.items.length > 0,
    },
  };
  if (!isClinicalReviewResult(value)) throw new ServiceUnavailableException();
  return value;
}
function currentMember(r: Row, m: MeasurementComparisonMember) {
  const v = review(r);
  if (
    !v?.snapshot ||
    v.context.revision !== m.reviewRevision ||
    v.context.sourceRevision !== m.sourceRevision ||
    v.context.sourceSha256 !== m.sourceSha256 ||
    v.context.lifecycleVersion !== m.lifecycleVersion
  )
    return null;
  return v.snapshot.items.find((i) => i.source.id === m.candidateId) ?? null;
}
/** Caller holds the canonical patient-access lock throughout the transaction. */
export async function readMeasurementWorkspace(
  db: Tx,
  principal: Principal,
  p: string,
): Promise<MeasurementWorkspace> {
  const permissions = new PermissionService(new TransactionAccessStore(db));
  const initial = await permissions.snapshot(principal, p);
  const grants = initial.grants.filter(
    (g) =>
      g.patientId === p &&
      g.granteeAccountId === initial.accountId &&
      !g.revokedAt &&
      (!g.expiresAt || g.expiresAt > initial.now) &&
      g.actions.includes('view'),
  );
  const owner = initial.patient?.ownerAccountId === initial.accountId;
  if (!owner && !grants.length) throw new NotFoundException();
  const all = owner || grants.some((g) => g.scope.kind === 'patient');
  const categories = grants.flatMap((g) =>
    g.scope.kind === 'category' ? [g.scope.categoryId] : [],
  );
  const documents = grants.flatMap((g) =>
    g.scope.kind === 'document' ? [g.scope.documentId] : [],
  );
  // Only source pointers are read before locking/authorizing actual resources.
  const candidateIds = await db.$queryRaw<
    { id: string }[]
  >`SELECT d.id FROM fmv.documents d JOIN fmv.document_extractions e ON e.document_id=d.id AND e.patient_id=d.patient_id AND e.source_sha256=d.sha256 AND e.lifecycle_version=d.extraction_lifecycle JOIN LATERAL(SELECT revision,source_revision,source_sha256,lifecycle_version,items FROM fmv.document_clinical_reviews WHERE document_id=d.id AND patient_id=d.patient_id ORDER BY revision DESC LIMIT 1) r ON r.source_revision=e.revision AND r.source_sha256=d.sha256 AND r.lifecycle_version=d.extraction_lifecycle WHERE d.patient_id=${p}::uuid AND d.state='ready' AND d.deleted_at IS NULL AND jsonb_array_length(r.items)>0 AND (${all} OR d.category_id=ANY(${categories}::uuid[]) OR d.id=ANY(${documents}::uuid[])) ORDER BY d.created_at DESC,d.id ASC LIMIT 26`;
  const sets = await db.$queryRaw<
    SetRow[]
  >`WITH latest AS(SELECT DISTINCT ON(set_id) set_id AS "setId",revision,action,members,recorded_at AS "recordedAt" FROM fmv.measurement_comparisons WHERE patient_id=${p}::uuid ORDER BY set_id,revision DESC) SELECT * FROM latest c WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.members) m LEFT JOIN fmv.documents d ON d.id=(m->>'documentId')::uuid AND d.patient_id=${p}::uuid WHERE d.id IS NULL OR d.state<>'ready' OR d.deleted_at IS NOT NULL OR NOT(${all} OR d.category_id=ANY(${categories}::uuid[]) OR d.id=ANY(${documents}::uuid[]))) ORDER BY "recordedAt" DESC,"setId" ASC LIMIT 11`;
  for (const s of sets)
    if (!isMeasurementComparisonMembers(s.members))
      throw new ServiceUnavailableException();
  const ids = [
    ...new Set([
      ...candidateIds.map((d) => d.id),
      ...sets.flatMap((s) =>
        (s.members as MeasurementComparisonMember[]).map((m) => m.documentId),
      ),
    ]),
  ];
  const locked = ids.length
    ? await db.$queryRaw<
        Doc[]
      >`SELECT id AS "documentId",patient_id AS "patientId",category_id AS "categoryId",state,deleted_at AS "deletedAt" FROM fmv.documents WHERE patient_id=${p}::uuid AND id=ANY(${ids}::uuid[]) ORDER BY id FOR NO KEY UPDATE`
    : [];
  if (locked.length !== ids.length) throw new ServiceUnavailableException();
  const authorize = async () => {
    const current = await permissions.snapshot(principal, p);
    for (const d of locked)
      if (
        d.state !== 'ready' ||
        d.deletedAt ||
        !permissions.allows(
          current,
          'view',
          { kind: 'document', documentId: d.documentId },
          { ...d, id: d.documentId },
        )
      )
        throw new NotFoundException();
    if (
      current.accountId !== initial.accountId ||
      (current.patient?.ownerAccountId !== current.accountId &&
        !current.grants.some(
          (g) =>
            g.patientId === p &&
            g.granteeAccountId === current.accountId &&
            !g.revokedAt &&
            (!g.expiresAt || g.expiresAt > current.now) &&
            g.actions.includes('view'),
        ))
    )
      throw new NotFoundException();
    return current.patient?.ownerAccountId === current.accountId;
  };
  await authorize();
  // Fresh statement after document locks: joined metadata cannot be pre-wait stale.
  const rows = ids.length
    ? await db.$queryRaw<
        Row[]
      >`SELECT d.id AS "documentId",d.patient_id AS "patientId",d.category_id AS "categoryId",d.state,d.deleted_at AS "deletedAt",COALESCE(d.display_title,d.title) AS title,d.bytes,d.mime_type AS "mimeType",d.sha256,d.extraction_lifecycle AS "lifecycleVersion",e.revision AS "sourceRevision",e.source_sha256 AS "extractionSha",e.lifecycle_version AS "extractionLifecycle",r.revision AS "reviewRevision",r.source_revision AS "reviewSourceRevision",r.source_sha256 AS "reviewSha",r.lifecycle_version AS "reviewLifecycle",r.action,r.items,r.withdrawn_items AS "withdrawnItems",r.source_context AS extraction,r.verified_at AS "verifiedAt",r.rule_version AS "ruleVersion" FROM fmv.documents d LEFT JOIN fmv.document_extractions e ON e.document_id=d.id AND e.patient_id=d.patient_id LEFT JOIN LATERAL(SELECT * FROM fmv.document_clinical_reviews WHERE document_id=d.id AND patient_id=d.patient_id ORDER BY revision DESC LIMIT 1) r ON true WHERE d.patient_id=${p}::uuid AND d.id=ANY(${ids}::uuid[])`
    : [];
  const byId = new Map(rows.map((r) => [r.documentId, r]));
  const result: MeasurementWorkspace = {
    patientId: p,
    canConfirm: owner,
    measurements: [],
    measurementsLimited: candidateIds.length > 25,
    comparisons: [],
    comparisonsLimited: sets.length > 10,
    sources: [],
  };
  const disclosed = new Set<string>();
  let optionCount = 0;
  for (const [index, { id }] of candidateIds.entries()) {
    const row = byId.get(id);
    const v = row && review(row);
    if (!row || !v?.snapshot?.items.length)
      throw new ServiceUnavailableException();
    if (index === 25) continue;
    const projected = projectConfirmedMeasurements(p, id, v);
    if (!projected.length) throw new ServiceUnavailableException();
    for (const measurement of projected) {
      optionCount++;
      if (result.measurements.length < 50) {
        result.measurements.push({
          member: measurementMember(measurement),
          title: row.title,
          measurement,
        });
        disclosed.add(id);
      }
    }
  }
  result.measurementsLimited ||= optionCount > 50;
  for (const s of sets.slice(0, 10)) {
    const members = s.members as MeasurementComparisonMember[];
    const active =
      s.action === 'confirmation' &&
      members.every((m) => {
        const row = byId.get(m.documentId);
        return row && currentMember(row, m) !== null;
      });
    const first = active
      ? currentMember(byId.get(members[0]!.documentId)!, members[0]!)
      : null;
    result.comparisons.push({
      setId: s.setId,
      revision: s.revision,
      status:
        s.action === 'withdrawal'
          ? 'withdrawn'
          : active
            ? 'current'
            : 'invalid',
      analyte: first?.fields.analyte ?? null,
      recordedAt: s.recordedAt.toISOString(),
      memberCount: members.length,
    });
    for (const m of members) disclosed.add(m.documentId);
  }
  result.sources = [...disclosed].map((id) => {
    const row = byId.get(id)!;
    return {
      documentId: id,
      title: row.title,
      bytes: Number(row.bytes),
      mimeType: row.mimeType,
    };
  });
  result.canConfirm = await authorize();
  if (!isMeasurementWorkspace(result)) throw new ServiceUnavailableException();
  if (disclosed.size) {
    const docIds = [...disclosed],
      events = docIds.map(() => randomUUID());
    await db.$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) SELECT id,${p}::uuid,document_id,${initial.accountId}::uuid,'document.viewed' FROM unnest(${events}::uuid[],${docIds}::uuid[]) AS events(id,document_id)`;
  }
  result.canConfirm = await authorize();
  return result;
}
