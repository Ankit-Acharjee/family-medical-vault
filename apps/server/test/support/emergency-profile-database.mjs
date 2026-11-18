import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PrismaPersonStore } from '../../dist/identity/person.store.js';
import { EmergencyProfileService } from '../../dist/emergency/emergency-profile.service.js';
export async function verifyEmergencyProfile(runtimeUrl, owner, insertGrant) {
  const runtime = new pg.Client({ connectionString: runtimeUrl.href }),
    people = new PrismaPersonStore(runtimeUrl.href),
    service = new EmergencyProfileService(runtimeUrl.href),
    other = new EmergencyProfileService(runtimeUrl.href);
  await runtime.connect();
  try {
    const principal = {
        issuer: 'https://emergency.example.test',
        subject: randomUUID(),
      },
      reader = { ...principal, subject: randomUUID() },
      patient = await people.create(principal, 'Synthetic emergency owner'),
      recipient = await people.create(reader, 'Synthetic emergency reader');
    const account = async (p) =>
        (
          await runtime.query(
            'SELECT owner_account_id id FROM fmv.persons WHERE id=$1::uuid',
            [p],
          )
        ).rows[0].id,
      actor = await account(patient.id),
      readerActor = await account(recipient.id),
      fixture = {
        patientId: patient.id,
        caregiverAccountId: readerActor,
        ownerAccountId: actor,
      },
      status = (n) => (e) => e.getStatus?.() === n;
    const fields = {
        contactName: 'Synthetic contact',
        contactRelationship: null,
        contactPhone: '+1 555 0100',
        note: 'Owner-reported note',
      },
      make = (expectedRevision, f = fields) => ({
        requestId: randomUUID(),
        expectedRevision,
        fields: f,
        confirmed: true,
      }),
      first = make(0);
    assert.equal((await service.read(principal, patient.id)).profile, null);
    await assert.rejects(service.read(reader, patient.id), status(404));
    await insertGrant(runtime, fixture, {
      actions: ['edit', 'manage', 'export'],
    });
    await assert.rejects(service.save(reader, patient.id, first), status(404));
    const categoryId = randomUUID();
    await owner.query(
      "INSERT INTO fmv.document_categories(id,slug,name) VALUES($1,$2,'Synthetic emergency category')",
      [categoryId, randomUUID()],
    );
    await insertGrant(runtime, fixture, {
      actions: ['view'],
      scopeKind: 'category',
      categoryId,
    });
    await assert.rejects(service.read(reader, patient.id), status(404));
    assert.deepEqual(await service.save(principal, patient.id, first), {
      saved: true,
      revision: 1,
    });
    assert.deepEqual(
      await service.save(principal, patient.id.toUpperCase(), first),
      { saved: true, revision: 1 },
    );
    await assert.rejects(
      service.save(principal, patient.id, {
        ...first,
        fields: { ...fields, note: 'Changed replay' },
      }),
      status(409),
    );
    const retention = (
      await runtime.query(
        'SELECT kind,retention_until IS NULL durable FROM fmv.emergency_profile_events WHERE patient_id=$1',
        [patient.id],
      )
    ).rows;
    assert.ok(retention.some((e) => e.kind === 'emergency.saved' && e.durable));
    assert.ok(
      retention.some((e) => e.kind === 'emergency.viewed' && !e.durable),
    );
    await assert.rejects(
      runtime.query(
        "INSERT INTO fmv.emergency_profile_events(id,patient_id,actor_account_id,kind) VALUES($1,$2,$3,'emergency.saved')",
        [randomUUID(), patient.id, readerActor],
      ),
      (e) => e.code === '23514',
    );
    const grant = await insertGrant(runtime, fixture, { actions: ['view'] });
    const read = await service.read(reader, patient.id);
    assert.equal(read.canWrite, false);
    assert.equal(read.profile.provenance, 'owner-reported');
    assert.deepEqual(read.profile.fields, fields);
    await assert.rejects(
      service.save(reader, patient.id, make(1)),
      status(404),
    );
    const races = await Promise.allSettled([
      service.save(
        principal,
        patient.id,
        make(1, { ...fields, note: 'First race' }),
      ),
      other.save(
        principal,
        patient.id,
        make(1, { ...fields, note: 'Second race' }),
      ),
    ]);
    assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1);
    assert.ok(
      races.some(
        (r) => r.status === 'rejected' && r.reason.getStatus() === 409,
      ),
    );
    const empty = {
      contactName: null,
      contactRelationship: null,
      contactPhone: null,
      note: null,
    };
    await service.save(principal, patient.id, make(2, empty));
    assert.deepEqual(
      (await service.read(principal, patient.id)).profile.fields,
      empty,
    );
    assert.equal(
      (
        await runtime.query(
          'SELECT count(*)::int n FROM fmv.emergency_profile_entries WHERE patient_id=$1',
          [patient.id],
        )
      ).rows[0].n,
      3,
    );
    await runtime.query(
      'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1',
      [grant.id],
    );
    await assert.rejects(service.read(reader, patient.id), status(404));
    for (const invalid of [
      { ...fields, note: 'x'.repeat(1001) },
      { ...fields, unexpected: true },
      { ...fields, contactPhone: 42 },
    ]) {
      assert.equal(
        (
          await runtime.query(
            'SELECT fmv.emergency_fields_valid($1::jsonb) valid',
            [invalid],
          )
        ).rows[0].valid,
        false,
      );
    }
    await assert.rejects(
      runtime.query(
        'UPDATE fmv.emergency_profile_entries SET fields=$1 WHERE patient_id=$2',
        [fields, patient.id],
      ),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      runtime.query(
        'INSERT INTO fmv.emergency_profile_entries(id,patient_id,actor_account_id,revision,request_id,payload_sha256,fields) VALUES($1,$2,$3,4,$4,$5,$6)',
        [
          randomUUID(),
          patient.id,
          readerActor,
          randomUUID(),
          'a'.repeat(64),
          fields,
        ],
      ),
      (e) => e.code === '23514',
    );
    await assert.rejects(
      runtime.query(
        'INSERT INTO fmv.emergency_profile_entries(id,patient_id,actor_account_id,revision,request_id,payload_sha256,fields,recorded_at) VALUES($1,$2,$3,4,$4,$5,$6,clock_timestamp())',
        [randomUUID(), patient.id, actor, randomUUID(), 'a'.repeat(64), fields],
      ),
      (e) => e.code === '42501',
    );
    await owner.query(
      "CREATE FUNCTION fmv.test_emergency_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Synthetic audit unavailable'; END$$",
    );
    await owner.query(
      'CREATE TRIGGER test_emergency_audit_fail BEFORE INSERT ON fmv.emergency_profile_events FOR EACH ROW EXECUTE FUNCTION fmv.test_emergency_audit_fail()',
    );
    try {
      await assert.rejects(
        service.save(principal, patient.id, make(3)),
        status(503),
      );
      await assert.rejects(service.read(principal, patient.id), status(503));
    } finally {
      await owner.query(
        'DROP TRIGGER test_emergency_audit_fail ON fmv.emergency_profile_events',
      );
      await owner.query('DROP FUNCTION fmv.test_emergency_audit_fail()');
    }
    assert.equal(
      (await service.read(principal, patient.id)).profile.revision,
      3,
    );
  } finally {
    await Promise.all([
      service.onModuleDestroy(),
      other.onModuleDestroy(),
      people.onModuleDestroy(),
    ]);
    await runtime.end();
  }
}
