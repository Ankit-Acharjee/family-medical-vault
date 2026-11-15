import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { extractMedicationFields } from '@fmv/contracts';
import { writeMedicationReview } from '../../dist/documents/medication-review.store.js';
export async function verifyMedicationStatements(f) {
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
    service.medication.read(actor, patient.id, id);
  const write = (input, action = 'confirmation', actor = principal) =>
    service.medication.write(actor, patient.id, id, input, action);
  const make = (r, ids = r.candidates.map((c) => c.id)) => ({
    requestId: randomUUID(),
    expectedRevision: r.context.revision,
    sourceRevision: r.context.sourceRevision,
    sourceSha256: r.context.sourceSha256,
    lifecycleVersion: r.context.lifecycleVersion,
    confirmed: true,
    meaning: 'source-fields-only',
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
          'SELECT count(*) n FROM fmv.document_medication_reviews WHERE document_id=$1::uuid',
          [id],
        )
      ).rows[0].n,
    );
  await extraction(
    '🧊 SYNTHETIC\r\nMedication: No SYNTHETIC condition\r\nDose: SYNTHETIC first only\r\nMedication: Possible SYNTHETIC condition?\r\nDose: SYNTHETIC second only\r\nFrequency: if needed',
  );
  let r = await read();
  assert.equal(r.snapshot, null);
  assert.equal(r.candidates.length, 2);
  const first = make(r, [r.candidates[0].id]);
  assert.deepEqual(await write(first), { saved: true, revision: 1 });
  assert.deepEqual(await write(first), { saved: true, revision: 1 });
  assert.equal(await count(), 1);
  r = await read();
  assert.equal(r.snapshot.meaning, 'source-fields-only');
  assert.equal(
    r.snapshot.statements[0].fields.medication.value,
    'No SYNTHETIC condition',
  );
  assert.equal('verified' in r.snapshot, false);
  assert.equal('status' in r.snapshot, false);
  assert.equal('regimen' in r.snapshot, false);
  assert.equal('schedule' in r.snapshot, false);
  assert.equal(
    r.snapshot.statements[0].fields.dose.value,
    'SYNTHETIC first only',
  );
  const partial = make(r, [r.candidates[1].id]);
  await write(partial);
  r = await read();
  assert.equal(r.snapshot.statements.length, 2);
  assert.equal(r.snapshot.statements[1].fields.frequency.value, 'if needed');
  assert.equal(
    r.snapshot.statements[1].fields.dose.value,
    'SYNTHETIC second only',
  );
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
    write({ meaning: 'active-regimen' }, 'confirmation', reader),
    status(404),
  );
  await owner.query(
    'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1::uuid',
    [grant.id ?? grant],
  );
  await assert.rejects(read(reader), status(404));
  await assert.rejects(
    write({ ...make(r), meaning: 'active-regimen' }),
    status(400),
  );
  await assert.rejects(
    write({ ...make(r), candidateIds: ['page-1-medication-99999'] }),
    status(409),
  );
  const removeFirst = withdrawal(r, [r.snapshot.statements[0].id]);
  await write(removeFirst, 'withdrawal');
  await write(removeFirst, 'withdrawal');
  r = await read();
  assert.equal(r.snapshot.statements.length, 1);
  assert.equal(
    r.snapshot.withdrawnStatements[0].fields.medication.value,
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
  await extraction('Medication: History of SYNTHETIC condition');
  r = await read();
  assert.equal(r.snapshot.sourceRevision, oldSource);
  await write(withdrawal(r), 'withdrawal');
  r = await read();
  assert.equal(r.snapshot.statements.length, 0);
  assert.equal(r.snapshot.action, 'withdrawal');
  const history = await service.medication.history(
    principal,
    patient.id,
    id,
    String(r.context.revision),
  );
  assert.equal(history.snapshot.revision, r.context.revision - 1);
  assert.equal(history.snapshot.meaning, 'source-fields-only');
  assert.equal(
    history.snapshot.statements[0].fields.frequency.value,
    'if needed',
  );
  await write(make(r));
  r = await read();
  assert.equal(
    r.snapshot.statements[0].fields.medication.value,
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
    otherService.medication.write(
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
    writeMedicationReview(
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
    "CREATE FUNCTION fmv.fail_medication_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='document.medication_withdrawn' THEN RAISE EXCEPTION 'Synthetic';END IF;RETURN NEW;END $$",
  );
  await owner.query(
    'CREATE TRIGGER fail_medication_probe BEFORE INSERT ON fmv.document_events FOR EACH ROW EXECUTE FUNCTION fmv.fail_medication_probe()',
  );
  try {
    await assert.rejects(write(input, 'withdrawal'), status(503));
    assert.equal(await count(), before);
  } finally {
    await owner.query(
      'DROP TRIGGER fail_medication_probe ON fmv.document_events',
    );
    await owner.query('DROP FUNCTION fmv.fail_medication_probe()');
  }
  await write(input, 'withdrawal');
  assert.equal(await count(), before + 1);
  const rights = (
    await runtime.query(
      "SELECT has_table_privilege(current_user,'fmv.document_medication_reviews','SELECT') r,has_table_privilege(current_user,'fmv.document_medication_reviews','INSERT') i,has_table_privilege(current_user,'fmv.document_medication_reviews','UPDATE') u,has_table_privilege(current_user,'fmv.document_medication_reviews','DELETE') d",
    )
  ).rows[0];
  assert.deepEqual(rights, { r: true, i: true, u: false, d: false });
  const source = '🧊 SYNTHETIC\r\nMedication: No SYNTHETIC condition\r\n';
  const candidate = extractMedicationFields([{ page: 1, text: source }])[0];
  const matches = (
    await runtime.query(
      'SELECT fmv.medication_statement_matches($1::jsonb,$2,false) valid,fmv.medication_statement_matches($1::jsonb,$2,true) truncated,fmv.medication_statement_matches($3::jsonb,$2,false) forged',
      [
        JSON.stringify(candidate),
        source,
        JSON.stringify({ ...candidate, id: 'page-1-medication-0' }),
      ],
    )
  ).rows[0];
  assert.deepEqual(matches, { valid: true, truncated: false, forged: false });
  const shapes = (
    await runtime.query(
      "SELECT fmv.medication_set_valid($1::jsonb,'[]'::jsonb,'confirmation') valid,fmv.medication_set_valid('[]'::jsonb,$1::jsonb,'withdrawal') last,fmv.medication_set_valid($1::jsonb,$1::jsonb,'withdrawal') duplicate",
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
      `INSERT INTO fmv.document_medication_reviews(id,document_id,patient_id,revision,source_revision,source_sha256,lifecycle_version,request_id,payload_hash,actor_account_id,source_context,action,statements,withdrawn_statements) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8::uuid,$9,$10::uuid,$11::jsonb,$12,$13::jsonb,$14::jsonb)`,
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
    fields: {
      ...candidateNow.fields,
      medication: {
        value: 'SYNTHETIC changed source',
        excerpt: 'Medication: SYNTHETIC changed source',
      },
    },
  };
  await assert.rejects(probe([forged], []), (e) => e.code === '23514');
  await assert.rejects(
    probe([{ ...candidateNow, id: 'page-1-medication-1' }], []),
    (e) => e.code === '23514',
  );
  await assert.rejects(
    probe([{ ...candidateNow, id: 'page-1-medication-00' }], []),
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
      'UPDATE fmv.document_medication_reviews SET statements=statements WHERE document_id=$1::uuid',
      [id],
    ),
    (e) => e.code === '42501',
  );
  await assert.rejects(
    runtime.query(
      'DELETE FROM fmv.document_medication_reviews WHERE document_id=$1::uuid',
      [id],
    ),
    (e) => e.code === '42501',
  );
  const forced = (
    await runtime.query(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='fmv.document_medication_reviews'::regclass",
    )
  ).rows[0];
  assert.deepEqual(forced, { relrowsecurity: true, relforcerowsecurity: true });
  assert.equal(
    (
      await runtime.query(
        "SELECT count(*)::int n FROM pg_constraint WHERE conrelid='fmv.document_medication_reviews'::regclass AND conname='medication_review_source' AND confdeltype='c'",
      )
    ).rows[0].n,
    1,
  );
  const longPrefix = '\n'.repeat(499900),
    longText = longPrefix + 'Medication: SYNTHETIC bounded source';
  const longCandidate = extractMedicationFields([
    { page: 1, text: longText },
  ])[0];
  assert.equal(
    (
      await runtime.query(
        'SELECT fmv.medication_statement_matches($1::jsonb,$2,false) ok',
        [JSON.stringify(longCandidate), longText],
      )
    ).rows[0].ok,
    true,
  );
  assert.equal(
    (
      await runtime.query(
        'SELECT fmv.medication_statement_matches($1::jsonb,$2,true) ok',
        [JSON.stringify(longCandidate), longText],
      )
    ).rows[0].ok,
    false,
  );
  await verifyMedicationBlockAssociation(runtime);
  await extraction(
    'Medication: SYNTHETIC first\n\nMedication: SYNTHETIC second',
  );
  r = await read();
  await write(make(r));
  r = await read();
  assert.equal(r.snapshot.statements.length, 2);
  await assert.rejects(
    probe([r.snapshot.statements[0]], []),
    (e) => e.code === '23514',
    'same-source confirmation cannot silently remove another active block',
  );
}

/** The SQL proof must bind every field to its medication block, not a page-wide match. */
async function verifyMedicationBlockAssociation(runtime) {
  const check = async (candidate, text, drop = false) =>
    (
      await runtime.query(
        'SELECT fmv.medication_statement_matches($1::jsonb,$2,$3) ok',
        [JSON.stringify(candidate), text, drop],
      )
    ).rows[0].ok;
  const text =
    '🧊 source\r\nMedication: SYNTHETIC stopped?\r\nDose: first source dose\r\nFrequency: if needed\r\n\r\nMedication: SYNTHETIC historical\r\nDose: second source dose';
  const [a, b] = extractMedicationFields([{ page: 1, text }]);
  assert.equal(await check(a, text), true);
  assert.equal(await check(b, text), true);
  assert.equal(
    await check({ ...a, fields: { ...a.fields, dose: b.fields.dose } }, text),
    false,
    'dose must belong to this block',
  );
  assert.equal(
    await check({ ...a, fields: { ...a.fields, dose: null } }, text),
    false,
    'must attest every provided field',
  );
  assert.equal(
    await check({ ...a, id: 'page-1-medication-10' }, text),
    false,
    'UTF16 identity cannot be scalar offset',
  );
  assert.equal(await check({ ...a, id: 'page-1-medication-0' }, text), false);
  assert.equal(await check({ ...a, id: 'page-1-medication-00' }, text), false);
  assert.equal(
    await check(
      {
        ...a,
        fields: {
          ...a.fields,
          medication: { ...a.fields.medication, value: 'SYNTHETIC stopped' },
        },
      },
      text,
    ),
    false,
    'uncertainty cannot be normalized',
  );
  for (const suffix of [
    '\nDose: duplicate',
    '\nUnrecognized: abort',
    '\nRoute: ',
    '\nInstructions: ' + 'x'.repeat(121),
  ]) {
    const source = 'Medication: SYNTHETIC\nDose: exact';
    const c = extractMedicationFields([{ page: 1, text: source }])[0];
    assert.equal(
      await check(c, source + suffix),
      false,
      'invalid suffix aborts whole block',
    );
  }
  const full = 'Medication: SYNTHETIC\nDose: exact\nInstructions: incomplete';
  const [truncated] = extractMedicationFields([{ page: 1, text: full }], {
    truncatedFinalLine: true,
  });
  const [complete] = extractMedicationFields([{ page: 1, text: full }]);
  assert.equal(
    await check(truncated, full, true),
    true,
    'complete preceding fields survive final-line truncation',
  );
  assert.equal(
    await check(complete, full, true),
    false,
    'discard final physical line',
  );
  assert.equal(
    await check(truncated, full + '\n', true),
    true,
    'trailing newline creates no phantom final line',
  );
  const cr = 'Medication: SYNTHETIC\nDose: literal\rqualifier';
  const [crCandidate] = extractMedicationFields([{ page: 1, text: cr }]);
  assert.equal(await check(crCandidate, cr), true, 'lone CR remains literal');
  assert.equal(
    await check(crCandidate, cr.replace('\r', '\n')),
    false,
    'lone CR cannot be interpreted as a new field',
  );
  const simple = extractMedicationFields([
    { page: 1, text: 'Medication: SYNTHETIC' },
  ])[0];
  const shape = async (value) =>
    (
      await runtime.query(
        'SELECT fmv.medication_statements_valid($1::jsonb) ok',
        [JSON.stringify(value)],
      )
    ).rows[0].ok;
  for (const malformed of [
    null,
    {},
    [],
    [null],
    ['text'],
    [true],
    [{ ...simple, page: 51, id: 'page-51-medication-0' }],
    [{ ...simple, id: 'page-1-medication-500000' }],
    [simple, simple],
    Array.from({ length: 21 }, (_, i) => ({
      ...simple,
      id: `page-1-medication-${i}`,
    })),
    [{ ...simple, fields: { ...simple.fields, status: 'active' } }],
    [{ ...simple, fields: { ...simple.fields, medication: null } }],
  ]) {
    if (Array.isArray(malformed) && malformed.length === 0) continue; // an empty active set supports last withdrawal
    assert.equal(
      await shape(malformed),
      false,
      'strict medication JSON shape and finite candidate budget',
    );
  }
  assert.equal(await shape([]), true);
  const allWhitespace =
    '\t\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  const blankBoundary =
    'Medication: SYNTHETIC\n' + allWhitespace + '\nDose: orphan';
  const [blankCandidate] = extractMedicationFields([
    { page: 1, text: blankBoundary },
  ]);
  assert.equal(
    await check(blankCandidate, blankBoundary),
    true,
    'SQL and ECMAScript whitespace end the same source block',
  );
  const astral = 'Medication: ' + '🧊'.repeat(60);
  const [astralCandidate] = extractMedicationFields([
    { page: 1, text: astral },
  ]);
  assert.equal(
    await check(astralCandidate, astral),
    true,
    '120 UTF16 value limit accepts sixty astral characters',
  );
  const tooLong = {
    ...astralCandidate,
    fields: {
      ...astralCandidate.fields,
      medication: {
        value: '🧊'.repeat(61),
        excerpt: 'Medication: ' + '🧊'.repeat(61),
      },
    },
  };
  assert.equal(
    await shape([tooLong]),
    false,
    'astral values count as two UTF16 units',
  );
  assert.equal(
    await check(simple, 'Medication: SYNTHETIC', null),
    true,
    'null truncation flag does not drop a complete source line',
  );
  const astralPrefix = '🧊\n'.repeat(166600),
    boundedAstralText =
      astralPrefix + 'Medication: SYNTHETIC bounded astral source';
  const [boundedAstralCandidate] = extractMedicationFields([
    { page: 1, text: boundedAstralText },
  ]);
  assert.equal(boundedAstralCandidate.id, 'page-1-medication-499800');
  assert.equal(
    await check(boundedAstralCandidate, boundedAstralText),
    true,
    'near-limit astral prefix keeps exact UTF16 source association',
  );
  const position = (
    await runtime.query(
      'SELECT fmv.medication_utf16_position($1,1) split,fmv.medication_utf16_position($1,2) after,fmv.medication_utf16_position($1,500000) outside',
      ['🧊\nMedication: SYNTHETIC'],
    )
  ).rows[0];
  assert.deepEqual(
    position,
    { split: null, after: 2, outside: null },
    'offsets inside surrogate pairs or beyond limit cannot identify a source block',
  );
}
