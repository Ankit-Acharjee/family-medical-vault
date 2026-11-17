import { isMedicationScheduleDefinition } from '@fmv/contracts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export async function verifyMedicationSchedule(f, ledger, other, medicationId) {
  const {
    runtime,
    owner,
    principal,
    reader,
    patient,
    ownerAccountId,
    readerAccountId,
    insertGrant,
  } = f;
  const status = (n) => (e) => e.getStatus?.() === n;
  const call = (
    mode,
    input = {},
    actor = principal,
    p = patient.id,
    id = medicationId,
  ) => ledger.schedule(actor, p, id, mode, input);
  const clock = {
    timing: {
      kind: 'clock-times',
      timeZone: 'Asia/Kolkata',
      weekdays: [1, 3, 5],
      times: ['08:30', '20:00'],
    },
    startDate: '2028-02-29',
    endDate: null,
    instructions: null,
  };
  const literal = {
    timing: {
      kind: 'literal',
      text: 'SYNTHETIC as needed? uncertainty retained',
    },
    startDate: null,
    endDate: null,
    instructions: 'No inferred dose',
  };
  const make = (revision, definition = clock, state = 'recorded') => ({
    requestId: randomUUID(),
    expectedRevision: revision,
    medicationRevision: 1,
    confirmed: true,
    meaning: 'owner-recorded-informational-schedule',
    recordedState: state,
    definition,
  });
  assert.equal((await call('read')).current, null);
  const recipient = (
    await runtime.query(
      'SELECT id FROM fmv.persons WHERE owner_account_id=$1',
      [readerAccountId],
    )
  ).rows[0].id;
  await assert.rejects(call('read', {}, principal, recipient), status(404));
  await assert.rejects(call('read', {}, reader, recipient), status(404));
  await assert.rejects(call('save', make(0), reader, recipient), status(404));

  await assert.rejects(call('read', {}, reader), status(404));
  await assert.rejects(call('save', make(0), reader), status(404));
  await assert.rejects(call('read', {}, principal, randomUUID()), status(404));
  await assert.rejects(
    call('read', {}, principal, patient.id, randomUUID()),
    status(404),
  );
  const fixture = {
    patientId: patient.id,
    caregiverAccountId: readerAccountId,
    ownerAccountId,
  };
  const scope = await insertGrant(runtime, fixture, {
    actions: ['view', 'edit', 'manage'],
    scopeKind: 'document',
    documentId: (await ledger.history(principal, patient.id, medicationId))
      .current.entry.source.documentId,
  });
  await assert.rejects(call('read', {}, reader), status(404));
  const grant = await insertGrant(runtime, fixture, {
    actions: ['view'],
    scopeKind: 'patient',
  });
  await assert.rejects(call('save', make(0, clock, 'retired')), status(409));
  const first = make(0);
  assert.deepEqual(await call('save', first), { saved: true, revision: 1 });
  assert.deepEqual(
    await call('save', {
      ...first,
      definition: {
        instructions: null,
        endDate: null,
        startDate: '2028-02-29',
        timing: {
          times: ['08:30', '20:00'],
          weekdays: [1, 3, 5],
          timeZone: 'Asia/Kolkata',
          kind: 'clock-times',
        },
      },
    }),
    { saved: true, revision: 1 },
  );
  assert.deepEqual((await call('read', {}, reader)).current.definition, clock);
  assert.equal((await call('read', {}, reader)).canWrite, false);
  await assert.rejects(call('save', make(1), reader), status(404));
  await assert.rejects(
    call('save', { ...first, definition: literal }),
    status(409),
  );
  await assert.rejects(
    call('save', { ...make(1), medicationRevision: 2 }),
    status(409),
  );
  await assert.rejects(
    call('save', { ...make(1), confirmed: false }),
    status(400),
  );
  await call('save', make(1, literal));
  let data = await call('read');
  assert.deepEqual(data.current.definition, literal);
  assert.deepEqual(data.history[1].definition, clock);
  await call('save', make(2, literal, 'retired'));
  data = await call('read');
  assert.equal(data.current.recordedState, 'retired');
  assert.equal(data.current.action, 'retirement');
  await call('save', make(3));
  assert.equal((await call('read')).current.recordedState, 'recorded');
  const race = await Promise.allSettled([
    call('save', make(4)),
    other.schedule(principal, patient.id, medicationId, 'save', make(4)),
  ]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    race.find((r) => r.status === 'rejected').reason.getStatus(),
    409,
  );
  for (let n = 5; n < 24; n++) await call('save', make(n));
  data = await call('read');
  assert.equal(data.current.revision, 24);
  assert.equal(data.history.length, 20);
  assert.equal(data.nextBeforeRevision, 4);
  const old = await call('read', { beforeRevision: '4' });
  assert.equal(old.current.revision, 24);
  assert.equal(old.history.length, 4);
  assert.equal(old.nextBeforeRevision, null);
  for (const query of [
    { beforeRevision: '0' },
    { beforeRevision: '25' },
    { beforeRevision: '01' },
    { ignored: true },
  ])
    await assert.rejects(call('read', query), status(400));
  await assert.rejects(call('save', first), status(409));
  const definitions = [
    clock,
    literal,
    { ...clock, startDate: '2027-02-29' },
    { ...clock, timing: { ...clock.timing, times: ['08:00', '08:00'] } },
    { ...clock, timing: { ...clock.timing, weekdays: [5, 1] } },
    { ...clock, timing: { ...clock.timing, timeZone: 'Not/AZone' } },
    { ...clock, startDate: '2028-03-01', endDate: '2028-02-29' },
    { ...literal, instructions: '\n' },
    { ...literal, timing: { kind: 'literal', text: null } },
    { ...clock, extra: true },
  ];
  for (const [i, d] of definitions.entries()) {
    const valid = (
      await runtime.query(
        'SELECT fmv.medication_schedule_definition_valid($1::jsonb) valid',
        [JSON.stringify(d)],
      )
    ).rows[0].valid;
    assert.equal(valid, i < 2);
  }
  for (const timeZone of [
    'UTC',
    'Etc/UTC',
    'US/Eastern',
    'Asia/Kolkata',
    'Asia/Calcutta',
    'asia/kolkata',
    'America/New_York',
    'Pacific/Chatham',
    'GMT0',
    'CET',
    'Zulu',
  ]) {
    const d = { ...clock, timing: { ...clock.timing, timeZone } };
    assert.equal(
      (
        await runtime.query(
          'SELECT fmv.medication_schedule_definition_valid($1::jsonb) valid',
          [JSON.stringify(d)],
        )
      ).rows[0].valid,
      isMedicationScheduleDefinition(d),
    );
  }
  for (const table of ['medication_schedules', 'medication_schedule_events']) {
    const flags = (
      await runtime.query(
        "SELECT relrowsecurity,relforcerowsecurity,has_table_privilege(current_user,oid,'SELECT') r,has_table_privilege(current_user,oid,'INSERT') i,has_table_privilege(current_user,oid,'UPDATE') u,has_table_privilege(current_user,oid,'DELETE') d FROM pg_class WHERE oid=$1::regclass",
        ['fmv.' + table],
      )
    ).rows[0];
    assert.deepEqual(flags, {
      relrowsecurity: true,
      relforcerowsecurity: true,
      r: true,
      i: true,
      u: false,
      d: false,
    });
  }
  await assert.rejects(
    runtime.query('UPDATE fmv.medication_schedules SET revision=999'),
    (e) => e.code === '42501',
  );
  await assert.rejects(
    runtime.query('DELETE FROM fmv.medication_schedules'),
    (e) => e.code === '42501',
  );
  const raw = async (
    actor,
    revision,
    medRevision,
    definition,
    action = 'correction',
  ) =>
    runtime.query(
      "INSERT INTO fmv.medication_schedules(id,patient_id,medication_id,medication_entry_id,medication_revision,revision,action,recorded_state,definition,request_id,payload_hash,actor_account_id) SELECT $1,$2,$3,id,$4,$5,$6,'recorded',$7::jsonb,$8,$9,$10 FROM fmv.medication_reconciliations WHERE patient_id=$2 AND medication_id=$3 ORDER BY revision DESC LIMIT 1",
      [
        randomUUID(),
        patient.id,
        medicationId,
        medRevision,
        revision,
        action,
        JSON.stringify(definition),
        randomUUID(),
        'a'.repeat(64),
        actor,
      ],
    );
  for (const args of [
    [readerAccountId, 25, 1, clock],
    [ownerAccountId, 26, 1, clock],
    [ownerAccountId, 25, 2, clock],
    [ownerAccountId, 25, 1, definitions[2]],
    [ownerAccountId, 25, 1, clock, 'recording'],
  ])
    await assert.rejects(raw(...args), (e) => e.code === '23514');
  await owner.query(
    "CREATE FUNCTION fmv.test_schedule_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$",
  );
  await owner.query(
    'CREATE TRIGGER test_schedule_audit_failure BEFORE INSERT ON fmv.medication_schedule_events FOR EACH ROW EXECUTE FUNCTION fmv.test_schedule_audit_failure()',
  );
  try {
    await assert.rejects(call('save', make(24)), status(503));
  } finally {
    await owner.query(
      'DROP TRIGGER test_schedule_audit_failure ON fmv.medication_schedule_events',
    );
    await owner.query('DROP FUNCTION fmv.test_schedule_audit_failure()');
  }
  assert.equal((await call('read')).current.revision, 24);
  await runtime.query(
    'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=ANY($1::uuid[])',
    [[scope.id, grant.id]],
  );
  await assert.rejects(call('read', {}, reader), status(404));
  return { definition: clock };
}
