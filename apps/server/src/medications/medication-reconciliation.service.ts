import { readSchedule, saveSchedule } from './medication-schedule.store.js';
import type { MedicationRecordContext } from './medication-record-context.js';
import { readInventory, saveInventory } from './medication-inventory.store.js';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  isMedicationReconciliationCursor,
  isMedicationReconciliationEntry,
  isMedicationReconciliationHistory,
  isMedicationReconciliationsPage,
  isSaveMedicationReconciliation,
  projectReviewedMedicationSources,
  isMedicationSourceOptions,
} from '@fmv/contracts';
import type {
  MedicationReconciliationEntry,
  MedicationReconciliationCursor,
  MedicationReconciliationView,
  SaveMedicationReconciliation,
  MedicationSourceOptions,
  MedicationSourceBinding,
} from '@fmv/contracts';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { Principal } from '../identity/person.store.js';
import { PermissionService, isUuid } from '../access/permission.service.js';
import {
  TransactionAccessStore,
  lockAccessPatient,
} from '../access/transaction-access.store.js';
type Tx = Prisma.TransactionClient;
type Row = {
  id: string;
  medicationId: string;
  patientId: string;
  documentId: string;
  candidateId: string;
  sourceRevision: number;
  sourceSha256: string;
  lifecycleVersion: number;
  reviewRevision: number;
  revision: number;
  action: 'reconciliation' | 'correction';
  recordedStatus: 'current' | 'historical';
  fields: MedicationReconciliationEntry['fields'];
  requestId: string;
  payloadHash: string;
  actorAccountId: string;
  recordedAt: Date;
};
function entry(r: Row): MedicationReconciliationEntry {
  const v: MedicationReconciliationEntry = {
    medicationId: r.medicationId,
    patientId: r.patientId,
    revision: r.revision,
    action: r.action,
    recordedAt: r.recordedAt.toISOString(),
    meaning: 'owner-recorded-medication-context',
    recordedStatus: r.recordedStatus,
    fields: r.fields,
    source: {
      documentId: r.documentId,
      candidateId: r.candidateId,
      sourceRevision: r.sourceRevision,
      sourceSha256: r.sourceSha256,
      lifecycleVersion: r.lifecycleVersion,
      reviewRevision: r.reviewRevision,
    },
  };
  if (!isMedicationReconciliationEntry(v))
    throw new ServiceUnavailableException();
  return v;
}
export class MedicationReconciliationService implements OnModuleDestroy {
  private readonly db: PrismaClient | null;
  constructor(url: string | null) {
    this.db = url
      ? new PrismaClient({
          adapter: new PrismaPg({
            connectionString: url,
            options: '-c timezone=UTC',
            max: 3,
            connectionTimeoutMillis: 5000,
          }),
          log: [],
        })
      : null;
  }
  async onModuleDestroy() {
    await this.db?.$disconnect();
  }
  private async tx<T>(p: string, work: (db: Tx) => Promise<T>) {
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
    } catch (e) {
      if (
        e instanceof BadRequestException ||
        e instanceof ConflictException ||
        e instanceof NotFoundException ||
        e instanceof ServiceUnavailableException
      )
        throw e;
      throw new ServiceUnavailableException();
    }
  }
  private async auth(
    db: Tx,
    principal: Principal,
    p: string,
    docs: string[] = [],
    write = false,
  ) {
    const store = new TransactionAccessStore(db),
      permissions = new PermissionService(store),
      s = await permissions.snapshot(principal, p);
    const owner = !!s.accountId && s.patient?.ownerAccountId === s.accountId;
    if (
      !permissions.allows(s, 'view', { kind: 'patient' }) ||
      (write && !owner)
    )
      throw new NotFoundException();
    for (const id of docs) {
      const d = await store.document(id);
      if (
        !d ||
        d.patientId !== p ||
        (!owner && d.state !== 'ready') ||
        !permissions.allows(
          s,
          'view',
          { kind: 'document', documentId: id },
          d,
          owner,
        )
      )
        throw new NotFoundException();
    }
    return { owner, accountId: s.accountId! };
  }
  private async latest(db: Tx, p: string, id: string) {
    const [r] = await db.$queryRaw<
      Row[]
    >`SELECT id,medication_id AS "medicationId",patient_id AS "patientId",document_id AS "documentId",candidate_id AS "candidateId",source_revision AS "sourceRevision",source_sha256 AS "sourceSha256",lifecycle_version AS "lifecycleVersion",review_revision AS "reviewRevision",revision,action,recorded_status AS "recordedStatus",fields,request_id AS "requestId",payload_hash AS "payloadHash",actor_account_id AS "actorAccountId",recorded_at AS "recordedAt" FROM fmv.medication_reconciliations WHERE patient_id=${p}::uuid AND medication_id=${id}::uuid ORDER BY revision DESC LIMIT 1`;
    return r;
  }
  private async lockDocs(db: Tx, p: string, ids: string[]) {
    if (ids.length)
      await db.$queryRaw`SELECT id FROM fmv.documents WHERE patient_id=${p}::uuid AND id=ANY(${[...new Set(ids)].sort()}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
  }
  private async currentSources(db: Tx, p: string, d: string) {
    const [s] = await db.$queryRaw<
      {
        sha: string;
        life: number;
        sourceRevision: number;
        extractionSha: string;
        extractionLife: number;
        reviewRevision: number;
        reviewSource: number;
        reviewSha: string;
        reviewLife: number;
        action: string;
        statements: unknown;
        withdrawn: unknown;
        context: unknown;
        confirmedAt: Date;
        ruleVersion: string;
      }[]
    >`SELECT d.sha256 AS sha,d.extraction_lifecycle AS life,e.revision AS "sourceRevision",e.source_sha256 AS "extractionSha",e.lifecycle_version AS "extractionLife",m.revision AS "reviewRevision",m.source_revision AS "reviewSource",m.source_sha256 AS "reviewSha",m.lifecycle_version AS "reviewLife",m.action,m.statements,m.withdrawn_statements AS withdrawn,m.source_context AS context,m.confirmed_at AS "confirmedAt",m.rule_version AS "ruleVersion" FROM fmv.documents d JOIN fmv.document_extractions e ON e.document_id=d.id AND e.patient_id=d.patient_id JOIN LATERAL(SELECT * FROM fmv.document_medication_reviews WHERE document_id=d.id AND patient_id=d.patient_id ORDER BY revision DESC LIMIT 1) m ON true WHERE d.patient_id=${p}::uuid AND d.id=${d}::uuid AND d.state='ready' AND d.deleted_at IS NULL`;
    if (!s || s.extractionSha !== s.sha || s.extractionLife !== s.life)
      return [];
    return projectReviewedMedicationSources(
      p,
      d,
      {
        context: {
          sourceRevision: s.sourceRevision,
          sourceSha256: s.sha,
          lifecycleVersion: s.life,
          revision: s.reviewRevision,
          canVerify: false,
        },
        candidates: [],
        snapshot: {
          revision: s.reviewRevision,
          sourceRevision: s.reviewSource,
          sourceSha256: s.reviewSha,
          confirmedAt: s.confirmedAt.toISOString(),
          action: s.action,
          meaning: 'source-fields-only',
          ruleVersion: s.ruleVersion,
          extraction: s.context,
          statements: s.statements,
          withdrawnStatements: s.withdrawn,
        },
      },
      {
        sourceRevision: s.sourceRevision,
        sourceSha256: s.sha,
        lifecycleVersion: s.life,
        reviewRevision: s.reviewRevision,
        reviewLifecycleVersion: s.reviewLife,
      },
    );
  }
  private async sourceCurrent(db: Tx, r: Row) {
    const v = entry(r),
      b = v.source;
    return (await this.currentSources(db, r.patientId, r.documentId)).some(
      (source) =>
        source.source.id === b.candidateId &&
        source.provenance.sourceRevision === b.sourceRevision &&
        source.provenance.sourceSha256 === b.sourceSha256 &&
        source.provenance.lifecycleVersion === b.lifecycleVersion &&
        source.provenance.reviewRevision === b.reviewRevision,
    );
  }
  private async existingSourceRecord(
    db: Tx,
    p: string,
    b: MedicationSourceBinding,
  ) {
    const [record] = await db.$queryRaw<
      { medicationId: string; revision: number }[]
    >`SELECT c.medication_id AS "medicationId",r.revision FROM fmv.medication_source_records c JOIN LATERAL(SELECT revision FROM fmv.medication_reconciliations WHERE patient_id=c.patient_id AND medication_id=c.medication_id ORDER BY revision DESC LIMIT 1) r ON true WHERE c.patient_id=${p}::uuid AND c.document_id=${b.documentId}::uuid AND c.source_revision=${b.sourceRevision} AND c.lifecycle_version=${b.lifecycleVersion} AND c.candidate_id=${b.candidateId}`;
    return record ?? null;
  }
  async sourceOptions(
    principal: Principal,
    patientId: string,
    query: unknown = {},
  ) {
    const p = patientId.toLowerCase();
    return this.tx(p, async (db) => {
      const actor = await this.auth(db, principal, p, [], true);
      if (
        !query ||
        typeof query !== 'object' ||
        Array.isArray(query) ||
        Object.keys(query).length
      )
        throw new BadRequestException();
      const pointers = await db.$queryRaw<
        { id: string }[]
      >`SELECT d.id FROM fmv.documents d JOIN fmv.document_extractions e ON e.document_id=d.id AND e.patient_id=d.patient_id JOIN LATERAL(SELECT * FROM fmv.document_medication_reviews WHERE document_id=d.id AND patient_id=d.patient_id ORDER BY revision DESC LIMIT 1) m ON true WHERE d.patient_id=${p}::uuid AND d.state='ready' AND d.deleted_at IS NULL AND d.sha256=e.source_sha256 AND d.extraction_lifecycle=e.lifecycle_version AND m.source_revision=e.revision AND m.source_sha256=d.sha256 AND m.lifecycle_version=d.extraction_lifecycle AND jsonb_array_length(m.statements)>0 ORDER BY m.confirmed_at DESC,d.id DESC LIMIT 26`;
      const docs = pointers.map((v) => v.id);
      await this.lockDocs(db, p, docs);
      await this.auth(db, principal, p, docs, true);
      const result: MedicationSourceOptions = {
        patientId: p,
        canWrite: true,
        options: [],
        limited: pointers.length > 25,
      };
      const disclosed: string[] = [];
      let count = 0;
      for (const { id } of pointers.slice(0, 25)) {
        const sources = await this.currentSources(db, p, id);
        if (!sources.length) continue;
        const [doc] = await db.$queryRaw<
          { title: string }[]
        >`SELECT COALESCE(display_title,title) AS title FROM fmv.documents WHERE patient_id=${p}::uuid AND id=${id}::uuid`;
        if (!doc) throw new ServiceUnavailableException();
        const provenance = sources[0]!.provenance;
        const claims = await db.$queryRaw<
          { candidateId: string; medicationId: string; revision: number }[]
        >`SELECT c.candidate_id AS "candidateId",c.medication_id AS "medicationId",r.revision FROM fmv.medication_source_records c JOIN LATERAL(SELECT revision FROM fmv.medication_reconciliations WHERE patient_id=c.patient_id AND medication_id=c.medication_id ORDER BY revision DESC LIMIT 1) r ON true WHERE c.patient_id=${p}::uuid AND c.document_id=${id}::uuid AND c.source_revision=${provenance.sourceRevision} AND c.lifecycle_version=${provenance.lifecycleVersion} AND c.candidate_id=ANY(${sources.map((item) => item.source.id)}::text[])`;
        const existing = new Map(
          claims.map((c) => [
            c.candidateId,
            { medicationId: c.medicationId, revision: c.revision },
          ]),
        );
        for (const item of sources) {
          count++;
          if (result.options.length === 50) continue;
          const b = item.provenance;
          result.options.push({
            title: doc.title,
            source: item.source,
            binding: {
              documentId: id,
              candidateId: item.source.id,
              sourceRevision: b.sourceRevision,
              sourceSha256: b.sourceSha256,
              lifecycleVersion: b.lifecycleVersion,
              reviewRevision: b.reviewRevision,
            },
            existingRecord: existing.get(item.source.id) ?? null,
          });
          if (!disclosed.includes(id)) disclosed.push(id);
        }
      }
      result.limited ||= count > 50;
      if (!isMedicationSourceOptions(result))
        throw new ServiceUnavailableException();
      for (const id of disclosed)
        await db.$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) VALUES(${randomUUID()}::uuid,${p}::uuid,${id}::uuid,${actor.accountId}::uuid,'document.viewed')`;
      await this.auth(db, principal, p, docs, true);
      return result;
    });
  }
  private async view(db: Tx, r: Row): Promise<MedicationReconciliationView> {
    return {
      entry: entry(r),
      sourceState: (await this.sourceCurrent(db, r))
        ? 'current-source'
        : 'source-review-required',
    };
  }
  private async audit(
    db: Tx,
    p: string,
    actor: string,
    rows: Row[],
    kind: string,
  ) {
    for (const r of rows)
      await db.$executeRaw`INSERT INTO fmv.medication_reconciliation_events(id,patient_id,medication_id,entry_id,actor_account_id,kind) VALUES(${randomUUID()}::uuid,${p}::uuid,${r.medicationId}::uuid,${r.id}::uuid,${actor}::uuid,${kind})`;
  }
  async list(principal: Principal, patientId: string, query: unknown = {}) {
    const p = patientId.toLowerCase();
    return this.tx(p, (db) =>
      this.readPageInTransaction(db, principal, p, query),
    );
  }
  /** Internal composition only: caller holds the canonical patient-access lock. */
  async readPageInTransaction(
    db: Tx,
    principal: Principal,
    p: string,
    query: unknown = {},
  ) {
    const actor = await this.auth(db, principal, p);
    if (
      !query ||
      typeof query !== 'object' ||
      Array.isArray(query) ||
      Object.keys(query).some((k) => k !== 'cursor')
    )
      throw new BadRequestException();
    const raw = (query as Record<string, unknown>).cursor;
    let cursor: MedicationReconciliationCursor | null = null;
    if (raw !== undefined) {
      if (typeof raw !== 'string' || raw.length > 180)
        throw new BadRequestException();
      try {
        cursor = JSON.parse(raw) as MedicationReconciliationCursor;
      } catch {
        throw new BadRequestException();
      }
      if (!isMedicationReconciliationCursor(cursor))
        throw new BadRequestException();
    }
    const stamp = cursor?.recordedAt ?? '1970-01-01T00:00:00.000Z',
      id = cursor?.medicationId ?? '00000000-0000-4000-8000-000000000000';
    const pointers = await db.$queryRaw<
      { medicationId: string; documentId: string }[]
    >`WITH latest AS(SELECT DISTINCT ON(medication_id) medication_id,document_id,recorded_at FROM fmv.medication_reconciliations WHERE patient_id=${p}::uuid ORDER BY medication_id,revision DESC) SELECT m.medication_id AS "medicationId",m.document_id AS "documentId" FROM latest m JOIN fmv.documents d ON d.id=m.document_id AND d.patient_id=${p}::uuid WHERE (${actor.owner} OR(d.state='ready' AND d.deleted_at IS NULL)) AND (${cursor === null} OR(m.recorded_at,m.medication_id)<(${stamp}::timestamptz,${id}::uuid)) ORDER BY m.recorded_at DESC,m.medication_id DESC LIMIT 21`;
    const docs = [...new Set(pointers.map((r) => r.documentId))];
    await this.lockDocs(db, p, docs);
    await this.auth(db, principal, p, docs);
    const rows: Row[] = [];
    for (const pointer of pointers.slice(0, 20)) {
      const r = await this.latest(db, p, pointer.medicationId);
      if (!r) throw new ServiceUnavailableException();
      rows.push(r);
    }
    const last = rows.at(-1),
      result = {
        patientId: p,
        canWrite: actor.owner,
        entries: await Promise.all(rows.map((r) => this.view(db, r))),
        nextCursor:
          pointers.length > 20 && last
            ? {
                recordedAt: last.recordedAt.toISOString(),
                medicationId: last.medicationId,
              }
            : null,
      };
    if (!isMedicationReconciliationsPage(result))
      throw new ServiceUnavailableException();
    await this.audit(db, p, actor.accountId, rows, 'medication.viewed');
    result.canWrite = (await this.auth(db, principal, p, docs)).owner;
    return result;
  }
  async history(
    principal: Principal,
    patientId: string,
    medicationId: string,
    query: unknown = {},
  ) {
    const p = patientId.toLowerCase(),
      id = medicationId.toLowerCase();
    return this.tx(p, async (db) => {
      const actor = await this.auth(db, principal, p);
      if (!isUuid(id)) throw new NotFoundException();
      const [pointer] = await db.$queryRaw<
        { documentId: string }[]
      >`SELECT document_id AS "documentId" FROM fmv.medication_reconciliations WHERE patient_id=${p}::uuid AND medication_id=${id}::uuid ORDER BY revision DESC LIMIT 1`;
      if (!pointer) throw new NotFoundException();
      await this.lockDocs(db, p, [pointer.documentId]);
      await this.auth(db, principal, p, [pointer.documentId]);
      const row = await this.latest(db, p, id);
      if (!row) throw new NotFoundException();
      if (
        !query ||
        typeof query !== 'object' ||
        Array.isArray(query) ||
        Object.keys(query).some((k) => k !== 'beforeRevision')
      )
        throw new BadRequestException();
      const raw = (query as Record<string, unknown>).beforeRevision;
      const before =
        raw === undefined
          ? row.revision
          : typeof raw === 'string' &&
              /^[1-9][0-9]{0,9}$/.test(raw) &&
              String(Number(raw)) === raw
            ? Number(raw)
            : 0;
      if (before < 1 || before > row.revision) throw new BadRequestException();
      const rows = await db.$queryRaw<
        Row[]
      >`SELECT id,medication_id AS "medicationId",patient_id AS "patientId",document_id AS "documentId",candidate_id AS "candidateId",source_revision AS "sourceRevision",source_sha256 AS "sourceSha256",lifecycle_version AS "lifecycleVersion",review_revision AS "reviewRevision",revision,action,recorded_status AS "recordedStatus",fields,request_id AS "requestId",payload_hash AS "payloadHash",actor_account_id AS "actorAccountId",recorded_at AS "recordedAt" FROM fmv.medication_reconciliations WHERE patient_id=${p}::uuid AND medication_id=${id}::uuid AND revision<=${before} ORDER BY revision DESC LIMIT 21`;
      const visible = rows.slice(0, 20),
        result = {
          current: await this.view(db, row),
          canWrite: actor.owner,
          history: await Promise.all(visible.map((r) => this.view(db, r))),
          nextBeforeRevision:
            rows.length > 20 ? visible.at(-1)!.revision - 1 : null,
        };
      if (!isMedicationReconciliationHistory(result))
        throw new ServiceUnavailableException();
      await this.audit(
        db,
        p,
        actor.accountId,
        [...new Map([row, ...visible].map((r) => [r.id, r])).values()],
        'medication.viewed',
      );
      result.canWrite = (
        await this.auth(db, principal, p, [row.documentId])
      ).owner;
      return result;
    });
  }
  private async withRecordedMedication<T>(
    principal: Principal,
    patientId: string,
    medicationId: string,
    write: boolean,
    work: (db: Tx, context: MedicationRecordContext) => Promise<T>,
  ) {
    const p = patientId.toLowerCase(),
      id = medicationId.toLowerCase();
    return this.tx(p, async (db) => {
      const actor = await this.auth(db, principal, p, [], write);
      if (!isUuid(id)) throw new NotFoundException();
      await db.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${'medication:' + id},0))`;
      const [pointer] = await db.$queryRaw<
        { documentId: string }[]
      >`SELECT document_id AS "documentId" FROM fmv.medication_reconciliations WHERE patient_id=${p}::uuid AND medication_id=${id}::uuid ORDER BY revision DESC LIMIT 1`;
      if (!pointer) throw new NotFoundException();
      await this.lockDocs(db, p, [pointer.documentId]);
      await this.auth(db, principal, p, [pointer.documentId], write);
      const row = await this.latest(db, p, id);
      if (!row) throw new NotFoundException();
      const context = {
        patientId: p,
        medicationId: id,
        medicationEntryId: row.id,
        medicationRevision: row.revision,
        medicationName: row.fields.medication,
        medicationStatus: row.recordedStatus,
        accountId: actor.accountId,
        owner: actor.owner,
        sourceState: (await this.sourceCurrent(db, row))
          ? ('current-source' as const)
          : ('source-review-required' as const),
      };
      const result = await work(db, context);
      if (!write)
        await this.audit(db, p, actor.accountId, [row], 'medication.viewed');
      await this.auth(db, principal, p, [row.documentId], write);
      return result;
    });
  }
  async inventory(
    principal: Principal,
    patientId: string,
    medicationId: string,
    mode: 'read' | 'save',
    input: unknown = {},
  ) {
    return this.withRecordedMedication(
      principal,
      patientId,
      medicationId,
      mode === 'save',
      async (db, context) =>
        mode === 'read'
          ? await readInventory(db, context, input)
          : await saveInventory(db, context, input),
    );
  }
  async schedule(
    principal: Principal,
    patientId: string,
    medicationId: string,
    mode: 'read' | 'save',
    input: unknown = {},
  ) {
    return this.withRecordedMedication(
      principal,
      patientId,
      medicationId,
      mode === 'save',
      async (db, context) =>
        mode === 'read'
          ? await readSchedule(db, context, input)
          : await saveSchedule(db, context, input),
    );
  }
  async save(
    principal: Principal,
    patientId: string,
    medicationId: string,
    input: unknown,
  ) {
    const p = patientId.toLowerCase(),
      id = medicationId.toLowerCase();
    return this.tx(p, async (db) => {
      const actor = await this.auth(db, principal, p, [], true);
      if (!isUuid(id)) throw new NotFoundException();
      if (!isSaveMedicationReconciliation(input))
        throw new BadRequestException();
      const body = input as SaveMedicationReconciliation;
      await db.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${'medication:' + id},0))`;
      const row = await this.latest(db, p, id);
      if (row && row.documentId !== body.source.documentId.toLowerCase())
        throw new ConflictException();
      await this.lockDocs(db, p, [body.source.documentId]);
      await this.auth(db, principal, p, [body.source.documentId], true);
      const fields = {
        medication: body.fields.medication,
        strength: body.fields.strength,
        dose: body.fields.dose,
        frequency: body.fields.frequency,
        route: body.fields.route,
        duration: body.fields.duration,
        start: body.fields.start,
        end: body.fields.end,
        instructions: body.fields.instructions,
      };
      const source = {
        documentId: body.source.documentId.toLowerCase(),
        candidateId: body.source.candidateId,
        sourceRevision: body.source.sourceRevision,
        sourceSha256: body.source.sourceSha256,
        lifecycleVersion: body.source.lifecycleVersion,
        reviewRevision: body.source.reviewRevision,
      };
      const hash = createHash('sha256')
          .update(
            JSON.stringify({
              expectedRevision: body.expectedRevision,
              meaning: body.meaning,
              confirmed: true,
              source,
              recordedStatus: body.recordedStatus,
              fields,
            }),
          )
          .digest('hex'),
        requestId = body.requestId.toLowerCase();
      if (row?.requestId === requestId) {
        if (row.payloadHash !== hash || row.actorAccountId !== actor.accountId)
          throw new ConflictException();
        await this.auth(db, principal, p, [row.documentId], true);
        return { saved: true as const, revision: row.revision };
      }
      const [used] = await db.$queryRaw<
        { present: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM fmv.medication_reconciliations WHERE medication_id=${id}::uuid AND request_id=${requestId}::uuid) AS present`;
      if (used?.present || body.expectedRevision !== (row?.revision ?? 0))
        throw new ConflictException();
      const existing = await this.existingSourceRecord(db, p, source);
      if (existing && existing.medicationId !== id)
        throw new ConflictException();
      const revision = body.expectedRevision + 1,
        eventId = randomUUID(),
        action = revision === 1 ? 'reconciliation' : 'correction';
      const candidate = {
        id: eventId,
        medicationId: id,
        patientId: p,
        ...source,
        revision,
        action,
        recordedStatus: body.recordedStatus,
        fields,
        requestId,
        payloadHash: hash,
        actorAccountId: actor.accountId,
        recordedAt: new Date(),
      } as Row;
      if (!(await this.sourceCurrent(db, candidate)))
        throw new ConflictException();
      await db.$executeRaw`INSERT INTO fmv.medication_reconciliations(id,medication_id,patient_id,document_id,candidate_id,source_revision,source_sha256,lifecycle_version,review_revision,revision,action,recorded_status,fields,request_id,payload_hash,actor_account_id) VALUES(${eventId}::uuid,${id}::uuid,${p}::uuid,${source.documentId}::uuid,${source.candidateId},${source.sourceRevision},${source.sourceSha256},${source.lifecycleVersion},${source.reviewRevision},${revision},${action},${body.recordedStatus},${JSON.stringify(fields)}::jsonb,${requestId}::uuid,${hash},${actor.accountId}::uuid)`;
      await this.audit(
        db,
        p,
        actor.accountId,
        [candidate],
        revision === 1 ? 'medication.reconciled' : 'medication.corrected',
      );
      await this.auth(db, principal, p, [source.documentId], true);
      return { saved: true as const, revision };
    });
  }
}
