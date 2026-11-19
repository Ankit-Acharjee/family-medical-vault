import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { isAccessActivity, isActivityCursor } from '@fmv/contracts';
import type { AccessActivityEvent } from '@fmv/contracts';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { Principal } from '../identity/person.store.js';
import { isUuid } from '../access/permission.service.js';
import {
  lockAccessPatient,
  transactionActor,
} from '../access/transaction-access.store.js';
type Cursor = { patientId: string; at: string; source: string; id: string };
export function decodeActivityCursor(
  value: unknown,
  patientId: string,
): Cursor | null {
  if (value === undefined) return null;
  if (!isActivityCursor(value)) throw new BadRequestException();
  try {
    const text = Buffer.from(value, 'base64url');
    if (text.toString('base64url') !== value) throw Error();
    const c = JSON.parse(text.toString('utf8'));
    if (
      !c ||
      typeof c !== 'object' ||
      Object.keys(c).length !== 4 ||
      c.patientId !== patientId ||
      !isUuid(c.id) ||
      c.id !== c.id.toLowerCase() ||
      !['document', 'shared-link'].includes(c.source) ||
      typeof c.at !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(c.at) ||
      new Date(c.at).toISOString() !== c.at
    )
      throw Error();
    return c;
  } catch {
    throw new BadRequestException();
  }
}
export class AccessActivityService implements OnModuleDestroy {
  private readonly db: PrismaClient | null;
  constructor(url: string | null) {
    this.db = url
      ? new PrismaClient({
          adapter: new PrismaPg({
            connectionString: url,
            options: '-c timezone=UTC',
            max: 2,
            connectionTimeoutMillis: 5000,
          }),
          log: [],
        })
      : null;
  }
  async onModuleDestroy() {
    await this.db?.$disconnect();
  }
  private async owner(
    db: Prisma.TransactionClient,
    principal: Principal,
    p: string,
  ) {
    const actor = await transactionActor(db, principal);
    const rows = await db.$queryRaw<
      { id: string }[]
    >`SELECT id FROM fmv.persons WHERE id=${p}::uuid AND owner_account_id=${actor}::uuid`;
    if (rows.length !== 1) throw new NotFoundException();
    return actor;
  }
  async read(
    principal: Principal,
    patientId: string,
    cursor: unknown = undefined,
  ) {
    if (!isUuid(patientId)) throw new NotFoundException();
    const p = patientId.toLowerCase(),
      before = decodeActivityCursor(cursor, p);
    if (!this.db) throw new ServiceUnavailableException();
    try {
      return await this.db.$transaction(
        async (db) => {
          await db.$executeRaw`SET LOCAL statement_timeout='8s'`;
          await lockAccessPatient(db, p);
          const actor = await this.owner(db, principal, p);
          // No resource contents or provider identities are read. Patient-scoped opaque
          // document references identify affected resources without disclosing titles.
          // Each branch is capped before the merge; no more than42 candidates escape it.
          const rows = await db.$queryRaw<
            (Omit<AccessActivityEvent, 'recordedAt'> & { recordedAt: Date })[]
          >`
          WITH boundary AS (SELECT statement_timestamp() AS now), events AS (
            (SELECT e.id,'document'::text AS source,e.kind,
              CASE WHEN e.actor_account_id=${actor}::uuid THEN 'you' ELSE 'authenticated-account' END AS actor,
              e.occurred_at AS "recordedAt",e.document_id AS "documentId",(SELECT COALESCE(d.display_title,d.title) FROM fmv.documents d WHERE d.id=e.document_id AND d.patient_id=${p}::uuid) AS "documentLabel"
             FROM fmv.document_events e CROSS JOIN boundary b
             WHERE e.patient_id=${p}::uuid AND e.kind IN ('document.viewed','document.exported')
               AND EXISTS(SELECT 1 FROM fmv.documents d WHERE d.id=e.document_id AND d.patient_id=${p}::uuid)
               AND e.occurred_at>=b.now-'90 days'::interval AND e.occurred_at<=b.now AND e.retention_until>b.now
               AND (${before?.at ?? null}::timestamptz IS NULL OR (e.occurred_at,'document'::text,e.id)<(${before?.at ?? null}::timestamptz,${before?.source ?? ''}::text,${before?.id ?? null}::uuid))
             ORDER BY e.occurred_at DESC,e.id DESC LIMIT 21)
            UNION ALL
            (SELECT e.id,'shared-link'::text AS source,e.kind,'anonymous-link-holder'::text AS actor,
              e.recorded_at AS "recordedAt",e.document_id AS "documentId",(SELECT COALESCE(d.display_title,d.title) FROM fmv.documents d WHERE d.id=e.document_id AND d.patient_id=${p}::uuid) AS "documentLabel"
             FROM fmv.temporary_link_access_events e JOIN fmv.temporary_links l ON l.id=e.link_id CROSS JOIN boundary b
             WHERE l.patient_id=${p}::uuid AND e.kind IN ('link.opened','original.accessed')
               AND (e.document_id IS NULL OR EXISTS(SELECT 1 FROM fmv.documents d WHERE d.id=e.document_id AND d.patient_id=${p}::uuid))
               AND e.recorded_at>=b.now-'90 days'::interval AND e.recorded_at<=b.now AND e.retention_until>b.now
               AND (${before?.at ?? null}::timestamptz IS NULL OR (e.recorded_at,'shared-link'::text,e.id)<(${before?.at ?? null}::timestamptz,${before?.source ?? ''}::text,${before?.id ?? null}::uuid))
             ORDER BY e.recorded_at DESC,e.id DESC LIMIT 21)
          ) SELECT * FROM events ORDER BY "recordedAt" DESC,source DESC,id DESC LIMIT 21`;
          const events = rows
            .slice(0, 20)
            .map((e) => ({ ...e, recordedAt: e.recordedAt.toISOString() }));
          const last = events.at(-1);
          const result = {
            patientId: p,
            events,
            nextCursor:
              rows.length > 20 && last
                ? Buffer.from(
                    JSON.stringify({
                      patientId: p,
                      at: last.recordedAt,
                      source: last.source,
                      id: last.id,
                    }),
                  ).toString('base64url')
                : null,
          };
          if (!isAccessActivity(result))
            throw new ServiceUnavailableException();
          if ((await this.owner(db, principal, p)) !== actor)
            throw new NotFoundException();
          return result;
        },
        { maxWait: 5000, timeout: 15000 },
      );
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof BadRequestException)
        throw e;
      throw new ServiceUnavailableException();
    }
  }
}
