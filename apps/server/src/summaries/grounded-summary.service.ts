import { createHash, randomUUID } from 'node:crypto';
import { summaryArchive } from './summary-archive.js';
import {
  BadRequestException,
  ConflictException,
  PayloadTooLargeException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  isGroundedSummaryRequest,
  projectGroundedSummary,
  isSummaryExportRequest,
  canonicalSummarySnapshot,
} from '@fmv/contracts';
import type { GroundedSummary, GroundedSummaryRequest } from '@fmv/contracts';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { Principal } from '../identity/person.store.js';
import { PermissionService, isUuid } from '../access/permission.service.js';
import {
  TransactionAccessStore,
  lockAccessPatient,
} from '../access/transaction-access.store.js';
import { readMeasurementWorkspace } from '../measurements/measurement-workspace.store.js';
import { ManualReadingsService } from '../measurements/manual-readings.service.js';
import { MedicationReconciliationService } from '../medications/medication-reconciliation.service.js';
type Tx = Prisma.TransactionClient;
export function summaryRequest(query: unknown): GroundedSummaryRequest {
  if (
    !query ||
    typeof query !== 'object' ||
    Array.isArray(query) ||
    Object.keys(query).some((k) => !['scope', 'fromDate', 'toDate'].includes(k))
  )
    throw new BadRequestException();
  const q = query as Record<string, unknown>;
  const value = {
    scope: q.scope === undefined ? 'patient' : q.scope,
    period:
      q.fromDate === undefined && q.toDate === undefined
        ? null
        : { fromDate: q.fromDate, toDate: q.toDate },
  };
  if (!isGroundedSummaryRequest(value)) throw new BadRequestException();
  return value;
}
export class GroundedSummaryService implements OnModuleDestroy {
  private readonly db: PrismaClient | null;
  private activeExports = 0;
  constructor(
    url: string | null,
    private readonly manual: ManualReadingsService,
    private readonly medications: MedicationReconciliationService,
    private readonly archive: typeof summaryArchive = summaryArchive,
  ) {
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
  private async authorize(
    db: Tx,
    principal: Principal,
    p: string,
    ids: string[] = [],
    exporting = false,
  ) {
    // Metadata first; use one fresh snapshot after these reads, without awaiting
    // per-document I/O between expiry checks and the disclosure boundary.
    const docs = ids.length
      ? await db.$queryRaw<
          {
            id: string;
            patientId: string;
            categoryId: string;
            state: 'pending' | 'ready' | 'failed';
            deletedAt: Date | null;
          }[]
        >`SELECT id,patient_id AS "patientId",category_id AS "categoryId",state,deleted_at AS "deletedAt" FROM fmv.documents WHERE patient_id=${p}::uuid AND id=ANY(${ids}::uuid[])`
      : [];
    const permissions = new PermissionService(new TransactionAccessStore(db));
    const snapshot = await permissions.snapshot(principal, p);
    if (
      !permissions.allows(snapshot, 'view', { kind: 'patient' }) ||
      (exporting &&
        !permissions.allows(snapshot, 'export', { kind: 'patient' })) ||
      docs.length !== ids.length
    )
      throw new NotFoundException();
    for (const d of docs)
      if (
        d.state !== 'ready' ||
        d.deletedAt ||
        !permissions.allows(
          snapshot,
          'view',
          { kind: 'document', documentId: d.id },
          d,
        ) ||
        (exporting &&
          !permissions.allows(
            snapshot,
            'export',
            { kind: 'document', documentId: d.id },
            d,
          ))
      )
        throw new NotFoundException();
    return {
      accountId: snapshot.accountId!,
      patientName: snapshot.patient!.displayName,
    };
  }
  private async snapshot(
    db: Tx,
    principal: Principal,
    p: string,
    request: GroundedSummaryRequest,
    exporting = false,
  ) {
    await this.authorize(db, principal, p, [], exporting);
    const laboratory =
      request.scope === 'patient' || request.scope === 'laboratory'
        ? await readMeasurementWorkspace(db, principal, p)
        : {
            patientId: p,
            canConfirm: false,
            measurements: [],
            measurementsLimited: false,
            comparisons: [],
            comparisonsLimited: false,
            sources: [],
          };
    const manual =
      request.scope === 'patient' || request.scope === 'manual'
        ? await this.manual.readPageInTransaction(db, principal, p)
        : {
            patientId: p,
            canWrite: false,
            entries: [],
            nextCursor: null,
          };
    const medications =
      request.scope === 'patient' || request.scope === 'medication'
        ? await this.medications.readPageInTransaction(db, principal, p)
        : {
            patientId: p,
            canWrite: false,
            entries: [],
            nextCursor: null,
          };
    const result = projectGroundedSummary({
      patientId: p,
      generatedAt: new Date().toISOString(),
      request,
      laboratory,
      manual,
      medications,
    });
    if (!result) throw new ServiceUnavailableException();
    const ids = [
      ...new Set([
        ...result.laboratory.sources.map((s) => s.documentId),
        ...result.medications.map((m) => m.entry.source.documentId),
      ]),
    ];
    const actor = await this.authorize(db, principal, p, ids, exporting);
    return { summary: result, ...actor };
  }
  private async transaction<T>(
    p: string,
    work: (db: Tx) => Promise<T>,
  ): Promise<T> {
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
        e instanceof NotFoundException ||
        e instanceof ConflictException ||
        e instanceof PayloadTooLargeException ||
        e instanceof ServiceUnavailableException
      )
        throw e;
      throw new ServiceUnavailableException();
    }
  }
  async read(principal: Principal, patientId: string, query: unknown = {}) {
    const p = patientId.toLowerCase(),
      request = summaryRequest(query);
    return this.transaction(
      p,
      async (db) => (await this.snapshot(db, principal, p, request)).summary,
    );
  }
  async export(
    principal: Principal,
    patientId: string,
    input: unknown,
    signal: AbortSignal,
  ) {
    if (!isSummaryExportRequest(input)) throw new BadRequestException();
    const p = patientId.toLowerCase();
    let acquired = false;
    const fingerprint = (summary: GroundedSummary) => {
      const canonical = canonicalSummarySnapshot(summary);
      if (canonical === null) throw new ServiceUnavailableException();
      return createHash('sha256').update(canonical).digest('hex');
    };
    try {
      const prepared = await this.transaction(p, async (db) => {
        signal.throwIfAborted();
        await this.authorize(db, principal, p, [], true);
        if (this.activeExports >= 2) throw new ServiceUnavailableException();
        this.activeExports++;
        acquired = true;
        const snapshot = await this.snapshot(
          db,
          principal,
          p,
          input.request,
          true,
        );
        if (fingerprint(snapshot.summary) !== input.snapshotSha256)
          throw new ConflictException();
        signal.throwIfAborted();
        return snapshot;
      });
      const bytes = await this.archive(
        prepared.summary,
        prepared.patientName,
        signal,
      );
      signal.throwIfAborted();
      const artifactSha = createHash('sha256').update(bytes).digest('hex');
      await this.transaction(p, async (db) => {
        signal.throwIfAborted();
        const current = await this.snapshot(
          db,
          principal,
          p,
          input.request,
          true,
        );
        if (
          fingerprint(current.summary) !== input.snapshotSha256 ||
          current.patientName !== prepared.patientName
        )
          throw new ConflictException();
        const ids = [
            ...new Set([
              ...current.summary.laboratory.sources.map((s) => s.documentId),
              ...current.summary.medications.map(
                (m) => m.entry.source.documentId,
              ),
            ]),
          ],
          manualIds = current.summary.manual.map((m) => m.readingId),
          medicationIds = current.summary.medications.map(
            (m) => m.entry.medicationId,
          );
        await db.$executeRaw`INSERT INTO fmv.summary_export_events(id,patient_id,actor_account_id,request_id,scope,snapshot_sha256,artifact_sha256,bytes,source_document_ids,manual_reading_ids,medication_ids) VALUES(${randomUUID()}::uuid,${p}::uuid,${current.accountId}::uuid,${input.requestId}::uuid,${input.request.scope},${input.snapshotSha256},${artifactSha},${bytes.length},${ids}::uuid[],${manualIds}::uuid[],${medicationIds}::uuid[])`;
        await this.authorize(db, principal, p, ids, true);
        signal.throwIfAborted();
      });
      return { bytes };
    } catch (e) {
      if (
        e instanceof BadRequestException ||
        e instanceof NotFoundException ||
        e instanceof ConflictException ||
        e instanceof PayloadTooLargeException ||
        e instanceof ServiceUnavailableException
      )
        throw e;
      throw new ServiceUnavailableException();
    } finally {
      if (acquired) this.activeExports--;
    }
  }
}
