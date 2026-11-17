import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MedicationReconciliationService } from '../../dist/medications/medication-reconciliation.service.js';
export async function verifyMedicationReconciliation(f) {
  const {
    runtimeUrl,
    runtime,
    owner,
    principal,
    reader,
    patient,
    id,
    extraction,
    service,
    insertGrant,
    ownerAccountId,
    readerAccountId,
  } = f;
  const ledger = new MedicationReconciliationService(runtimeUrl.href),
    other = new MedicationReconciliationService(runtimeUrl.href);
  const status = (n) => (e) => e.getStatus?.() === n;
  const reconcileId = randomUUID();
  const review = async () => {
    let r = await service.medication.read(principal, patient.id, id);
    await service.medication.write(
      principal,
      patient.id,
      id,
      {
        requestId: randomUUID(),
        expectedRevision: r.context.revision,
        sourceRevision: r.context.sourceRevision,
        sourceSha256: r.context.sourceSha256,
        lifecycleVersion: r.context.lifecycleVersion,
        confirmed: true,
        meaning: 'source-fields-only',
        candidateIds: r.candidates.map((c) => c.id),
      },
      'confirmation',
    );
    r = await service.medication.read(principal, patient.id, id);
    return r;
  };
  const make = (r, revision = 0) => ({
    requestId: randomUUID(),
    expectedRevision: revision,
    confirmed: true,
    meaning: 'owner-recorded-medication-context',
    source: {
      documentId: id,
      candidateId: r.snapshot.statements[0].id,
      sourceRevision: r.context.sourceRevision,
      sourceSha256: r.context.sourceSha256,
      lifecycleVersion: r.context.lifecycleVersion,
      reviewRevision: r.context.revision,
    },
    recordedStatus: 'current',
    fields: Object.fromEntries(
      Object.entries(r.snapshot.statements[0].fields).map(([k, v]) => [
        k,
        v?.value ?? null,
      ]),
    ),
  });
  try {
    await extraction(
      'Medication: SYNTHETIC uncertain historical wording\nDose: as written\nFrequency: if needed',
    );
    let r = await review();
    const first = make(r);
    const options = await ledger.sourceOptions(principal, patient.id);
    assert.equal(options.options.length, 1);
    assert.equal(options.limited, false);
    assert.deepEqual(options.options[0].binding, first.source);
    await assert.rejects(
      ledger.sourceOptions(principal, patient.id, { cursor: 'ignored' }),
      status(400),
    );
    await assert.rejects(ledger.sourceOptions(reader, patient.id), status(404));
    await assert.rejects(ledger.list(reader, patient.id), status(404));
    assert.deepEqual(
      await ledger.save(principal, patient.id, reconcileId, first),
      { saved: true, revision: 1 },
    );
    assert.deepEqual(
      await ledger.save(principal, patient.id, reconcileId, first),
      { saved: true, revision: 1 },
    );
    let list = await ledger.list(principal, patient.id);
    assert.equal(list.entries.length, 1);
    assert.equal(list.entries[0].sourceState, 'current-source');
    assert.equal(list.entries[0].entry.recordedStatus, 'current');
    assert.equal(
      list.entries[0].entry.fields.medication,
      'SYNTHETIC uncertain historical wording',
    );
    const fixture = {
      patientId: patient.id,
      caregiverAccountId: readerAccountId,
      ownerAccountId,
    };
    const scoped = await insertGrant(runtime, fixture, {
      actions: ['view', 'edit', 'manage'],
      scopeKind: 'document',
      documentId: id,
    });
    await assert.rejects(ledger.list(reader, patient.id), status(404));
    await assert.rejects(
      ledger.history(reader, patient.id, reconcileId),
      status(404),
    );
    await assert.rejects(
      ledger.save(reader, patient.id, reconcileId, {}),
      status(404),
    );
    const grant = await insertGrant(runtime, fixture, {
      actions: ['view'],
      scopeKind: 'patient',
    });
    await assert.rejects(ledger.sourceOptions(reader, patient.id), status(404));
    assert.equal((await ledger.list(reader, patient.id)).canWrite, false);
    assert.equal(
      (await ledger.history(reader, patient.id, reconcileId)).current.entry
        .revision,
      1,
    );
    await assert.rejects(
      ledger.save(reader, patient.id, reconcileId, make(r, 1)),
      status(404),
    );
    const correction = {
      ...make(r, 1),
      recordedStatus: 'historical',
      fields: { ...first.fields, dose: 'owner correction literal' },
    };
    const outcomes = await Promise.allSettled([
      ledger.save(principal, patient.id, reconcileId, correction),
      other.save(principal, patient.id, reconcileId, {
        ...correction,
        requestId: randomUUID(),
      }),
    ]);
    assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
    assert.equal(
      outcomes.filter(
        (o) => o.status === 'rejected' && o.reason.getStatus() === 409,
      ).length,
      1,
    );
    let history = await ledger.history(principal, patient.id, reconcileId);
    assert.equal(history.current.entry.revision, 2);
    assert.equal(history.current.entry.recordedStatus, 'historical');
    assert.equal(history.history[1].entry.recordedStatus, 'current');
    assert.equal(history.history[1].entry.fields.dose, 'as written');
    await assert.rejects(
      ledger.save(principal, patient.id, reconcileId, {
        ...make(r, 2),
        source: { ...first.source, candidateId: 'page-1-medication-999' },
      }),
      status(409),
    );
    await assert.rejects(
      ledger.save(principal, patient.id, reconcileId, {
        ...make(r, 2),
        confirmed: false,
      }),
      status(400),
    );
    await assert.rejects(
      ledger.list(principal, patient.id, { cursor: 'bad' }),
      status(400),
    );
    await assert.rejects(
      ledger.history(principal, patient.id, reconcileId, {
        beforeRevision: '999',
      }),
      status(400),
    );
    // A new exact review invalidates an old reconciliation even with identical bytes.
    r = await review();
    history = await ledger.history(principal, patient.id, reconcileId);
    assert.equal(history.current.sourceState, 'source-review-required');
    assert.equal(history.current.entry.recordedStatus, 'historical');
    await ledger.save(principal, patient.id, reconcileId, {
      ...make(r, 2),
      recordedStatus: 'historical',
    });
    assert.equal(
      (await ledger.history(principal, patient.id, reconcileId)).current
        .sourceState,
      'current-source',
    );
    const { sourceRevision, ...withdraw } = {
      requestId: randomUUID(),
      expectedRevision: r.context.revision,
      sourceRevision: r.context.sourceRevision,
      sourceSha256: r.context.sourceSha256,
      lifecycleVersion: r.context.lifecycleVersion,
      confirmed: true,
      meaning: 'source-fields-only',
      candidateIds: [r.snapshot.statements[0].id],
    };
    void sourceRevision;
    await service.medication.write(
      principal,
      patient.id,
      id,
      withdraw,
      'withdrawal',
    );
    assert.equal(
      (await ledger.sourceOptions(principal, patient.id)).options.length,
      0,
    );
    assert.equal(
      (await ledger.history(principal, patient.id, reconcileId)).current
        .sourceState,
      'source-review-required',
    );
    await assert.rejects(
      ledger.save(principal, patient.id, reconcileId, make(r, 3)),
      status(409),
    );
    r = await review();
    await ledger.save(principal, patient.id, reconcileId, {
      ...make(r, 3),
      recordedStatus: 'current',
    });
    await owner.query(
      'UPDATE fmv.documents SET deleted_at=clock_timestamp(),extraction_lifecycle=extraction_lifecycle+1 WHERE id=$1::uuid',
      [id],
    );
    assert.equal(
      (await ledger.sourceOptions(principal, patient.id)).options.length,
      0,
    );
    history = await ledger.history(principal, patient.id, reconcileId);
    assert.equal(history.current.sourceState, 'source-review-required');
    assert.equal(history.current.entry.recordedStatus, 'current');
    assert.equal((await ledger.list(reader, patient.id)).entries.length, 0);
    await assert.rejects(
      ledger.history(reader, patient.id, reconcileId),
      status(404),
    );
    await owner.query(
      'UPDATE fmv.documents SET deleted_at=NULL,extraction_lifecycle=extraction_lifecycle+1 WHERE id=$1::uuid',
      [id],
    );
    assert.equal(
      (await ledger.sourceOptions(principal, patient.id)).options.length,
      0,
    );
    assert.equal(
      (await ledger.history(principal, patient.id, reconcileId)).current
        .sourceState,
      'source-review-required',
    );
    await extraction('Medication: SYNTHETIC renewed source\nDose: unknown');
    r = await review();
    await ledger.save(principal, patient.id, reconcileId, make(r, 4));
    // Bounded history always includes separate current state, never promotes an old entry.
    for (let rev = 5; rev < 26; rev++)
      await ledger.save(principal, patient.id, reconcileId, {
        ...make(r, rev),
        recordedStatus: rev % 2 ? 'historical' : 'current',
      });
    history = await ledger.history(principal, patient.id, reconcileId);
    assert.equal(history.history.length, 20);
    assert.equal(history.current.entry.revision, 26);
    assert.equal(history.nextBeforeRevision, 6);
    const older = await ledger.history(principal, patient.id, reconcileId, {
      beforeRevision: '6',
    });
    assert.equal(older.current.entry.revision, 26);
    assert.equal(older.history.length, 6);
    assert.equal(older.nextBeforeRevision, null);
    for (let i = 0; i < 21; i++)
      await ledger.save(principal, patient.id, randomUUID(), make(r));
    list = await ledger.list(principal, patient.id);
    assert.equal(list.entries.length, 20);
    assert.ok(list.nextCursor);
    const next = await ledger.list(principal, patient.id, {
      cursor: JSON.stringify(list.nextCursor),
    });
    assert.equal(next.entries.length, 2);
    assert.equal(next.nextCursor, null);
    assert.equal(
      new Set(
        [...list.entries, ...next.entries].map((v) => v.entry.medicationId),
      ).size,
      22,
    );
    await assert.rejects(
      runtime.query(
        'UPDATE fmv.medication_reconciliations SET recorded_status=$1',
        ['historical'],
      ),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      runtime.query('DELETE FROM fmv.medication_reconciliations'),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      runtime.query('DELETE FROM fmv.medication_reconciliation_events'),
      (e) => e.code === '42501',
    );
    const rows = (
      await runtime.query(
        'SELECT * FROM fmv.medication_reconciliations WHERE medication_id=$1::uuid ORDER BY revision DESC LIMIT 1',
        [reconcileId],
      )
    ).rows;
    const current = rows[0];
    const direct = async (patch = {}) => {
      const v = {
        ...current,
        id: randomUUID(),
        revision: 27,
        action: 'correction',
        request_id: randomUUID(),
        ...patch,
      };
      return runtime.query(
        'INSERT INTO fmv.medication_reconciliations(id,medication_id,patient_id,document_id,candidate_id,source_revision,source_sha256,lifecycle_version,review_revision,revision,action,recorded_status,fields,request_id,payload_hash,actor_account_id,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',
        [
          v.id,
          v.medication_id,
          v.patient_id,
          v.document_id,
          v.candidate_id,
          v.source_revision,
          v.source_sha256,
          v.lifecycle_version,
          v.review_revision,
          v.revision,
          v.action,
          v.recorded_status,
          v.fields,
          v.request_id,
          v.payload_hash,
          v.actor_account_id,
          v.recorded_at,
        ],
      );
    };
    for (const patch of [
      { actor_account_id: readerAccountId },
      { review_revision: 1 },
      { source_revision: 1 },
      { lifecycle_version: 0 },
      { revision: 28 },
      { candidate_id: 'forged' },
      { fields: { ...current.fields, medication: null } },
    ])
      await assert.rejects(direct(patch), (e) => e.code === '23514');
    await direct({ recorded_at: new Date('2000-01-01T00:00:00Z') });
    assert.ok(
      (await ledger.history(principal, patient.id, reconcileId)).current.entry
        .recordedAt > new Date(Date.now() - 10000).toISOString(),
    );
    // A failed audit must roll back the associated correction.
    await owner.query(
      "CREATE FUNCTION fmv.synthetic_medication_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END $$",
    );
    await owner.query(
      'CREATE TRIGGER synthetic_medication_audit_failure BEFORE INSERT ON fmv.medication_reconciliation_events FOR EACH ROW EXECUTE FUNCTION fmv.synthetic_medication_audit_failure()',
    );
    try {
      await assert.rejects(
        ledger.save(principal, patient.id, reconcileId, make(r, 27)),
        status(503),
      );
    } finally {
      await owner.query(
        'DROP TRIGGER synthetic_medication_audit_failure ON fmv.medication_reconciliation_events',
      );
      await owner.query(
        'DROP FUNCTION fmv.synthetic_medication_audit_failure()',
      );
    }
    assert.equal(
      (await ledger.history(principal, patient.id, reconcileId)).current.entry
        .revision,
      27,
    );
    await owner.query(
      'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=ANY($1::uuid[])',
      [[grant.id ?? grant, scoped.id ?? scoped]],
    );
    await assert.rejects(ledger.list(reader, patient.id), status(404));
    await assert.rejects(
      ledger.history(reader, patient.id, reconcileId),
      status(404),
    );
    const beforeEvents = (
      await runtime.query(
        'SELECT count(*)::int n FROM fmv.medication_reconciliation_events WHERE patient_id=$1::uuid',
        [patient.id],
      )
    ).rows[0].n;
    try {
      await owner.query('CREATE SEQUENCE fmv.synthetic_medication_audit_probe');
      await owner.query(
        'GRANT USAGE ON SEQUENCE fmv.synthetic_medication_audit_probe TO fmv_app',
      );
      await owner.query(
        "CREATE FUNCTION fmv.synthetic_medication_audit_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_account_id::text=TG_ARGV[0] THEN PERFORM nextval('fmv.synthetic_medication_audit_probe'); PERFORM pg_sleep(0.1); END IF; RETURN NEW; END $$",
      );
      await owner.query(
        `CREATE TRIGGER synthetic_medication_audit_delay BEFORE INSERT ON fmv.medication_reconciliation_events FOR EACH ROW EXECUTE FUNCTION fmv.synthetic_medication_audit_delay('${readerAccountId}')`,
      );
      await insertGrant(runtime, fixture, {
        actions: ['view'],
        expiresAt: new Date(Date.now() + 1000),
      });
      await assert.rejects(
        ledger.history(reader, patient.id, reconcileId),
        status(404),
      );
      assert.equal(
        (
          await owner.query(
            'SELECT is_called FROM fmv.synthetic_medication_audit_probe',
          )
        ).rows[0].is_called,
        true,
      );
      assert.equal(
        (
          await runtime.query(
            'SELECT count(*)::int n FROM fmv.medication_reconciliation_events WHERE patient_id=$1::uuid',
            [patient.id],
          )
        ).rows[0].n,
        beforeEvents,
      );
    } finally {
      await owner.query(
        'DROP TRIGGER IF EXISTS synthetic_medication_audit_delay ON fmv.medication_reconciliation_events',
      );
      await owner.query(
        'DROP FUNCTION IF EXISTS fmv.synthetic_medication_audit_delay()',
      );
      await owner.query(
        'DROP SEQUENCE IF EXISTS fmv.synthetic_medication_audit_probe',
      );
    }
    const createChoice = async (index, count) => {
      const upload = await f.intake.begin(
        patient.id,
        {
          title: `Synthetic prescription choice ${index}.pdf`,
          mimeType: 'application/pdf',
          bytes: f.bytes.length,
          sha256: first.source.sourceSha256,
          idempotencyKey: randomUUID(),
          categoryId: f.categoryId,
        },
        f.authorize,
      );
      await f.intake.content(patient.id, upload.uploadId, f.bytes, f.authorize);
      await f.intake.finalize(patient.id, upload.uploadId, f.authorize);
      const doc = upload.documentId,
        context = (
          await service.extraction.read(principal, patient.id, doc, false)
        ).context;
      await service.extraction.save(principal, patient.id, doc, {
        requestId: randomUUID(),
        expectedRevision: context.revision,
        lifecycleVersion: context.lifecycleVersion,
        sourceSha256: context.sourceSha256,
        result: {
          method: 'pdf-text',
          engineVersion: 'pdfjs-6.5.438',
          pages: [
            {
              page: 1,
              text: Array.from(
                { length: count },
                (_, i) =>
                  `Medication: SYNTHETIC ${index} ${i}\nDose: literal source only`,
              ).join('\n\n'),
            },
          ],
          partial: false,
          partialReason: null,
          downsized: false,
        },
      });
      const source = await service.medication.read(principal, patient.id, doc);
      await service.medication.write(
        principal,
        patient.id,
        doc,
        {
          requestId: randomUUID(),
          expectedRevision: source.context.revision,
          sourceRevision: source.context.sourceRevision,
          sourceSha256: source.context.sourceSha256,
          lifecycleVersion: source.context.lifecycleVersion,
          confirmed: true,
          meaning: 'source-fields-only',
          candidateIds: source.candidates.map((c) => c.id),
        },
        'confirmation',
      );
    };
    for (let i = 0; i < 26; i++) await createChoice(i, 1);
    const cappedDocs = await ledger.sourceOptions(principal, patient.id);
    assert.equal(cappedDocs.options.length, 25);
    assert.equal(cappedDocs.limited, true);
    for (let i = 26; i < 29; i++) await createChoice(i, 20);
    const cappedOptions = await ledger.sourceOptions(principal, patient.id);
    assert.equal(cappedOptions.options.length, 50);
    assert.equal(cappedOptions.limited, true);
    assert.equal(
      new Set(
        cappedOptions.options.map(
          (o) => o.binding.documentId + '/' + o.binding.candidateId,
        ),
      ).size,
      50,
    );
  } finally {
    await ledger.onModuleDestroy();
    await other.onModuleDestroy();
  }
}
