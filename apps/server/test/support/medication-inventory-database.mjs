import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export async function verifyMedicationInventory(
  f,
  ledger,
  other,
  medicationId,
) {
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
  ) => ledger.inventory(actor, p, id, mode, input);
  const body = (
    revision,
    fields = {
      quantity: '2 strips + unknown remainder',
      expiry: '2027-11 (month only)',
      refill: 'Not scheduled',
    },
  ) => ({
    requestId: randomUUID(),
    expectedRevision: revision,
    medicationRevision: 1,
    confirmed: true,
    meaning: 'owner-reported-inventory',
    fields,
  });
  let empty = await call('read');
  assert.equal(empty.current, null);
  assert.equal(empty.canWrite, true);
  await assert.rejects(call('read', {}, reader), status(404));
  await assert.rejects(call('save', body(0), reader), status(404));
  await assert.rejects(call('read', {}, principal, randomUUID()), status(404));
  await assert.rejects(
    call('read', {}, principal, patient.id, randomUUID()),
    status(404),
  );
  const scoped = await insertGrant(
    runtime,
    {
      patientId: patient.id,
      caregiverAccountId: readerAccountId,
      ownerAccountId,
    },
    {
      actions: ['view', 'edit', 'manage'],
      scopeKind: 'document',
      documentId: (await ledger.history(principal, patient.id, medicationId))
        .current.entry.source.documentId,
    },
  );
  await assert.rejects(call('read', {}, reader), status(404));
  const grant = await insertGrant(
    runtime,
    {
      patientId: patient.id,
      caregiverAccountId: readerAccountId,
      ownerAccountId,
    },
    { actions: ['view'], scopeKind: 'patient' },
  );
  const first = body(0);
  assert.deepEqual(await call('save', first), { saved: true, revision: 1 });
  assert.deepEqual(await call('save', first), { saved: true, revision: 1 });
  assert.deepEqual(
    (await call('read', {}, reader)).current.fields,
    first.fields,
  );
  assert.equal((await call('read', {}, reader)).canWrite, false);
  await assert.rejects(call('save', body(1), reader), status(404));
  await assert.rejects(
    call('save', {
      ...first,
      fields: { ...first.fields, quantity: 'changed' },
    }),
    status(409),
  );
  await assert.rejects(
    call('save', { ...body(1), medicationRevision: 2 }),
    status(409),
  );
  await assert.rejects(
    call('save', { ...body(1), confirmed: false }),
    status(400),
  );
  await call('save', body(1, { ...first.fields, quantity: '0' }));
  let page = await call('read');
  assert.equal(page.current.fields.quantity, '0');
  assert.equal(page.history[1].fields.quantity, first.fields.quantity);
  await call('save', body(2, { quantity: null, expiry: null, refill: null }));
  assert.deepEqual((await call('read')).current.fields, {
    quantity: null,
    expiry: null,
    refill: null,
  });
  const race = await Promise.allSettled([
    call('save', body(3)),
    other.inventory(principal, patient.id, medicationId, 'save', body(3)),
  ]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    race.find((r) => r.status === 'rejected').reason.getStatus(),
    409,
  );
  for (let n = 4; n < 24; n++) await call('save', body(n));
  page = await call('read');
  assert.equal(page.current.revision, 24);
  assert.equal(page.history.length, 20);
  assert.equal(page.nextBeforeRevision, 4);
  const old = await call('read', { beforeRevision: '4' });
  assert.equal(old.current.revision, 24);
  assert.equal(old.history.length, 4);
  assert.equal(old.nextBeforeRevision, null);
  for (const query of [
    { beforeRevision: '0' },
    { beforeRevision: '25' },
    { beforeRevision: '01' },
    { extra: 'ignored' },
  ])
    await assert.rejects(call('read', query), status(400));
  await assert.rejects(call('save', first), status(409));
  await assert.rejects(
    runtime.query('UPDATE fmv.medication_inventory SET revision=999'),
    (e) => e.code === '42501',
  );
  await assert.rejects(
    runtime.query('DELETE FROM fmv.medication_inventory'),
    (e) => e.code === '42501',
  );
  const raw = async (actor, revision, medRevision, fields) =>
    runtime.query(
      "INSERT INTO fmv.medication_inventory(id,patient_id,medication_id,medication_entry_id,medication_revision,revision,fields,request_id,payload_hash,actor_account_id,recorded_at) SELECT $1,$2,$3,id,$4,$5,$6::jsonb,$7,$8,$9,'2000-01-01' FROM fmv.medication_reconciliations WHERE patient_id=$2 AND medication_id=$3 ORDER BY revision DESC LIMIT 1",
      [
        randomUUID(),
        patient.id,
        medicationId,
        medRevision,
        revision,
        JSON.stringify(fields),
        randomUUID(),
        'a'.repeat(64),
        actor,
      ],
    );
  for (const args of [
    [readerAccountId, 25, 1, first.fields],
    [ownerAccountId, 26, 1, first.fields],
    [ownerAccountId, 25, 2, first.fields],
    [ownerAccountId, 25, 1, { ...first.fields, quantity: '\n' }],
    [ownerAccountId, 25, 1, { ...first.fields, extra: 'no' }],
  ])
    await assert.rejects(raw(...args), (e) => e.code === '23514');
  await owner.query(
    "CREATE FUNCTION fmv.test_inventory_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$",
  );
  await owner.query(
    'CREATE TRIGGER test_inventory_audit_failure BEFORE INSERT ON fmv.medication_inventory_events FOR EACH ROW EXECUTE FUNCTION fmv.test_inventory_audit_failure()',
  );
  try {
    await assert.rejects(call('save', body(24)), status(503));
  } finally {
    await owner.query(
      'DROP TRIGGER test_inventory_audit_failure ON fmv.medication_inventory_events',
    );
    await owner.query('DROP FUNCTION fmv.test_inventory_audit_failure()');
  }
  assert.equal((await call('read')).current.revision, 24);
  const expiring = await insertGrant(
    runtime,
    {
      patientId: patient.id,
      caregiverAccountId: readerAccountId,
      ownerAccountId,
    },
    {
      actions: ['view'],
      scopeKind: 'patient',
      expiresAt: new Date(Date.now() + 250),
    },
  );
  await runtime.query(
    'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=ANY($1::uuid[])',
    [[grant.id, scoped.id]],
  );
  // Expiry during an access-audit delay must suppress the entire result.
  await owner.query(
    'CREATE FUNCTION fmv.test_inventory_audit_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.4); RETURN NEW; END $$',
  );
  await owner.query(
    'CREATE TRIGGER test_inventory_audit_delay BEFORE INSERT ON fmv.medication_inventory_events FOR EACH STATEMENT EXECUTE FUNCTION fmv.test_inventory_audit_delay()',
  );
  try {
    await assert.rejects(call('read', {}, reader), status(404));
  } finally {
    await owner.query(
      'DROP TRIGGER test_inventory_audit_delay ON fmv.medication_inventory_events',
    );
    await owner.query('DROP FUNCTION fmv.test_inventory_audit_delay()');
    await runtime.query(
      'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1',
      [expiring.id],
    );
  }
  const policy = (
    await runtime.query(
      "SELECT relrowsecurity,relforcerowsecurity,has_table_privilege(current_user,oid,'UPDATE') u,has_table_privilege(current_user,oid,'DELETE') d FROM pg_class WHERE oid='fmv.medication_inventory'::regclass",
    )
  ).rows[0];
  assert.equal(policy.relrowsecurity, true);
  assert.equal(policy.relforcerowsecurity, true);
  assert.equal(policy.u, false);
  assert.equal(policy.d, false);
}
