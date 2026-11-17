import { medicationScheduleDefinitionValue } from '@fmv/contracts';
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  isMedicationScheduleEntry,
  isMedicationScheduleHistory,
  isSaveMedicationSchedule,
} from '@fmv/contracts';
import type {
  MedicationScheduleEntry,
  MedicationScheduleHistory,
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
  definition: MedicationScheduleEntry['definition'];
  action: MedicationScheduleEntry['action'];
  recordedState: MedicationScheduleEntry['recordedState'];
  recordedAt: Date;
  requestId: string;
  payloadHash: string;
  actorAccountId: string;
};
function entry(r: Row): MedicationScheduleEntry {
  const value = {
    patientId: r.patientId,
    medicationId: r.medicationId,
    medicationRevision: r.medicationRevision,
    revision: r.revision,
    definition: r.definition,
    action: r.action,
    recordedState: r.recordedState,
    recordedAt: r.recordedAt.toISOString(),
    meaning: 'owner-recorded-informational-schedule' as const,
  };
  if (!isMedicationScheduleEntry(value))
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
  >`SELECT id,patient_id AS "patientId",medication_id AS "medicationId",medication_revision AS "medicationRevision",revision,definition,action,recorded_state AS "recordedState",recorded_at AS "recordedAt",request_id AS "requestId",payload_hash AS "payloadHash",actor_account_id AS "actorAccountId" FROM fmv.medication_schedules WHERE patient_id=${c.patientId}::uuid AND medication_id=${c.medicationId}::uuid AND revision<=${before} ORDER BY revision DESC LIMIT ${limit}`;
}
async function audit(
  db: Tx,
  c: MedicationRecordContext,
  ids: string[],
  kind: string,
) {
  for (const id of ids)
    await db.$executeRaw`INSERT INTO fmv.medication_schedule_events(id,patient_id,medication_id,entry_id,actor_account_id,kind) VALUES(${randomUUID()}::uuid,${c.patientId}::uuid,${c.medicationId}::uuid,${id}::uuid,${c.accountId}::uuid,${kind})`;
}
export async function readSchedule(
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
  const result: MedicationScheduleHistory = {
    patientId: c.patientId,
    medicationId: c.medicationId,
    medicationRevision: c.medicationRevision,
    canWrite: c.owner,
    sourceState: c.sourceState,
    current: latest ? entry(latest) : null,
    history: visible.map(entry),
    nextBeforeRevision: all.length > 20 ? visible.at(-1)!.revision - 1 : null,
  };
  if (!isMedicationScheduleHistory(result))
    throw new ServiceUnavailableException();
  await audit(
    db,
    c,
    [...new Set([...(latest ? [latest.id] : []), ...visible.map((r) => r.id)])],
    'medication.schedule.viewed',
  );
  return result;
}
export async function saveSchedule(
  db: Tx,
  c: MedicationRecordContext,
  input: unknown,
) {
  if (!isSaveMedicationSchedule(input)) throw new BadRequestException();
  const body = input,
    definition = medicationScheduleDefinitionValue(body.definition);
  if (body.medicationRevision !== c.medicationRevision)
    throw new ConflictException();
  const hash = createHash('sha256')
      .update(
        JSON.stringify({
          expectedRevision: body.expectedRevision,
          medicationRevision: body.medicationRevision,
          meaning: body.meaning,
          confirmed: true,
          definition,
          recordedState: body.recordedState,
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
  >`SELECT EXISTS(SELECT 1 FROM fmv.medication_schedules WHERE medication_id=${c.medicationId}::uuid AND request_id=${requestId}::uuid) present`;
  const retirement =
    !!latest &&
    latest.recordedState === 'recorded' &&
    body.recordedState === 'retired' &&
    JSON.stringify(medicationScheduleDefinitionValue(latest.definition)) ===
      JSON.stringify(definition);
  if (
    used?.present ||
    body.expectedRevision !== (latest?.revision ?? 0) ||
    (!latest && body.recordedState !== 'recorded') ||
    (c.sourceState !== 'current-source' && !retirement)
  )
    throw new ConflictException();
  const id = randomUUID(),
    revision = body.expectedRevision + 1,
    action =
      revision === 1 ? 'recording' : retirement ? 'retirement' : 'correction';
  await db.$executeRaw`INSERT INTO fmv.medication_schedules(id,patient_id,medication_id,medication_entry_id,medication_revision,revision,action,recorded_state,definition,request_id,payload_hash,actor_account_id) VALUES(${id}::uuid,${c.patientId}::uuid,${c.medicationId}::uuid,${c.medicationEntryId}::uuid,${c.medicationRevision},${revision},${action},${body.recordedState},${JSON.stringify(definition)}::jsonb,${requestId}::uuid,${hash},${c.accountId}::uuid)`;
  await audit(
    db,
    c,
    [id],
    revision === 1
      ? 'medication.schedule.recorded'
      : retirement
        ? 'medication.schedule.retired'
        : 'medication.schedule.corrected',
  );
  return { saved: true as const, revision };
}
