import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeDiagnosisReview } from '../../dist/documents/diagnosis-review.store.js';
export async function verifyDiagnosisStatements(f) {
  const {
    service,
    otherService,
    store,
    runtime,
    owner,
    principal,
    reader,
    patient,
    id,
    extraction,
    insertGrant,
    ownerAccountId,
    readerAccountId,
  } = f;
  const status = (n) => (e) => e.getStatus?.() === n;
  const read = (actor = principal) =>
    service.diagnosis.read(actor, patient.id, id);
  const write = (input, action = 'confirmation', actor = principal) =>
    service.diagnosis.write(actor, patient.id, id, input, action);
  const make = (r, ids = r.candidates.map((c) => c.id)) => ({
    requestId: randomUUID(),
    expectedRevision: r.context.revision,
    sourceRevision: r.context.sourceRevision,
    sourceSha256: r.context.sourceSha256,
    lifecycleVersion: r.context.lifecycleVersion,
    confirmed: true,
    meaning: 'source-statement-only',
    candidateIds: ids,
  });
  const withdrawal = (r, ids = r.snapshot.statements.map((c) => c.id)) => {
    const { sourceRevision, ...input } = make(r, ids);
    void sourceRevision;
    return input;
  };
  const count = async () =>
    Number(
      (
        await runtime.query(
          'SELECT count(*) n FROM fmv.document_diagnosis_reviews WHERE document_id=$1::uuid',
          [id],
        )
      ).rows[0].n,
    );
  await extraction(
    '🧊 SYNTHETIC\r\nDiagnosis: No SYNTHETIC condition\r\nDiagnosis: Possible SYNTHETIC condition?',
  );
  let r = await read();
  assert.equal(r.snapshot, null);
  assert.equal(r.candidates.length, 2);
  const first = make(r, [r.candidates[0].id]);
  assert.deepEqual(await write(first), { saved: true, revision: 1 });
  assert.deepEqual(await write(first), { saved: true, revision: 1 });
  assert.equal(await count(), 1);
  r = await read();
  assert.equal(r.snapshot.meaning, 'source-statement-only');
  assert.equal(r.snapshot.statements[0].field.value, 'No SYNTHETIC condition');
  assert.equal('verified' in r.snapshot, false);
  assert.equal('status' in r.snapshot, false);
  const partial = make(r, [r.candidates[1].id]);
  await write(partial);
  r = await read();
  assert.equal(r.snapshot.statements.length, 2);
  const grant = await insertGrant(
    runtime,
    {
      patientId: patient.id,
      caregiverAccountId: readerAccountId,
      ownerAccountId,
    },
    {
      actions: ['view', 'edit', 'manage', 'upload', 'export'],
      scopeKind: 'document',
      documentId: id,
    },
  );
  assert.equal((await read(reader)).context.canVerify, false);
  await assert.rejects(write(make(r), 'confirmation', reader), status(404));
  await assert.rejects(write(withdrawal(r), 'withdrawal', reader), status(404));
  await assert.rejects(
    write({ meaning: 'current-diagnosis' }, 'confirmation', reader),
    status(404),
  );
  await owner.query(
    'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1::uuid',
    [grant.id ?? grant],
  );
  await assert.rejects(read(reader), status(404));
  await assert.rejects(
    write({ ...make(r), meaning: 'current-diagnosis' }),
    status(400),
  );
  await assert.rejects(
    write({ ...make(r), candidateIds: ['page-1-diagnosis-99999'] }),
    status(409),
  );
  const removeFirst = withdrawal(r, [r.snapshot.statements[0].id]);
  await write(removeFirst, 'withdrawal');
  await write(removeFirst, 'withdrawal');
  r = await read();
  assert.equal(r.snapshot.statements.length, 1);
  assert.equal(
    r.snapshot.withdrawnStatements[0].field.value,
    'No SYNTHETIC condition',
  );
  await write(make(r, [r.candidates[1].id]));
  r = await read();
  assert.equal(
    r.snapshot.statements.length,
    1,
    'partial confirmation must not resurrect',
  );
  await assert.rejects(write(first), status(409));
  await assert.rejects(
    write({ ...make(r), requestId: removeFirst.requestId }),
    status(409),
  );
  const oldSource = r.snapshot.sourceRevision;
  await extraction('Diagnosis: History of SYNTHETIC condition');
  r = await read();
  assert.equal(r.snapshot.sourceRevision, oldSource);
  await write(withdrawal(r), 'withdrawal');
  r = await read();
  assert.equal(r.snapshot.statements.length, 0);
  assert.equal(r.snapshot.action, 'withdrawal');
  const history = await service.diagnosis.history(
    principal,
    patient.id,
    id,
    String(r.context.revision),
  );
  assert.equal(history.snapshot.revision, r.context.revision - 1);
  assert.equal(history.snapshot.meaning, 'source-statement-only');
  await write(make(r));
  r = await read();
  assert.equal(
    r.snapshot.statements[0].field.value,
    'History of SYNTHETIC condition',
  );
  const stale = withdrawal(r);
  await service.changeTrash(principal, patient.id, id, 'trash', {});
  await assert.rejects(read(), status(404));
  await assert.rejects(write(stale, 'withdrawal'), status(404));
  await service.changeTrash(principal, patient.id, id, 'restore', {});
  await assert.rejects(write(stale, 'withdrawal'), status(409));
  r = await read();
  await write(withdrawal(r), 'withdrawal');
  r = await read();
  await write(make(r));
  r = await read();
  const race = await Promise.allSettled([
    write(withdrawal(r), 'withdrawal'),
    otherService.diagnosis.write(
      principal,
      patient.id,
      id,
      make(r),
      'confirmation',
    ),
  ]);
  assert.equal(race.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(
    race.filter(
      (x) => x.status === 'rejected' && x.reason.getStatus?.() === 409,
    ).length,
    1,
  );
  r = await read();
  if (!r.snapshot.statements.length) {
    await write(make(r));
    r = await read();
  }
  const before = await count(),
    input = withdrawal(r);
  let authCalls = 0;
  await assert.rejects(
    writeDiagnosisReview(
      store.db,
      patient.id,
      id,
      input,
      'withdrawal',
      async () => {
        if (++authCalls === 2) throw Error('Synthetic final denial');
        return { accountId: ownerAccountId, canVerify: true };
      },
    ),
  );
  assert.equal(await count(), before);
  await owner.query(
    "CREATE FUNCTION fmv.fail_diagnosis_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='document.diagnosis_withdrawn' THEN RAISE EXCEPTION 'Synthetic';END IF;RETURN NEW;END $$",
  );
  await owner.query(
    'CREATE TRIGGER fail_diagnosis_probe BEFORE INSERT ON fmv.document_events FOR EACH ROW EXECUTE FUNCTION fmv.fail_diagnosis_probe()',
  );
  try {
    await assert.rejects(write(input, 'withdrawal'), status(503));
    assert.equal(await count(), before);
  } finally {
    await owner.query(
      'DROP TRIGGER fail_diagnosis_probe ON fmv.document_events',
    );
    await owner.query('DROP FUNCTION fmv.fail_diagnosis_probe()');
  }
  await write(input, 'withdrawal');
  assert.equal(await count(), before + 1);
  const rights = (
    await runtime.query(
      "SELECT has_table_privilege(current_user,'fmv.document_diagnosis_reviews','SELECT') r,has_table_privilege(current_user,'fmv.document_diagnosis_reviews','INSERT') i,has_table_privilege(current_user,'fmv.document_diagnosis_reviews','UPDATE') u,has_table_privilege(current_user,'fmv.document_diagnosis_reviews','DELETE') d",
    )
  ).rows[0];
  assert.deepEqual(rights, { r: true, i: true, u: false, d: false });
  const source = '🧊 SYNTHETIC\r\nDiagnosis: No SYNTHETIC condition\r\n';
  const candidate = {
    id: `page-1-diagnosis-${source.indexOf('Diagnosis:')}`,
    page: 1,
    field: {
      value: 'No SYNTHETIC condition',
      excerpt: 'Diagnosis: No SYNTHETIC condition',
    },
    unverified: true,
    confidence: 'unrated',
  };
  const matches = (
    await runtime.query(
      'SELECT fmv.diagnosis_statement_matches($1::jsonb,$2,false) valid,fmv.diagnosis_statement_matches($1::jsonb,$2,true) truncated,fmv.diagnosis_statement_matches($3::jsonb,$2,false) forged',
      [
        JSON.stringify(candidate),
        source,
        JSON.stringify({ ...candidate, id: 'page-1-diagnosis-0' }),
      ],
    )
  ).rows[0];
  assert.deepEqual(matches, { valid: true, truncated: false, forged: false });
  const shapes = (
    await runtime.query(
      "SELECT fmv.diagnosis_set_valid($1::jsonb,'[]'::jsonb,'confirmation') valid,fmv.diagnosis_set_valid('[]'::jsonb,$1::jsonb,'withdrawal') last,fmv.diagnosis_set_valid($1::jsonb,$1::jsonb,'withdrawal') duplicate",
      [JSON.stringify([candidate])],
    )
  ).rows[0];
  assert.deepEqual(shapes, { valid: true, last: true, duplicate: false });
  r = await read();
  await write(make(r));
  r = await read();
  const candidateNow = r.snapshot.statements[0];
  const probe = (
    statements,
    withdrawnStatements,
    action = 'confirmation',
    actor = ownerAccountId,
  ) =>
    runtime.query(
      `INSERT INTO fmv.document_diagnosis_reviews(id,document_id,patient_id,revision,source_revision,source_sha256,lifecycle_version,request_id,payload_hash,actor_account_id,source_context,action,statements,withdrawn_statements) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8::uuid,$9,$10::uuid,$11::jsonb,$12,$13::jsonb,$14::jsonb)`,
      [
        randomUUID(),
        id,
        patient.id,
        r.context.revision + 1,
        r.snapshot.sourceRevision,
        r.context.sourceSha256,
        r.context.lifecycleVersion,
        randomUUID(),
        'a'.repeat(64),
        actor,
        JSON.stringify(r.snapshot.extraction),
        action,
        JSON.stringify(statements),
        JSON.stringify(withdrawnStatements),
      ],
    );
  const forged = {
    ...candidateNow,
    field: {
      value: 'SYNTHETIC changed source',
      excerpt: 'Diagnosis: SYNTHETIC changed source',
    },
  };
  await assert.rejects(probe([forged], []), (e) => e.code === '23514');
  await assert.rejects(
    probe([{ ...candidateNow, id: 'page-1-diagnosis-1' }], []),
    (e) => e.code === '23514',
  );
  await assert.rejects(
    probe([{ ...candidateNow, id: 'page-1-diagnosis-00' }], []),
    (e) => e.code === '23514',
  );
  await assert.rejects(
    probe([], [forged], 'withdrawal'),
    (e) => e.code === '23514',
  );
  await assert.rejects(
    probe([candidateNow], [], 'confirmation', readerAccountId),
    (e) => e.code === '23514',
  );
  await assert.rejects(
    runtime.query(
      'UPDATE fmv.document_diagnosis_reviews SET statements=statements WHERE document_id=$1::uuid',
      [id],
    ),
    (e) => e.code === '42501',
  );
  await assert.rejects(
    runtime.query(
      'DELETE FROM fmv.document_diagnosis_reviews WHERE document_id=$1::uuid',
      [id],
    ),
    (e) => e.code === '42501',
  );
  const forced = (
    await runtime.query(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='fmv.document_diagnosis_reviews'::regclass",
    )
  ).rows[0];
  assert.deepEqual(forced, { relrowsecurity: true, relforcerowsecurity: true });
  assert.equal(
    (
      await runtime.query(
        "SELECT count(*)::int n FROM pg_constraint WHERE conrelid='fmv.document_diagnosis_reviews'::regclass AND conname='diagnosis_review_source' AND confdeltype='c'",
      )
    ).rows[0].n,
    1,
  );
  const longPrefix = '\n'.repeat(499900),
    longText = longPrefix + 'Diagnosis: SYNTHETIC bounded source';
  const longCandidate = {
    ...candidate,
    id: `page-1-diagnosis-${longPrefix.length}`,
    field: {
      value: 'SYNTHETIC bounded source',
      excerpt: 'Diagnosis: SYNTHETIC bounded source',
    },
  };
  assert.equal(
    (
      await runtime.query(
        'SELECT fmv.diagnosis_statement_matches($1::jsonb,$2,false) ok',
        [JSON.stringify(longCandidate), longText],
      )
    ).rows[0].ok,
    true,
  );
  assert.equal(
    (
      await runtime.query(
        'SELECT fmv.diagnosis_statement_matches($1::jsonb,$2,true) ok',
        [JSON.stringify(longCandidate), longText],
      )
    ).rows[0].ok,
    false,
  );
}
