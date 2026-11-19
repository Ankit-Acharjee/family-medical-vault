import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PrismaPersonStore } from '../../dist/identity/person.store.js';
import { ManagedProfilesService } from '../../dist/identity/managed-profiles.service.js';
import { ProfileActivationService } from '../../dist/identity/profile-activation.service.js';
import { PrismaAccessStore } from '../../dist/access/access.store.js';
export async function verifyProfileActivation(runtimeUrl, owner) {
  const runtime = new pg.Client({ connectionString: runtimeUrl.href }),
    people = new PrismaPersonStore(runtimeUrl.href),
    managed = new ManagedProfilesService(runtimeUrl.href),
    service = new ProfileActivationService(runtimeUrl.href),
    other = new ProfileActivationService(runtimeUrl.href),
    access = new PrismaAccessStore(runtimeUrl.href);
  await runtime.connect();
  try {
    const principal = {
        issuer: 'https://activation.example.test',
        subject: randomUUID(),
      },
      delegate = { ...principal, subject: randomUUID() },
      fresh = () => ({ ...principal, subject: randomUUID() }),
      status = (n) => (e) => e.getStatus?.() === n;
    await people.create(principal, 'SYNTHETIC creator');
    await people.create(delegate, 'SYNTHETIC delegate');
    const make = () =>
        managed.create(principal, {
          requestId: randomUUID(),
          displayName: 'SYNTHETIC managed activation',
          confirmed: true,
        }),
      issue = (p) =>
        service.issue(principal, p, {
          requestId: randomUUID(),
          expiresInHours: 24,
          confirmed: true,
        }),
      approve = (claim) => ({
        requestId: randomUUID(),
        claimantRef: claim.claimantRef,
        confirmed: true,
      });
    const patient = await make(),
      body = { requestId: randomUUID(), expiresInHours: 24, confirmed: true },
      first = await service.issue(principal, patient.id, body);
    assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(
      (await service.issue(principal, patient.id, body)).token,
      null,
    );
    await assert.rejects(
      service.issue(principal, patient.id, { ...body, expiresInHours: 48 }),
      status(409),
    );
    await assert.rejects(issue(patient.id), status(409));
    const creatorId = (
        await runtime.query(
          'SELECT creator_account_id id FROM fmv.managed_profile_creations WHERE patient_id=$1',
          [patient.id],
        )
      ).rows[0].id,
      delegateId = (
        await runtime.query(
          'SELECT owner_account_id id FROM fmv.persons WHERE id=$1',
          [(await people.find(delegate)).id],
        )
      ).rows[0].id;
    await runtime.query(
      "INSERT INTO fmv.access_grants(id,patient_id,grantee_account_id,issuer_account_id,actions,scope_kind) VALUES($1,$2,$3,$4,ARRAY['view','manage'],'patient')",
      [randomUUID(), patient.id, delegateId, creatorId],
    );
    await assert.rejects(
      service.issue(delegate, patient.id, { ...body, requestId: randomUUID() }),
      status(404),
    );
    await assert.rejects(service.list(delegate, patient.id), status(404));
    await assert.rejects(service.claim(delegate, first.token), status(409));
    await assert.rejects(service.inspect(delegate, first.token), status(409));
    assert.equal(
      (await service.inspect(fresh(), first.token)).patientId,
      patient.id,
    );
    const claimant = fresh(),
      claim = await service.claim(claimant, first.token);
    assert.equal(claim.state, 'claimed');
    assert.equal(
      (await service.claim(claimant, first.token)).claimantRef,
      claim.claimantRef,
    );
    assert.equal(await people.find(claimant), null);
    await assert.rejects(service.claim(fresh(), first.token), status(404));
    const stored = (
      await runtime.query(
        'SELECT owner_account_id,storage_namespace FROM fmv.persons WHERE id=$1',
        [patient.id],
      )
    ).rows[0];
    assert.equal(stored.owner_account_id, null);
    const approval = approve(claim);
    await assert.rejects(
      runtime.query('SELECT fmv.approve_profile_activation($1,$2,$3,$4)', [
        first.activation.id,
        delegateId,
        claim.claimantRef,
        randomUUID(),
      ]),
      (e) => e.code === '23514',
    );
    await assert.rejects(
      service.approve(principal, patient.id, first.activation.id, {
        ...approval,
        claimantRef: randomUUID(),
      }),
      status(409),
    );
    await assert.rejects(
      service.approve(delegate, patient.id, first.activation.id, approval),
      status(404),
    );
    await assert.rejects(
      runtime.query(
        "UPDATE fmv.profile_activations SET state='accepted',transition_account_id=$1 WHERE id=$2",
        [creatorId, first.activation.id],
      ),
      (e) => e.code === '23514',
    );
    await assert.rejects(
      runtime.query(
        'UPDATE fmv.profile_activations SET accepted_at=clock_timestamp() WHERE id=$1',
        [first.activation.id],
      ),
      (e) => e.code === '42501',
    );
    assert.deepEqual(
      await service.approve(
        principal,
        patient.id,
        first.activation.id,
        approval,
      ),
      { activated: true, patientId: patient.id },
    );
    assert.equal((await people.find(claimant)).id, patient.id);
    assert.equal(
      (await service.status(claimant, first.token)).state,
      'accepted',
    );
    await assert.rejects(service.inspect(claimant, first.token), status(404));
    await assert.rejects(service.status(delegate, first.token), status(404));
    assert.equal(
      (await people.create(claimant, 'Unrelated onboarding name')).id,
      patient.id,
    );
    assert.equal(
      (
        await runtime.query(
          'SELECT storage_namespace FROM fmv.persons WHERE id=$1',
          [patient.id],
        )
      ).rows[0].storage_namespace,
      stored.storage_namespace,
    );
    assert.equal(
      (await access.list(principal)).find((p) => p.id === patient.id)
        .relationship,
      'caregiver',
    );
    assert.equal(
      (await access.list(claimant)).find((p) => p.id === patient.id)
        .relationship,
      'self',
    );
    assert.ok(
      (
        await service.approve(
          principal,
          patient.id,
          first.activation.id,
          approval,
        )
      ).activated,
    );
    await assert.rejects(
      service.approve(principal, patient.id, first.activation.id, {
        ...approval,
        requestId: randomUUID(),
      }),
      status(409),
    );
    await assert.rejects(service.claim(claimant, first.token), status(404));
    await assert.rejects(
      service.revoke(principal, patient.id, first.activation.id),
      status(409),
    );
    const events = (
      await runtime.query(
        'SELECT kind FROM fmv.profile_activation_events WHERE activation_id=$1',
        [first.activation.id],
      )
    ).rows
      .map((e) => e.kind)
      .sort();
    assert.deepEqual(events, [
      'activation.accepted',
      'activation.claimed',
      'activation.issued',
    ]);
    await assert.rejects(
      runtime.query(
        "INSERT INTO fmv.profile_activation_events(activation_id,patient_id,actor_account_id,kind) VALUES($1,$2,$3,'activation.revoked')",
        [first.activation.id, patient.id, creatorId],
      ),
      (e) => e.code === '23514',
    );
    const revokedPatient = await make(),
      revoked = await issue(revokedPatient.id);
    await service.revoke(principal, revokedPatient.id, revoked.activation.id);
    await service.revoke(principal, revokedPatient.id, revoked.activation.id);
    await assert.rejects(service.claim(fresh(), revoked.token), status(404));
    const expiredPatient = await make(),
      expired = await issue(expiredPatient.id);
    await owner.query(
      'ALTER TABLE fmv.profile_activations DISABLE TRIGGER USER',
    );
    try {
      await owner.query(
        "UPDATE fmv.profile_activations SET created_at=created_at-interval '10 days',expires_at=expires_at-interval '10 days' WHERE id=$1",
        [expired.activation.id],
      );
    } finally {
      await owner.query(
        'ALTER TABLE fmv.profile_activations ENABLE TRIGGER USER',
      );
    }
    await assert.rejects(service.claim(fresh(), expired.token), status(404));
    assert.equal(
      (await service.list(principal, expiredPatient.id)).activations[0].state,
      'expired',
    );
    const lostPatient = await make(),
      lost = await issue(lostPatient.id);
    await runtime.query(
      'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=(SELECT initial_grant_id FROM fmv.managed_profile_creations WHERE patient_id=$1)',
      [lostPatient.id],
    );
    await assert.rejects(service.claim(fresh(), lost.token), status(404));
    await assert.rejects(
      service.revoke(principal, lostPatient.id, lost.activation.id),
      status(404),
    );
    const failPatient = await make(),
      failLink = await issue(failPatient.id),
      failClaim = await service.claim(fresh(), failLink.token),
      failApproval = approve(failClaim);
    await owner.query(
      "CREATE FUNCTION fmv.test_activation_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.kind='activation.accepted' THEN RAISE EXCEPTION 'Synthetic audit unavailable'; END IF;RETURN NEW;END$$",
    );
    await owner.query(
      'CREATE TRIGGER test_activation_audit_fail BEFORE INSERT ON fmv.profile_activation_events FOR EACH ROW EXECUTE FUNCTION fmv.test_activation_audit_fail()',
    );
    try {
      await assert.rejects(
        service.approve(
          principal,
          failPatient.id,
          failLink.activation.id,
          failApproval,
        ),
        status(503),
      );
    } finally {
      await owner.query(
        'DROP TRIGGER test_activation_audit_fail ON fmv.profile_activation_events',
      );
      await owner.query('DROP FUNCTION fmv.test_activation_audit_fail()');
    }
    assert.equal(
      (
        await runtime.query(
          'SELECT owner_account_id FROM fmv.persons WHERE id=$1',
          [failPatient.id],
        )
      ).rows[0].owner_account_id,
      null,
    );
    assert.ok(
      (
        await service.approve(
          principal,
          failPatient.id,
          failLink.activation.id,
          failApproval,
        )
      ).activated,
    );
    const timedPatient = await make(),
      timedLink = await issue(timedPatient.id),
      timedClaim = await service.claim(fresh(), timedLink.token);
    await owner.query(
      'ALTER TABLE fmv.profile_activations DISABLE TRIGGER USER',
    );
    try {
      await owner.query(
        "UPDATE fmv.profile_activations SET created_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",
        [timedLink.activation.id],
      );
    } finally {
      await owner.query(
        'ALTER TABLE fmv.profile_activations ENABLE TRIGGER USER',
      );
    }
    await owner.query(
      "CREATE FUNCTION fmv.test_activation_audit_delay() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.kind='activation.accepted' THEN PERFORM pg_sleep(2.4); END IF;RETURN NEW;END$$",
    );
    await owner.query(
      'CREATE TRIGGER test_activation_audit_delay BEFORE INSERT ON fmv.profile_activation_events FOR EACH ROW EXECUTE FUNCTION fmv.test_activation_audit_delay()',
    );
    try {
      await assert.rejects(
        service.approve(
          principal,
          timedPatient.id,
          timedLink.activation.id,
          approve(timedClaim),
        ),
        status(409),
      );
    } finally {
      await owner.query(
        'DROP TRIGGER test_activation_audit_delay ON fmv.profile_activation_events',
      );
      await owner.query('DROP FUNCTION fmv.test_activation_audit_delay()');
    }
    assert.equal(
      (
        await runtime.query(
          'SELECT owner_account_id FROM fmv.persons WHERE id=$1',
          [timedPatient.id],
        )
      ).rows[0].owner_account_id,
      null,
    );
    for (let i = 0; i < 2; i++) {
      const p = await make(),
        link = await issue(p.id),
        who = fresh(),
        c = await service.claim(who, link.token),
        a = approve(c);
      const race = await Promise.allSettled([
          people.create(who, 'SYNTHETIC competing onboarding'),
          other.approve(principal, p.id, link.activation.id, a),
        ]),
        actual = await people.find(who);
      assert.equal(race[0].status, 'fulfilled');
      if (race[1].status === 'fulfilled') {
        assert.equal(actual.id, p.id);
      } else {
        assert.equal(race[1].reason.getStatus(), 409);
        assert.notEqual(actual.id, p.id);
        assert.equal(
          (
            await runtime.query(
              'SELECT owner_account_id FROM fmv.persons WHERE id=$1',
              [p.id],
            )
          ).rows[0].owner_account_id,
          null,
        );
      }
    }
    const flags = (
      await owner.query(
        "SELECT prosecdef,proconfig FROM pg_proc WHERE oid='fmv.approve_profile_activation(uuid,uuid,uuid,uuid)'::regprocedure",
      )
    ).rows[0];
    assert.equal(flags.prosecdef, true);
    assert.ok(flags.proconfig.includes('search_path=pg_catalog'));
    assert.equal(
      (
        await runtime.query(
          "SELECT has_column_privilege('fmv_app','fmv.persons','owner_account_id','UPDATE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await Promise.all([
      people.onModuleDestroy(),
      managed.onModuleDestroy(),
      service.onModuleDestroy(),
      other.onModuleDestroy(),
      access.onModuleDestroy(),
    ]);
    await runtime.end();
  }
}
