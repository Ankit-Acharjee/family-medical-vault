import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function verifyLinkRevocationOutbox({
  links,
  other,
  owner,
  runtime,
  principal,
  reader,
  patient,
  prepare,
  body,
}) {
  const status = (n) => (error) => error.getStatus?.() === n,
    denied = (error) => error.code === '42501',
    pending = { revoked: true, protection: 'pending' },
    quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`,
    createdIds = new Set(),
    capture = (id) =>
      runtime.query('SELECT fmv.capture_temporary_link_revocation($1::uuid)', [
        id,
      ]),
    create = async () => {
      const result = await links.create(
        principal,
        patient.id,
        body(await prepare()),
      );
      assert.equal(result.created, true);
      createdIds.add(result.link.id);
      return result;
    },
    events = async (id) =>
      (
        await runtime.query(
          'SELECT id,patient_id,resource_id,kind,occurred_at,recorded_at FROM fmv.restore_ledger_events WHERE resource_id=$1::uuid ORDER BY id',
          [id],
        )
      ).rows,
    source = async (id) =>
      (
        await runtime.query(
          'SELECT revoked_at,revoker_account_id FROM fmv.temporary_links WHERE id=$1::uuid',
          [id],
        )
      ).rows[0],
    evidence = async (id) => {
      const rows = await events(id),
        link = await source(id);
      assert.equal(rows.length, 1);
      assert.match(rows[0].id, /^[a-f0-9-]{36}$/);
      assert.equal(rows[0].patient_id, patient.id);
      assert.equal(rows[0].resource_id, id);
      assert.equal(rows[0].kind, 'link.revoked');
      assert.ok(link.revoked_at instanceof Date);
      assert.equal(
        rows[0].occurred_at.toISOString(),
        link.revoked_at.toISOString(),
      );
      assert.ok(rows[0].recorded_at instanceof Date);
      assert.ok(Number.isFinite(rows[0].recorded_at.getTime()));
      return rows;
    };

  try {
    const concurrent = await create();
    await capture(concurrent.link.id);
    const missing = randomUUID();
    await capture(missing);
    assert.deepEqual(await events(missing), []);
    await assert.rejects(
      links.revoke(reader, patient.id, concurrent.link.id),
      status(404),
    );
    assert.deepEqual(await events(concurrent.link.id), []);
    assert.equal((await source(concurrent.link.id)).revoked_at, null);
    const replies = await Promise.all([
      links.revoke(principal, patient.id, concurrent.link.id),
      other.revoke(principal, patient.id, concurrent.link.id),
    ]);
    assert.deepEqual(replies, [pending, pending]);
    // Local denial commits independently; capture is a retryable shadow step.
    await assert.rejects(links.inspect(concurrent.token), status(404));
    const stable = await evidence(concurrent.link.id);
    await Promise.all([
      capture(concurrent.link.id),
      capture(concurrent.link.id),
    ]);
    assert.deepEqual(
      await links.revoke(principal, patient.id, concurrent.link.id),
      pending,
    );
    assert.deepEqual(
      await other.revoke(principal, patient.id, concurrent.link.id),
      pending,
    );
    await capture(concurrent.link.id);
    await capture(concurrent.link.id);
    assert.deepEqual(await evidence(concurrent.link.id), stable);
    await assert.rejects(links.inspect(concurrent.token), status(404));

    for (const [sql, values] of [
      [
        "INSERT INTO fmv.restore_ledger_events(patient_id,resource_id,kind,occurred_at) VALUES($1::uuid,$2::uuid,'link.revoked',clock_timestamp())",
        [patient.id, randomUUID()],
      ],
      [
        'UPDATE fmv.restore_ledger_events SET resource_id=$2::uuid WHERE resource_id=$1::uuid',
        [concurrent.link.id, randomUUID()],
      ],
      [
        'UPDATE fmv.restore_ledger_events SET recorded_at=clock_timestamp() WHERE resource_id=$1::uuid',
        [concurrent.link.id],
      ],
      [
        'DELETE FROM fmv.restore_ledger_events WHERE resource_id=$1::uuid',
        [concurrent.link.id],
      ],
      ['TRUNCATE fmv.restore_ledger_events', []],
    ]) {
      await assert.rejects(runtime.query(sql, values), denied);
    }
    assert.deepEqual(await events(concurrent.link.id), stable);

    const retry = await create(),
      failureName = `synthetic_restore_failure_${randomUUID().replaceAll('-', '')}`;
    let failureFunction = false,
      failureTrigger = false;
    try {
      await owner.query(
        `CREATE FUNCTION fmv.${quote(failureName)}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic restore capture failure'; END $$`,
      );
      failureFunction = true;
      await owner.query(
        `CREATE TRIGGER ${quote(failureName)} BEFORE INSERT ON fmv.restore_ledger_events FOR EACH ROW EXECUTE FUNCTION fmv.${quote(failureName)}()`,
      );
      failureTrigger = true;
      assert.deepEqual(
        await links.revoke(principal, patient.id, retry.link.id),
        pending,
      );
      const committed = await source(retry.link.id);
      assert.ok(committed.revoked_at instanceof Date);
      await assert.rejects(links.inspect(retry.token), status(404));
      await assert.rejects(
        capture(retry.link.id),
        (error) => error.code === 'P0001',
      );
      assert.deepEqual(await source(retry.link.id), committed);
      assert.deepEqual(await events(retry.link.id), []);
      assert.deepEqual(
        await links.revoke(principal, patient.id, retry.link.id),
        pending,
      );
      assert.deepEqual(await source(retry.link.id), committed);
      await assert.rejects(links.inspect(retry.token), status(404));
    } finally {
      if (failureTrigger)
        await owner.query(
          `DROP TRIGGER ${quote(failureName)} ON fmv.restore_ledger_events`,
        );
      if (failureFunction)
        await owner.query(`DROP FUNCTION fmv.${quote(failureName)}()`);
    }
    assert.deepEqual(
      await links.revoke(principal, patient.id, retry.link.id),
      pending,
    );
    const retriedEvidence = await evidence(retry.link.id);
    await capture(retry.link.id);
    assert.deepEqual(await evidence(retry.link.id), retriedEvidence);
    await assert.rejects(links.inspect(retry.token), status(404));

    // The generated owner proves SECURITY DEFINER capture works with FORCE RLS
    // without relying on the native fixture owner's superuser/bypass privileges.
    const ownership = (
        await owner.query(
          `SELECT pg_catalog.pg_get_userbyid(c.relowner) AS table_owner,
           pg_catalog.pg_get_userbyid(p.proowner) AS function_owner,
           c.relrowsecurity,c.relforcerowsecurity
           FROM pg_catalog.pg_class c CROSS JOIN pg_catalog.pg_proc p
           WHERE c.oid='fmv.restore_ledger_events'::regclass
           AND p.oid='fmv.capture_temporary_link_revocation(uuid)'::regprocedure`,
        )
      ).rows[0],
      probeRole = `fmv_restore_probe_${randomUUID().replaceAll('-', '')}`,
      portable = await create();
    assert.equal(ownership.relrowsecurity, true);
    assert.equal(ownership.relforcerowsecurity, true);
    let roleCreated = false,
      tableChanged = false,
      functionChanged = false;
    try {
      await owner.query(
        `CREATE ROLE ${quote(probeRole)} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`,
      );
      roleCreated = true;
      await owner.query(`GRANT USAGE ON SCHEMA fmv TO ${quote(probeRole)}`);
      await owner.query(
        `GRANT SELECT(id,patient_id,revoked_at) ON fmv.temporary_links TO ${quote(probeRole)}`,
      );
      await owner.query(
        `ALTER TABLE fmv.restore_ledger_events OWNER TO ${quote(probeRole)}`,
      );
      tableChanged = true;
      await owner.query(
        `ALTER FUNCTION fmv.capture_temporary_link_revocation(uuid) OWNER TO ${quote(probeRole)}`,
      );
      functionChanged = true;
      assert.deepEqual(
        (
          await owner.query(
            'SELECT rolsuper,rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=$1',
            [probeRole],
          )
        ).rows,
        [{ rolsuper: false, rolbypassrls: false }],
      );
      assert.deepEqual(
        await links.revoke(principal, patient.id, portable.link.id),
        pending,
      );
      const portableEvidence = await evidence(portable.link.id);
      assert.deepEqual(
        await other.revoke(principal, patient.id, portable.link.id),
        pending,
      );
      await capture(portable.link.id);
      assert.deepEqual(await evidence(portable.link.id), portableEvidence);
      await assert.rejects(links.inspect(portable.token), status(404));
    } finally {
      if (functionChanged)
        await owner.query(
          `ALTER FUNCTION fmv.capture_temporary_link_revocation(uuid) OWNER TO ${quote(ownership.function_owner)}`,
        );
      if (tableChanged)
        await owner.query(
          `ALTER TABLE fmv.restore_ledger_events OWNER TO ${quote(ownership.table_owner)}`,
        );
      if (roleCreated) {
        await owner.query(
          `REVOKE SELECT(id,patient_id,revoked_at) ON fmv.temporary_links FROM ${quote(probeRole)}`,
        );
        await owner.query(
          `REVOKE USAGE ON SCHEMA fmv FROM ${quote(probeRole)}`,
        );
        await owner.query(`DROP ROLE ${quote(probeRole)}`);
      }
    }

    // Runtime-local temporary types must not mask the definer's catalog casts.
    const shadow = await create();
    let temporaryTable = false,
      temporaryType = false;
    try {
      await runtime.query(
        'CREATE TEMP TABLE synthetic_restore_type_anchor(id integer)',
      );
      temporaryTable = true;
      await runtime.query('CREATE DOMAIN pg_temp.regclass AS text');
      temporaryType = true;
      await runtime.query(
        "UPDATE fmv.temporary_links SET revoked_at=date_trunc('milliseconds',clock_timestamp()),revoker_account_id=creator_account_id WHERE id=$1::uuid",
        [shadow.link.id],
      );
      await capture(shadow.link.id);
      await evidence(shadow.link.id);
      await assert.rejects(links.inspect(shadow.token), status(404));
    } finally {
      if (temporaryType) await runtime.query('DROP DOMAIN pg_temp.regclass');
      if (temporaryTable)
        await runtime.query('DROP TABLE synthetic_restore_type_anchor');
    }

    const retained = await events(concurrent.link.id);
    const retainedSource = await source(concurrent.link.id);
    await assert.rejects(
      owner.query('DELETE FROM fmv.temporary_links WHERE id=$1::uuid', [
        concurrent.link.id,
      ]),
      (error) => error.code === '23514',
    );
    assert.deepEqual(await source(concurrent.link.id), retainedSource);
    assert.deepEqual(await events(concurrent.link.id), retained);

    // Simulate a crash after local denial commits but before shadow capture.
    // Retry captures the durable intent and still reports protection pending.
    const legacy = await create();
    await runtime.query(
      "UPDATE fmv.temporary_links SET revoked_at=date_trunc('milliseconds',clock_timestamp()),revoker_account_id=creator_account_id WHERE id=$1::uuid",
      [legacy.link.id],
    );
    const legacySource = await source(legacy.link.id);
    assert.ok(legacySource.revoked_at instanceof Date);
    assert.deepEqual(await events(legacy.link.id), []);
    await assert.rejects(
      owner.query('DELETE FROM fmv.temporary_links WHERE id=$1::uuid', [
        legacy.link.id,
      ]),
      (error) => error.code === '23514',
    );
    assert.deepEqual(await source(legacy.link.id), legacySource);
    assert.deepEqual(await events(legacy.link.id), []);
    await assert.rejects(links.inspect(legacy.token), status(404));
    assert.deepEqual(
      await links.revoke(principal, patient.id, legacy.link.id),
      pending,
    );
    const capturedLegacy = await evidence(legacy.link.id);
    assert.deepEqual(
      await other.revoke(principal, patient.id, legacy.link.id),
      pending,
    );
    assert.deepEqual(await source(legacy.link.id), legacySource);
    await capture(legacy.link.id);
    assert.deepEqual(await evidence(legacy.link.id), capturedLegacy);
  } finally {
    // Remove only active helper rows left by a failed assertion. Revoked
    // synthetic intents remain protected until this native cluster is discarded.
    for (const id of createdIds)
      await owner.query(
        'DELETE FROM fmv.temporary_links WHERE id=$1::uuid AND revoked_at IS NULL',
        [id],
      );
  }
}
