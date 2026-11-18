import { verifySummaryExport } from './summary-export-database.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GroundedSummaryService } from '../../dist/summaries/grounded-summary.service.js';
import { ManualReadingsService } from '../../dist/measurements/manual-readings.service.js';
import { isGroundedSummary } from '@fmv/contracts';
export async function verifyGroundedSummary(f, medications, medicationId) {
  const {
    runtimeUrl,
    runtime,
    owner,
    principal,
    reader,
    patient,
    ownerAccountId,
    readerAccountId,
    insertGrant,
    id,
  } = f;
  const manual = new ManualReadingsService(runtimeUrl.href),
    summary = new GroundedSummaryService(runtimeUrl.href, manual, medications),
    readingId = randomUUID();
  const status = (n) => (e) => e.getStatus?.() === n;
  const grants = [];
  try {
    await manual.save(principal, patient.id, readingId, {
      requestId: randomUUID(),
      expectedRevision: 0,
      confirmed: true,
      reading: {
        kind: 'glucose',
        unit: 'mg/dL',
        observedAt: '2024-02-29T00:30:00+14:00',
        values: { value: '100.00000000000001' },
      },
    });
    const result = await summary.read(principal, patient.id);
    assert.equal(isGroundedSummary(result), true);
    assert.equal(
      result.medications.some((m) => m.entry.medicationId === medicationId),
      true,
    );
    assert.equal(
      result.manual.some((m) => m.readingId === readingId),
      true,
    );
    assert.equal(result.medicationMeaning, 'current-record-snapshot');
    const period = await summary.read(principal, patient.id, {
      fromDate: '2024-02-28',
      toDate: '2024-02-28',
    });
    assert.equal(
      period.manual.some((m) => m.readingId === readingId),
      false,
    );
    assert.equal(
      period.medications.some((m) => m.entry.medicationId === medicationId),
      true,
    );
    const reported = await summary.read(principal, patient.id, {
      scope: 'manual',
      fromDate: '2024-02-29',
      toDate: '2024-02-29',
    });
    assert.equal(
      reported.manual.find((m) => m.readingId === readingId).reading.observedAt,
      '2024-02-29T00:30:00+14:00',
    );
    assert.deepEqual(reported.medications, []);
    await assert.rejects(summary.read(reader, patient.id), status(404));
    const fixture = {
      patientId: patient.id,
      caregiverAccountId: readerAccountId,
      ownerAccountId,
    };
    const scoped = await insertGrant(runtime, fixture, {
      actions: ['view'],
      scopeKind: 'document',
      documentId: id,
    });
    grants.push(scoped.id ?? scoped);
    await assert.rejects(
      summary.read(reader, patient.id, { scope: 'laboratory' }),
      status(404),
    );
    const whole = await insertGrant(runtime, fixture, {
      actions: ['view'],
      scopeKind: 'patient',
    });
    grants.push(whole.id ?? whole);
    assert.equal(
      isGroundedSummary(await summary.read(reader, patient.id)),
      true,
    );
    await owner.query(
      'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1::uuid',
      [whole.id ?? whole],
    );
    await assert.rejects(summary.read(reader, patient.id), status(404));
    await assert.rejects(summary.read(principal, randomUUID()), status(404));
    const counts = async () =>
      (
        await runtime.query(
          'SELECT (SELECT count(*)::int FROM fmv.manual_measurement_events WHERE patient_id=$1::uuid) manual,(SELECT count(*)::int FROM fmv.medication_reconciliation_events WHERE patient_id=$1::uuid) medication',
          [patient.id],
        )
      ).rows[0];
    const before = await counts();
    try {
      await owner.query(
        "CREATE FUNCTION fmv.synthetic_summary_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$",
      );
      await owner.query(
        'CREATE TRIGGER synthetic_summary_audit_failure BEFORE INSERT ON fmv.medication_reconciliation_events FOR EACH ROW EXECUTE FUNCTION fmv.synthetic_summary_audit_failure()',
      );
      await assert.rejects(summary.read(principal, patient.id), status(503));
      assert.deepEqual(await counts(), before);
    } finally {
      await owner.query(
        'DROP TRIGGER IF EXISTS synthetic_summary_audit_failure ON fmv.medication_reconciliation_events',
      );
      await owner.query(
        'DROP FUNCTION IF EXISTS fmv.synthetic_summary_audit_failure()',
      );
    }
    await verifySummaryExport(f, summary, manual);
    await manual.withdraw(principal, patient.id, readingId, {
      requestId: randomUUID(),
      expectedRevision: 1,
      confirmed: true,
    });
    assert.equal(
      (
        await summary.read(principal, patient.id, { scope: 'manual' })
      ).manual.some((m) => m.readingId === readingId),
      false,
    );
  } finally {
    if (grants.length)
      await owner.query(
        'UPDATE fmv.access_grants SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=ANY($1::uuid[])',
        [grants],
      );
    await summary.onModuleDestroy();
    await manual.onModuleDestroy();
  }
}
