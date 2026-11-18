import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  isGroundedSummaryRequest,
  projectGroundedSummary,
} from '@fmv/contracts';
import type { GroundedSummaryRequest } from '@fmv/contracts';
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
  constructor(
    url: string | null,
    private readonly manual: ManualReadingsService,
    private readonly medications: MedicationReconciliationService,
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
        )
      )
        throw new NotFoundException();
  }
  async read(principal: Principal, patientId: string, query: unknown = {}) {
    const p = patientId.toLowerCase(),
      request = summaryRequest(query);
    if (!isUuid(p)) throw new NotFoundException();
    if (!this.db) throw new ServiceUnavailableException();
    try {
      return await this.db.$transaction(
        async (db) => {
          await db.$executeRaw`SET LOCAL statement_timeout='8s'`;
          await lockAccessPatient(db, p);
          await this.authorize(db, principal, p);
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
          await this.authorize(db, principal, p, ids);
          return result;
        },
        { maxWait: 5000, timeout: 15000 },
      );
    } catch (e) {
      if (
        e instanceof BadRequestException ||
        e instanceof NotFoundException ||
        e instanceof ServiceUnavailableException
      )
        throw e;
      throw new ServiceUnavailableException();
    }
  }
}
