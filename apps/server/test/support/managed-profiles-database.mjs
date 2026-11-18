import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PrismaPersonStore } from '../../dist/identity/person.store.js';
import { ManagedProfilesService } from '../../dist/identity/managed-profiles.service.js';
import { PrismaAccessStore } from '../../dist/access/access.store.js';
import { PermissionService } from '../../dist/access/permission.service.js';
import { EmergencyProfileService } from '../../dist/emergency/emergency-profile.service.js';
import { TemporaryLinksService } from '../../dist/sharing/temporary-links.service.js';
export async function verifyManagedProfiles(runtimeUrl, owner) {
  const runtime = new pg.Client({ connectionString: runtimeUrl.href }),
    people = new PrismaPersonStore(runtimeUrl.href),
    service = new ManagedProfilesService(runtimeUrl.href),
    other = new ManagedProfilesService(runtimeUrl.href),
    access = new PrismaAccessStore(runtimeUrl.href),
    emergency = new EmergencyProfileService(runtimeUrl.href),
    links = new TemporaryLinksService(runtimeUrl.href);
  await runtime.connect();
  try {
    const principal = {
        issuer: 'https://managed.example.test',
        subject: randomUUID(),
      },
      outsider = { ...principal, subject: randomUUID() },
      status = (n) => (e) => e.getStatus?.() === n,
      body = {
        requestId: randomUUID(),
        displayName: 'SYNTHETIC managed profile',
        confirmed: true,
      };
    await assert.rejects(service.create(outsider, body), status(404));
    const personal = await people.create(principal, 'SYNTHETIC personal owner');
    const races = await Promise.all([
      service.create(principal, body),
      other.create(principal, body),
    ]);
    assert.equal(races[0].id, races[1].id);
    assert.equal(races.filter((r) => r.created).length, 1);
    const created = races[0];
    assert.notEqual(created.id, personal.id);
    assert.equal(created.relationship, 'caregiver');
    assert.equal((await people.find(principal)).id, personal.id);
    assert.equal(
      (await people.create(principal, 'Ignored repeated onboarding')).id,
      personal.id,
    );
    await assert.rejects(
      service.create(principal, { ...body, displayName: 'Changed replay' }),
      status(409),
    );
    const second = await service.create(principal, {
      ...body,
      requestId: randomUUID(),
    });
    assert.notEqual(
      second.id,
      created.id,
      'Equal names coexist; never automatically merge',
    );
    const listed = (await access.list(principal)).find(
      (p) => p.id === created.id,
    );
    assert.equal(listed.relationship, 'caregiver');
    assert.deepEqual(
      new Set(listed.capabilities.map((c) => c.action)),
      new Set(['view', 'upload', 'edit', 'export', 'manage']),
    );
    const permissions = new PermissionService(access),
      snapshot = await permissions.snapshot(principal, created.id);
    assert.equal(snapshot.patient.ownerAccountId, null);
    for (const action of ['view', 'upload', 'edit', 'export', 'manage'])
      assert.ok(permissions.allows(snapshot, action, { kind: 'patient' }));
    await assert.rejects(
      permissions.snapshot(outsider, created.id),
      status(404),
    );
    assert.equal((await emergency.read(principal, created.id)).canWrite, false);
    await assert.rejects(
      emergency.save(principal, created.id, {
        requestId: randomUUID(),
        expectedRevision: 0,
        fields: {
          contactName: null,
          contactRelationship: null,
          contactPhone: null,
          note: null,
        },
        confirmed: true,
      }),
      status(404),
    );
    await assert.rejects(
      links.prepare(principal, created.id, { documentIds: [randomUUID()] }),
      status(404),
    );
    const rows = await runtime.query(
      'SELECT p.owner_account_id,p.storage_namespace,m.initial_grant_id,m.creator_account_id FROM fmv.persons p JOIN fmv.managed_profile_creations m ON m.patient_id=p.id WHERE p.id=$1',
      [created.id],
    );
    assert.equal(rows.rows[0].owner_account_id, null);
    assert.ok(rows.rows[0].storage_namespace);
    await assert.rejects(
      runtime.query('UPDATE fmv.persons SET owner_account_id=$1 WHERE id=$2', [
        rows.rows[0].creator_account_id,
        created.id,
      ]),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      runtime.query(
        'DELETE FROM fmv.managed_profile_creations WHERE patient_id=$1',
        [created.id],
      ),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      runtime.query(
        'INSERT INTO fmv.persons(id,owner_account_id,display_name) VALUES($1,NULL,$2)',
        [randomUUID(), 'SYNTHETIC orphan probe'],
      ),
      (e) => e.code === '23514',
    );
    const before = (
      await runtime.query('SELECT count(*)::int n FROM fmv.persons')
    ).rows[0].n;
    await owner.query(
      "CREATE FUNCTION fmv.test_managed_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Synthetic audit unavailable'; END$$",
    );
    await owner.query(
      'CREATE TRIGGER test_managed_audit_fail BEFORE INSERT ON fmv.access_events FOR EACH ROW EXECUTE FUNCTION fmv.test_managed_audit_fail()',
    );
    const failed = { ...body, requestId: randomUUID() };
    try {
      await assert.rejects(service.create(principal, failed), status(503));
    } finally {
      await owner.query(
        'DROP TRIGGER test_managed_audit_fail ON fmv.access_events',
      );
      await owner.query('DROP FUNCTION fmv.test_managed_audit_fail()');
    }
    assert.equal(
      (await runtime.query('SELECT count(*)::int n FROM fmv.persons')).rows[0]
        .n,
      before,
    );
    assert.ok((await service.create(principal, failed)).created);
    await runtime.query(
      'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1',
      [rows.rows[0].initial_grant_id],
    );
    await assert.rejects(service.create(principal, body), status(404));
    assert.ok(!(await access.list(principal)).some((p) => p.id === created.id));
  } finally {
    await Promise.all([
      people.onModuleDestroy(),
      service.onModuleDestroy(),
      other.onModuleDestroy(),
      access.onModuleDestroy(),
      emergency.onModuleDestroy(),
      links.onModuleDestroy(),
    ]);
    await runtime.end();
  }
}
