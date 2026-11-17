import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { isManualReading } from '@fmv/contracts';
import { PrismaPersonStore } from '../../dist/identity/person.store.js';
import { ManualReadingsService } from '../../dist/measurements/manual-readings.service.js';
export async function verifyManualReadings(runtimeUrl, owner, insertGrant) {
  const runtime = new pg.Client({ connectionString: runtimeUrl.href }),
    people = new PrismaPersonStore(runtimeUrl.href),
    service = new ManualReadingsService(runtimeUrl.href),
    other = new ManualReadingsService(runtimeUrl.href);
  await runtime.connect();
  try {
    const principal = {
        issuer: 'https://manual.example.test',
        subject: randomUUID(),
      },
      reader = { ...principal, subject: randomUUID() };
    const patient = await people.create(principal, 'Synthetic manual owner'),
      recipient = await people.create(reader, 'Synthetic manual reader');
    const account = async (p) =>
      (
        await runtime.query(
          'SELECT owner_account_id id FROM fmv.persons WHERE id=$1::uuid',
          [p],
        )
      ).rows[0].id;
    const ownerAccountId = await account(patient.id),
      readerAccountId = await account(recipient.id);
    const fixture = {
      patientId: patient.id,
      caregiverAccountId: readerAccountId,
      ownerAccountId,
    };
    const status = (n) => (e) => e.getStatus?.() === n;
    const reading = {
      kind: 'weight',
      unit: 'kg',
      observedAt: '2026-11-17T10:30:00+05:30',
      values: { value: '72.000000000000000001' },
    };
    const make = (revision, value = reading) => ({
      requestId: randomUUID(),
      expectedRevision: revision,
      confirmed: true,
      reading: value,
    });
    const id = randomUUID(),
      first = make(0);
    assert.deepEqual((await service.list(principal, patient.id)).entries, []);
    assert.deepEqual(await service.save(principal, patient.id, id, first), {
      saved: true,
      revision: 1,
    });
    assert.deepEqual(
      await service.save(
        principal,
        patient.id.toUpperCase(),
        id.toUpperCase(),
        {
          ...first,
          reading: {
            values: { value: reading.values.value },
            observedAt: reading.observedAt,
            unit: 'kg',
            kind: 'weight',
          },
        },
      ),
      { saved: true, revision: 1 },
    );
    let history = await service.history(principal, patient.id, id);
    assert.equal(history.current.provenance, 'manual');
    assert.deepEqual(history.current.reading, reading);
    assert.equal(history.history.length, 1);
    assert.equal(history.canWrite, true);
    await assert.rejects(service.history(reader, patient.id, id), status(404));
    const edit = await insertGrant(runtime, fixture, {
      actions: ['edit', 'manage', 'upload', 'export'],
    });
    await assert.rejects(service.list(reader, patient.id), status(404));
    await assert.rejects(
      service.save(reader, patient.id, id, make(1)),
      status(404),
    );
    const categoryId = randomUUID();
    await owner.query(
      "INSERT INTO fmv.document_categories(id,slug,name) VALUES($1::uuid,$2,'Synthetic manual category')",
      [categoryId, randomUUID()],
    );
    await insertGrant(runtime, fixture, {
      actions: ['view'],
      scopeKind: 'category',
      categoryId,
    });
    await assert.rejects(service.list(reader, patient.id), status(404));
    const view = await insertGrant(runtime, fixture, { actions: ['view'] });
    assert.equal((await service.list(reader, patient.id)).canWrite, false);
    assert.equal(
      (await service.history(reader, patient.id, id)).current.reading.values
        .value,
      reading.values.value,
    );
    await assert.rejects(
      service.save(reader, patient.id, id, make(1)),
      status(404),
    );
    await assert.rejects(
      service.withdraw(reader, patient.id, id, {
        requestId: randomUUID(),
        expectedRevision: 1,
        confirmed: true,
      }),
      status(404),
    );
    await assert.rejects(
      service.history(principal, recipient.id, id),
      status(404),
    );
    await assert.rejects(
      service.save(reader, recipient.id, id, make(0)),
      status(404),
    );
    const correction = make(1, {
      ...reading,
      unit: 'lb',
      values: { value: '159.00' },
    });
    assert.deepEqual(
      await service.save(principal, patient.id, id, correction),
      { saved: true, revision: 2 },
    );
    assert.deepEqual(
      await service.save(principal, patient.id, id, correction),
      { saved: true, revision: 2 },
    );
    history = await service.history(principal, patient.id, id);
    assert.deepEqual(
      history.history.map((e) => e.reading.unit),
      ['lb', 'kg'],
    );
    await assert.rejects(
      service.save(principal, patient.id, id, first),
      status(409),
    );
    await assert.rejects(
      service.save(
        principal,
        patient.id,
        id,
        make(2, {
          kind: 'pulse',
          unit: 'beats/min',
          observedAt: reading.observedAt,
          values: { value: '60' },
        }),
      ),
      status(409),
    );
    const race = await Promise.allSettled([
      service.save(principal, patient.id, id, make(2)),
      other.save(principal, patient.id, id, make(2)),
    ]);
    assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      race.filter((r) => r.status === 'rejected' && status(409)(r.reason))
        .length,
      1,
    );
    const withdrawal = {
      requestId: randomUUID(),
      expectedRevision: 3,
      confirmed: true,
    };
    assert.deepEqual(
      await service.withdraw(principal, patient.id, id, withdrawal),
      { saved: true, revision: 4 },
    );
    assert.deepEqual(
      await service.withdraw(principal, patient.id, id, withdrawal),
      { saved: true, revision: 4 },
    );
    history = await service.history(principal, patient.id, id);
    assert.equal(history.current.action, 'withdrawal');
    assert.equal(history.canWrite, false);
    assert.equal(history.history.length, 4);
    await assert.rejects(
      service.save(principal, patient.id, id, make(4)),
      status(409),
    );
    await assert.rejects(
      service.withdraw(principal, patient.id, id, {
        ...withdrawal,
        requestId: randomUUID(),
        expectedRevision: 4,
      }),
      status(409),
    );
    const histId = randomUUID();
    for (let r = 0; r < 25; r++)
      await service.save(
        principal,
        patient.id,
        histId,
        make(r, { ...reading, values: { value: String(r) } }),
      );
    const latest = await service.history(principal, patient.id, histId);
    assert.equal(latest.history.length, 20);
    assert.equal(latest.nextBeforeRevision, 5);
    const older = await service.history(principal, patient.id, histId, {
      beforeRevision: '5',
    });
    assert.equal(older.current.revision, 25);
    assert.deepEqual(
      older.history.map((e) => e.revision),
      [5, 4, 3, 2, 1],
    );
    assert.equal(older.nextBeforeRevision, null);
    for (let i = 0; i < 23; i++)
      await service.save(principal, patient.id, randomUUID(), make(0));
    const page = await service.list(principal, patient.id);
    assert.equal(page.entries.length, 20);
    assert.ok(page.nextCursor);
    const next = await service.list(principal, patient.id, {
      cursor: JSON.stringify(page.nextCursor),
    });
    assert.equal(next.entries.length, 5);
    assert.equal(next.nextCursor, null);
    assert.equal(
      new Set([...page.entries, ...next.entries].map((e) => e.readingId)).size,
      25,
    );
    for (const query of [
      { cursor: 'null' },
      { cursor: 'bad' },
      { cursor: [] },
      { secret: 'sentinel' },
    ])
      await assert.rejects(
        service.list(principal, patient.id, query),
        status(400),
      );
    for (const beforeRevision of ['0', '-1', '1\n', '2147483648', '1.5'])
      await assert.rejects(
        service.history(principal, patient.id, id, { beforeRevision }),
        status(400),
      );
    const variants = [
      reading,
      { ...reading, values: { value: 12 } },
      { ...reading, values: { value: '1\n' } },
      { ...reading, values: { value: '00' } },
      { ...reading, unit: 'KG' },
      { ...reading, observedAt: '2026-02-30T00:00:00Z' },
      { ...reading, observedAt: '2026-11-17T00:00:00-00:00' },
      { ...reading, observedAt: '2026-11-17T00:00:00+14:01' },
      {
        kind: 'blood-pressure',
        unit: 'mmHg',
        observedAt: reading.observedAt,
        values: { systolic: '120', diastolic: '80' },
      },
      {
        kind: 'glucose',
        unit: 'mmol/L',
        observedAt: '2026-11-17T00:00:00Z',
        values: { value: '0' },
      },
      {
        kind: 'pulse',
        unit: 'beats/min',
        observedAt: '2024-02-29T00:00:00+14:00',
        values: { value: '60.50' },
      },
    ];
    for (const value of variants) {
      const sql = (
        await runtime.query(
          'SELECT fmv.manual_reading_valid($1::jsonb) valid',
          [JSON.stringify(value)],
        )
      ).rows[0].valid;
      assert.equal(sql, isManualReading(value), JSON.stringify(value));
    }
    for (const table of ['manual_measurements', 'manual_measurement_events']) {
      const f = (
        await runtime.query(
          'SELECT relrowsecurity s,relforcerowsecurity f FROM pg_class WHERE oid=$1::regclass',
          ['fmv.' + table],
        )
      ).rows[0];
      assert.deepEqual(f, { s: true, f: true });
      for (const sql of [
        `DELETE FROM fmv.${table}`,
        `UPDATE fmv.${table} SET id=id`,
      ])
        await assert.rejects(runtime.query(sql), (e) => e.code === '42501');
    }
    const insert = async (patch = {}) =>
      runtime.query(
        'INSERT INTO fmv.manual_measurements(id,reading_id,patient_id,revision,action,request_id,payload_hash,actor_account_id,reading,recorded_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7,$8::uuid,$9::jsonb,$10::timestamptz) RETURNING recorded_at',
        [
          randomUUID(),
          patch.readingId ?? randomUUID(),
          patient.id,
          patch.revision ?? 1,
          patch.action ?? 'record',
          randomUUID(),
          'a'.repeat(64),
          patch.actor ?? ownerAccountId,
          JSON.stringify(patch.reading ?? reading),
          '2000-01-01T00:00:00Z',
        ],
      );
    await assert.rejects(
      insert({ actor: readerAccountId }),
      (e) => e.code === '23514',
    );
    await assert.rejects(
      insert({ readingId: id, revision: 5, action: 'correction' }),
      (e) => e.code === '23514',
    );
    await assert.rejects(insert({ revision: 3 }), (e) => e.code === '23514');
    await assert.rejects(
      insert({ reading: { ...reading, extra: true } }),
      (e) => e.code === '23514',
    );
    assert.ok(
      (await insert()).rows[0].recorded_at.getTime() > Date.parse('2026-01-01'),
    );
    const failId = randomUUID();
    try {
      await owner.query(
        "CREATE FUNCTION fmv.synthetic_manual_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit failure' USING ERRCODE='23514'; END $$",
      );
      await owner.query(
        'CREATE TRIGGER synthetic_manual_audit_failure BEFORE INSERT ON fmv.manual_measurement_events FOR EACH ROW EXECUTE FUNCTION fmv.synthetic_manual_audit_failure()',
      );
      await assert.rejects(
        service.save(principal, patient.id, failId, make(0)),
        status(503),
      );
      await assert.rejects(
        service.history(principal, patient.id, id),
        status(503),
      );
      assert.equal(
        (
          await runtime.query(
            'SELECT count(*)::int n FROM fmv.manual_measurements WHERE reading_id=$1::uuid',
            [failId],
          )
        ).rows[0].n,
        0,
      );
    } finally {
      await owner.query(
        'DROP TRIGGER IF EXISTS synthetic_manual_audit_failure ON fmv.manual_measurement_events',
      );
      await owner.query(
        'DROP FUNCTION IF EXISTS fmv.synthetic_manual_audit_failure()',
      );
    }
    const events = (
      await runtime.query(
        "SELECT bool_and(expires_at=recorded_at+interval '90 days') valid FROM fmv.manual_measurement_events WHERE patient_id=$1::uuid AND kind='manual.viewed'",
        [patient.id],
      )
    ).rows[0];
    assert.equal(events.valid, true);
    // Revocation shares the canonical patient mutex, including upper-case routes.
    await owner.query('BEGIN');
    let blocked;
    try {
      await owner.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('access-patient:'||$1::text,0))",
        [patient.id],
      );
      blocked = service.history(reader, patient.id.toUpperCase(), id);
      const settled = blocked.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      let waiting = false;
      for (let n = 0; n < 100 && !waiting; n++) {
        await owner.query('SELECT pg_stat_clear_snapshot()');
        waiting = (
          await owner.query(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%') waiting",
          )
        ).rows[0].waiting;
        if (!waiting) await setTimeout(20);
      }
      assert.equal(waiting, true);
      await owner.query(
        'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1::uuid',
        [view.id],
      );
      await owner.query('COMMIT');
      const outcome = await settled;
      assert.ok('error' in outcome && status(404)(outcome.error));
    } catch (e) {
      await owner.query('ROLLBACK');
      if (blocked) await blocked.catch(() => {});
      throw e;
    }
    await assert.rejects(service.list(reader, patient.id), status(404));
    // Expiry during audited disclosure must roll back all access events.
    const beforeEvents = (
      await runtime.query(
        'SELECT count(*)::int n FROM fmv.manual_measurement_events WHERE patient_id=$1::uuid',
        [patient.id],
      )
    ).rows[0].n;
    try {
      await owner.query('CREATE SEQUENCE fmv.synthetic_manual_audit_probe');
      await owner.query(
        'GRANT USAGE ON SEQUENCE fmv.synthetic_manual_audit_probe TO fmv_app',
      );
      await owner.query(
        "CREATE FUNCTION fmv.synthetic_manual_audit_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_account_id::text=TG_ARGV[0] THEN PERFORM nextval('fmv.synthetic_manual_audit_probe'); PERFORM pg_sleep(0.3); END IF; RETURN NEW; END $$",
      );
      await owner.query(
        `CREATE TRIGGER synthetic_manual_audit_delay BEFORE INSERT ON fmv.manual_measurement_events FOR EACH ROW EXECUTE FUNCTION fmv.synthetic_manual_audit_delay('${readerAccountId}')`,
      );
      await insertGrant(runtime, fixture, {
        actions: ['view'],
        expiresAt: new Date(Date.now() + 700),
      });
      await assert.rejects(
        service.history(reader, patient.id, id),
        status(404),
      );
      assert.equal(
        (
          await owner.query(
            'SELECT is_called FROM fmv.synthetic_manual_audit_probe',
          )
        ).rows[0].is_called,
        true,
        'Disclosure audit began while grant was live',
      );
      assert.equal(
        (
          await runtime.query(
            'SELECT count(*)::int n FROM fmv.manual_measurement_events WHERE patient_id=$1::uuid',
            [patient.id],
          )
        ).rows[0].n,
        beforeEvents,
      );
    } finally {
      await owner.query(
        'DROP TRIGGER IF EXISTS synthetic_manual_audit_delay ON fmv.manual_measurement_events',
      );
      await owner.query(
        'DROP FUNCTION IF EXISTS fmv.synthetic_manual_audit_delay()',
      );
      await owner.query(
        'DROP SEQUENCE IF EXISTS fmv.synthetic_manual_audit_probe',
      );
    }
    await owner.query(
      'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1::uuid',
      [edit.id],
    );
  } finally {
    await runtime.end();
    await people.onModuleDestroy();
    await service.onModuleDestroy();
    await other.onModuleDestroy();
  }
}
