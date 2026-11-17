import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  isMedicationInventoryEntry,
  isMedicationInventoryHistory,
  isSaveMedicationInventory,
} from '@fmv/contracts';
import type {
  MedicationInventoryEntry,
  MedicationInventoryHistory,
} from '@fmv/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import type { MedicationRecordContext } from './medication-record-context.js';
type Tx = Prisma.TransactionClient;

type Row = {
  id: string;
  patientId: string;
  medicationId: string;
  medicationRevision: number;
  revision: number;
  fields: MedicationInventoryEntry['fields'];
  recordedAt: Date;
  requestId: string;
  payloadHash: string;
  actorAccountId: string;
};
function entry(r: Row): MedicationInventoryEntry {
  const value = {
    patientId: r.patientId,
    medicationId: r.medicationId,
    medicationRevision: r.medicationRevision,
    revision: r.revision,
    fields: r.fields,
    recordedAt: r.recordedAt.toISOString(),
    meaning: 'owner-reported-inventory' as const,
  };
  if (!isMedicationInventoryEntry(value))
    throw new ServiceUnavailableException();
  return value;
}
async function rows(
  db: Tx,
  c: MedicationRecordContext,
  before = 2147483647,
  limit = 21,
) {
  return db.$queryRaw<
    Row[]
  >`SELECT id,patient_id AS "patientId",medication_id AS "medicationId",medication_revision AS "medicationRevision",revision,fields,recorded_at AS "recordedAt",request_id AS "requestId",payload_hash AS "payloadHash",actor_account_id AS "actorAccountId" FROM fmv.medication_inventory WHERE patient_id=${c.patientId}::uuid AND medication_id=${c.medicationId}::uuid AND revision<=${before} ORDER BY revision DESC LIMIT ${limit}`;
}
async function audit(
  db: Tx,
  c: MedicationRecordContext,
  ids: string[],
  kind: string,
) {
  for (const id of ids)
    await db.$executeRaw`INSERT INTO fmv.medication_inventory_events(id,patient_id,medication_id,entry_id,actor_account_id,kind) VALUES(${randomUUID()}::uuid,${c.patientId}::uuid,${c.medicationId}::uuid,${id}::uuid,${c.accountId}::uuid,${kind})`;
}
export async function readInventory(
  db: Tx,
  c: MedicationRecordContext,
  query: unknown,
) {
  if (
    !query ||
    typeof query !== 'object' ||
    Array.isArray(query) ||
    Object.keys(query).some((k) => k !== 'beforeRevision')
  )
    throw new BadRequestException();
  const [latest] = await rows(db, c, 2147483647, 1),
    raw = (query as Record<string, unknown>).beforeRevision;
  const before =
    raw === undefined
      ? (latest?.revision ?? 1)
      : typeof raw === 'string' &&
          /^[1-9][0-9]{0,9}$/.test(raw) &&
          String(Number(raw)) === raw
        ? Number(raw)
        : 0;
  if (
    before < 1 ||
    before > 2147483647 ||
    (latest ? before > latest.revision : raw !== undefined)
  )
    throw new BadRequestException();
  const all = latest ? await rows(db, c, before) : [],
    visible = all.slice(0, 20);
  const result: MedicationInventoryHistory = {
    patientId: c.patientId,
    medicationId: c.medicationId,
    medicationRevision: c.medicationRevision,
    canWrite: c.owner,
    sourceState: c.sourceState,
    current: latest ? entry(latest) : null,
    history: visible.map(entry),
    nextBeforeRevision: all.length > 20 ? visible.at(-1)!.revision - 1 : null,
  };
  if (!isMedicationInventoryHistory(result))
    throw new ServiceUnavailableException();
  await audit(
    db,
    c,
    [...new Set([...(latest ? [latest.id] : []), ...visible.map((r) => r.id)])],
    'medication.inventory.viewed',
  );
  return result;
}
export async function saveInventory(
  db: Tx,
  c: MedicationRecordContext,
  input: unknown,
) {
  if (!isSaveMedicationInventory(input)) throw new BadRequestException();
  const body = input,
    fields = {
      quantity: body.fields.quantity,
      expiry: body.fields.expiry,
      refill: body.fields.refill,
    };
  if (body.medicationRevision !== c.medicationRevision)
    throw new ConflictException();
  const hash = createHash('sha256')
      .update(
        JSON.stringify({
          expectedRevision: body.expectedRevision,
          medicationRevision: body.medicationRevision,
          meaning: body.meaning,
          confirmed: true,
          fields,
        }),
      )
      .digest('hex'),
    requestId = body.requestId.toLowerCase();
  const [latest] = await rows(db, c, 2147483647, 1);
  if (latest?.requestId === requestId) {
    if (latest.payloadHash !== hash || latest.actorAccountId !== c.accountId)
      throw new ConflictException();
    return { saved: true as const, revision: latest.revision };
  }
  const [used] = await db.$queryRaw<
    { present: boolean }[]
  >`SELECT EXISTS(SELECT 1 FROM fmv.medication_inventory WHERE medication_id=${c.medicationId}::uuid AND request_id=${requestId}::uuid) present`;
  if (
    used?.present ||
    body.expectedRevision !== (latest?.revision ?? 0) ||
    c.sourceState !== 'current-source'
  )
    throw new ConflictException();
  const id = randomUUID(),
    revision = body.expectedRevision + 1;
  await db.$executeRaw`INSERT INTO fmv.medication_inventory(id,patient_id,medication_id,medication_entry_id,medication_revision,revision,fields,request_id,payload_hash,actor_account_id) VALUES(${id}::uuid,${c.patientId}::uuid,${c.medicationId}::uuid,${c.medicationEntryId}::uuid,${c.medicationRevision},${revision},${JSON.stringify(fields)}::jsonb,${requestId}::uuid,${hash},${c.accountId}::uuid)`;
  await audit(
    db,
    c,
    [id],
    revision === 1
      ? 'medication.inventory.recorded'
      : 'medication.inventory.corrected',
  );
  return { saved: true as const, revision };
}
