import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalSummarySnapshot } from '@fmv/contracts';
export async function verifySummaryExport(f, summary, manual) {
  const {
    owner,
    runtime,
    principal,
    reader,
    patient,
    insertGrant,
    ownerAccountId,
    readerAccountId,
    id,
  } = f;
  const status = (n) => (e) => e.getStatus?.() === n;
  const signal = () => new globalThis.AbortController().signal;
  const make = async (actor = principal) => {
    const s = await summary.read(actor, patient.id);
    return {
      requestId: randomUUID(),
      confirmed: true,
      format: 'zip',
      request: { scope: 'patient', period: null },
      snapshotSha256: createHash('sha256')
        .update(canonicalSummarySnapshot(s))
        .digest('hex'),
    };
  };
  const count = async () =>
    Number(
      (
        await runtime.query(
          'SELECT count(*) n FROM fmv.summary_export_events WHERE patient_id=$1::uuid',
          [patient.id],
        )
      ).rows[0].n,
    );
  const fixture = {
      patientId: patient.id,
      caregiverAccountId: readerAccountId,
      ownerAccountId,
    },
    grants = [];
  const grant = async (options) => {
    const r = await insertGrant(runtime, fixture, options);
    grants.push(r.id ?? r);
    return r.id ?? r;
  };
  const revoke = async (ids) =>
    owner.query(
      'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=ANY($1::uuid[])',
      [ids],
    );
  try {
    const body = await make(),
      before = await count();
    await assert.rejects(
      summary.export(reader, patient.id, body, signal()),
      status(404),
    );
    const view = await grant({ actions: ['view'], scopeKind: 'patient' });
    await assert.rejects(
      summary.export(reader, patient.id, body, signal()),
      status(404),
    );
    await grant({ actions: ['export'], scopeKind: 'document', documentId: id });
    await assert.rejects(
      summary.export(reader, patient.id, body, signal()),
      status(404),
    );
    const full = await grant({ actions: ['export'], scopeKind: 'patient' });
    const generated = await summary.export(reader, patient.id, body, signal());
    assert.equal(generated.bytes.readUInt32LE(0), 0x04034b50);
    assert.equal(await count(), before + 1);
    const row = (
      await runtime.query(
        "SELECT artifact_sha256,snapshot_sha256,bytes,actor_account_id,retention_until=recorded_at+interval '90 days' valid_retention FROM fmv.summary_export_events WHERE patient_id=$1::uuid ORDER BY recorded_at DESC LIMIT 1",
        [patient.id],
      )
    ).rows[0];
    assert.equal(
      row.artifact_sha256,
      createHash('sha256').update(generated.bytes).digest('hex'),
    );
    assert.equal(row.snapshot_sha256, body.snapshotSha256);
    assert.equal(row.bytes, generated.bytes.length);
    assert.equal(row.actor_account_id, readerAccountId);
    assert.equal(row.valid_retention, true);
    await revoke([view]);
    await assert.rejects(
      summary.export(reader, patient.id, body, signal()),
      status(404),
    );
    await grant({ actions: ['view'], scopeKind: 'document', documentId: id });
    await assert.rejects(
      summary.export(reader, patient.id, body, signal()),
      status(404),
    );
    await revoke([full]);
    const owned = await summary.export(
      principal,
      patient.id,
      await make(),
      signal(),
    );
    assert.ok(owned.bytes.length > 0);
    await assert.rejects(
      summary.export(
        principal,
        patient.id,
        { ...body, snapshotSha256: '0'.repeat(64) },
        signal(),
      ),
      status(409),
    );
    const abort = new globalThis.AbortController();
    abort.abort();
    const n = await count();
    await assert.rejects(
      summary.export(principal, patient.id, body, abort.signal),
    );
    assert.equal(await count(), n);
    // Root metadata mutation deliberately bypasses the app lock to test the final fresh boundary.
    const oldName = (
      await runtime.query(
        'SELECT display_name FROM fmv.persons WHERE id=$1::uuid',
        [patient.id],
      )
    ).rows[0].display_name;
    const snapshot = summary.snapshot.bind(summary);
    let changed = false;
    summary.snapshot = async (...args) => {
      const r = await snapshot(...args);
      if (args[4] && !changed) {
        changed = true;
        await owner.query(
          'UPDATE fmv.persons SET display_name=$1 WHERE id=$2::uuid',
          ['SYNTHETIC changed identity label', patient.id],
        );
      }
      return r;
    };
    try {
      await assert.rejects(
        summary.export(principal, patient.id, body, signal()),
        status(409),
      );
      assert.equal(await count(), n);
    } finally {
      summary.snapshot = snapshot;
      await owner.query(
        'UPDATE fmv.persons SET display_name=$1 WHERE id=$2::uuid',
        [oldName, patient.id],
      );
    }
    const current = await make();
    try {
      await owner.query(
        "CREATE FUNCTION fmv.synthetic_export_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic export audit failure'; END $$",
      );
      await owner.query(
        'CREATE TRIGGER synthetic_export_audit_failure BEFORE INSERT ON fmv.summary_export_events FOR EACH ROW EXECUTE FUNCTION fmv.synthetic_export_audit_failure()',
      );
      await assert.rejects(
        summary.export(principal, patient.id, current, signal()),
        status(503),
      );
      assert.equal(await count(), n);
    } finally {
      await owner.query(
        'DROP TRIGGER IF EXISTS synthetic_export_audit_failure ON fmv.summary_export_events',
      );
      await owner.query(
        'DROP FUNCTION IF EXISTS fmv.synthetic_export_audit_failure()',
      );
    }
    const v = await grant({
      actions: ['view', 'export'],
      scopeKind: 'patient',
      expiresAt: new Date(Date.now() + 2000),
    });
    try {
      await owner.query('CREATE SEQUENCE fmv.synthetic_export_audit_probe');
      await owner.query(
        'GRANT USAGE ON SEQUENCE fmv.synthetic_export_audit_probe TO fmv_app',
      );
      await owner.query(
        "CREATE FUNCTION fmv.synthetic_export_audit_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('fmv.synthetic_export_audit_probe'); PERFORM pg_sleep(2.1); RETURN NEW; END $$",
      );
      await owner.query(
        'CREATE TRIGGER synthetic_export_audit_delay BEFORE INSERT ON fmv.summary_export_events FOR EACH ROW EXECUTE FUNCTION fmv.synthetic_export_audit_delay()',
      );
      await assert.rejects(
        summary.export(reader, patient.id, current, signal()),
        status(404),
      );
      assert.equal(await count(), n);
      assert.equal(
        (
          await owner.query(
            'SELECT is_called FROM fmv.synthetic_export_audit_probe',
          )
        ).rows[0].is_called,
        true,
      );
    } finally {
      await owner.query(
        'DROP TRIGGER IF EXISTS synthetic_export_audit_delay ON fmv.summary_export_events',
      );
      await owner.query(
        'DROP FUNCTION IF EXISTS fmv.synthetic_export_audit_delay()',
      );
      await owner.query(
        'DROP SEQUENCE IF EXISTS fmv.synthetic_export_audit_probe',
      );
      await revoke([v]);
    }
    const archive = summary.archive,
      additionalReading = randomUUID();
    summary.archive = async (...args) => {
      await manual.save(principal, patient.id, additionalReading, {
        requestId: randomUUID(),
        expectedRevision: 0,
        confirmed: true,
        reading: {
          kind: 'weight',
          unit: 'kg',
          observedAt: '2024-02-29T12:00:00+05:30',
          values: { value: '50' },
        },
      });
      return archive(...args);
    };
    try {
      await assert.rejects(
        summary.export(principal, patient.id, await make(), signal()),
        status(409),
      );
      assert.equal(await count(), n);
    } finally {
      summary.archive = archive;
      await manual.withdraw(principal, patient.id, additionalReading, {
        requestId: randomUUID(),
        expectedRevision: 1,
        confirmed: true,
      });
    }
    summary.archive = async () => {
      throw Error('SYNTHETIC private render failure');
    };
    try {
      await assert.rejects(
        summary.export(principal, patient.id, await make(), signal()),
        status(503),
      );
      assert.equal(await count(), n);
    } finally {
      summary.archive = archive;
    }
    for (const sql of [
      'UPDATE fmv.summary_export_events SET bytes=1',
      'DELETE FROM fmv.summary_export_events',
      'TRUNCATE fmv.summary_export_events',
    ])
      await assert.rejects(runtime.query(sql), (e) => e.code === '42501');
    await assert.rejects(
      runtime.query(
        'INSERT INTO fmv.summary_export_events(recorded_at) VALUES(now())',
      ),
      (e) => e.code === '42501',
    );
    const security = (
      await runtime.query(
        "SELECT relrowsecurity,relforcerowsecurity,has_table_privilege('fmv_app',oid,'SELECT') r,has_table_privilege('fmv_app',oid,'UPDATE') u,has_table_privilege('fmv_app',oid,'DELETE') d,has_column_privilege('fmv_app',oid,'id','INSERT') i,has_column_privilege('fmv_app',oid,'recorded_at','INSERT') clock FROM pg_class WHERE oid='fmv.summary_export_events'::regclass",
      )
    ).rows[0];
    assert.deepEqual(security, {
      relrowsecurity: true,
      relforcerowsecurity: true,
      r: true,
      u: false,
      d: false,
      i: true,
      clock: false,
    });
  } finally {
    if (grants.length) await revoke(grants);
  }
}
