import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { isExtractionResult } from '@fmv/contracts';
import { rangeResult, rangeVectors } from './pdf-pages-ocr-vectors.mjs';

// AI-01/02/06: synthetic unverified text only, in the existing disposable DB.
export async function verifyPdfPagesOcr(f) {
  const {
    service,
    runtime,
    owner,
    principal,
    reader,
    patient,
    id,
    insertGrant,
    ownerAccountId,
    readerAccountId,
  } = f;
  const legacy = JSON.parse(
    await readFile(
      new URL('./extraction-vectors.json', import.meta.url),
      'utf8',
    ),
  );
  for (const { name, result, valid } of [...legacy, ...rangeVectors()]) {
    assert.equal(isExtractionResult(result), valid, `TS: ${name}`);
    try {
      const checked = await runtime.query(
        'SELECT fmv.extraction_result_valid($1::jsonb) ok',
        [JSON.stringify(result)],
      );
      assert.equal(checked.rows[0].ok, valid, `SQL: ${name}`);
    } catch (error) {
      // PostgreSQL rejects NUL/unpaired-surrogate JSON before the validator runs.
      if (valid || !['22P05', '22021'].includes(error.code)) throw error;
    }
  }
  const status = (n) => (e) => e.getStatus?.() === n;
  const read = (actor = principal) =>
    service.extraction.read(actor, patient.id, id);
  const input = (context, result = rangeResult()) => ({
    requestId: randomUUID(),
    expectedRevision: context.revision,
    lifecycleVersion: context.lifecycleVersion,
    sourceSha256: context.sourceSha256,
    result,
  });
  const save = (value, actor = principal) =>
    service.extraction.save(actor, patient.id, id, value);
  const result = rangeResult({
    pages: [
      {
        page: 7,
        text: 'Provider: SYNTHETIC range provider\nDiagnosis: SYNTHETIC uncertain source statement',
      },
      {
        page: 8,
        text: 'Medication: SYNTHETIC range medication\nDose: literal only',
      },
      { page: 9, text: 'Test: SYNTHETIC range analyte\nResult: literal only' },
    ],
  });
  const start = await read();
  const first = input(start.context, result);
  const ack = await save(first);
  assert.equal(ack.revision, start.context.revision + 1);
  assert.deepEqual(
    await save(first),
    ack,
    'exact replay creates no extra revision',
  );
  let current = await read();
  assert.deepEqual(current.snapshot.pages, result.pages);
  assert.equal(current.snapshot.method, 'pdf-pages-ocr');
  assert.equal(current.snapshot.unverified, true);
  const stable = current.snapshot;
  for (const change of [
    { sourceSha256: 'b'.repeat(64) },
    { lifecycleVersion: current.context.lifecycleVersion + 1 },
    { expectedRevision: current.context.revision - 1 },
  ])
    await assert.rejects(
      save({ ...input(current.context), ...change }),
      status(409),
    );
  await assert.rejects(
    save(
      input(
        current.context,
        rangeResult({
          pages: [
            { page: 7, text: 'SYNTHETIC' },
            { page: 9, text: 'SYNTHETIC' },
          ],
        }),
      ),
    ),
    status(400),
  );
  await assert.rejects(read(reader), status(404));
  await assert.rejects(save(input(current.context), reader), status(404));
  await assert.rejects(
    service.extraction.read(principal, randomUUID(), id),
    status(404),
  );
  assert.deepEqual((await read()).snapshot, stable);

  const grant = await insertGrant(
    runtime,
    {
      patientId: patient.id,
      caregiverAccountId: readerAccountId,
      ownerAccountId,
    },
    { actions: ['view'], scopeKind: 'document', documentId: id },
  );
  assert.deepEqual((await read(reader)).snapshot.pages, result.pages);
  await assert.rejects(save(input(current.context), reader), status(404));
  await owner.query(
    'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1::uuid',
    [grant.id ?? grant],
  );
  await assert.rejects(read(reader), status(404));

  // Round-trip each existing downstream provenance guard against the new method.
  const metadata = await service.metadata.read(principal, patient.id, id);
  await service.metadata.save(principal, patient.id, id, {
    requestId: randomUUID(),
    expectedRevision: metadata.context.revision,
    sourceRevision: metadata.context.sourceRevision,
    sourceSha256: metadata.context.sourceSha256,
    lifecycleVersion: metadata.context.lifecycleVersion,
    ruleVersion: 'explicit-lines-v1',
  });
  const savedMetadata = await service.metadata.read(principal, patient.id, id);
  assert.ok(savedMetadata.snapshot.suggestions.length > 0);
  const clinical = await service.clinical.read(principal, patient.id, id);
  assert.equal(clinical.candidates.length, 1);
  await service.clinical.save(principal, patient.id, id, {
    requestId: randomUUID(),
    expectedRevision: clinical.context.revision,
    sourceRevision: clinical.context.sourceRevision,
    sourceSha256: clinical.context.sourceSha256,
    lifecycleVersion: clinical.context.lifecycleVersion,
    confirmed: true,
    selections: clinical.candidates.map((c) => ({
      candidateId: c.id,
      fields: Object.fromEntries(
        Object.entries(c.fields).map(([key, value]) => [
          key,
          value?.value ?? null,
        ]),
      ),
    })),
  });
  const confirmed = await service.clinical.read(principal, patient.id, id);
  assert.equal(confirmed.snapshot.extraction.method, 'pdf-pages-ocr');
  assert.equal(confirmed.snapshot.items[0].source.page, 9);
  for (const [kind, meaning] of [
    ['diagnosis', 'source-statement-only'],
    ['medication', 'source-fields-only'],
  ]) {
    const review = await service[kind].read(principal, patient.id, id);
    assert.equal(review.candidates.length, 1);
    await service[kind].write(
      principal,
      patient.id,
      id,
      {
        requestId: randomUUID(),
        expectedRevision: review.context.revision,
        sourceRevision: review.context.sourceRevision,
        sourceSha256: review.context.sourceSha256,
        lifecycleVersion: review.context.lifecycleVersion,
        confirmed: true,
        meaning,
        candidateIds: review.candidates.map((c) => c.id),
      },
      'confirmation',
    );
    const saved = await service[kind].read(principal, patient.id, id);
    assert.equal(saved.snapshot.extraction.method, 'pdf-pages-ocr');
    assert.equal(
      saved.snapshot.statements[0].page,
      kind === 'diagnosis' ? 7 : 8,
    );
  }

  // A character-truncated range must not republish the unfinished last line.
  current = await read();
  await save(
    input(
      current.context,
      rangeResult({
        partialReason: 'characters',
        pages: [
          { page: 7, text: 'Diagnosis: SYNTHETIC complete first page' },
          { page: 8, text: 'Diagnosis: SYNTHETIC incomplete last page' },
        ],
      }),
    ),
  );
  const truncated = await service.diagnosis.read(principal, patient.id, id);
  assert.deepEqual(
    truncated.candidates.map((c) => c.page),
    [7],
  );

  current = await read();
  const beforeTrash = input(current.context);
  await service.changeTrash(principal, patient.id, id, 'trash', {});
  await assert.rejects(read(), status(404));
  await assert.rejects(save(beforeTrash), status(404));
  await service.changeTrash(principal, patient.id, id, 'restore', {});
  await assert.rejects(save(beforeTrash), status(409));
  assert.deepEqual((await read()).snapshot, current.snapshot);

  // Existing audit transaction remains atomic for the additive result method.
  current = await read();
  const retry = input(current.context);
  await owner.query(
    "CREATE FUNCTION fmv.fail_range_save_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='document.extraction_saved' THEN RAISE EXCEPTION 'Synthetic';END IF;RETURN NEW;END $$",
  );
  await owner.query(
    'CREATE TRIGGER fail_range_save_probe BEFORE INSERT ON fmv.document_events FOR EACH ROW EXECUTE FUNCTION fmv.fail_range_save_probe()',
  );
  try {
    await assert.rejects(save(retry), status(503));
    assert.deepEqual((await read()).snapshot, current.snapshot);
  } finally {
    await owner.query(
      'DROP TRIGGER fail_range_save_probe ON fmv.document_events',
    );
    await owner.query('DROP FUNCTION fmv.fail_range_save_probe()');
  }
  await save(retry);
  current = await read();
  await assert.rejects(
    runtime.query(
      'UPDATE fmv.document_extractions SET source_sha256=$1,revision=revision+1 WHERE document_id=$2::uuid',
      ['b'.repeat(64), id],
    ),
    (e) => e.code === '23514',
  );
  await assert.rejects(
    runtime.query(
      'UPDATE fmv.document_extractions SET lifecycle_version=$1,revision=revision+1 WHERE document_id=$2::uuid',
      [current.context.lifecycleVersion - 1, id],
    ),
    (e) => e.code === '23514',
  );
  assert.deepEqual((await read()).snapshot, current.snapshot);
  const events = (
    await runtime.query(
      'SELECT to_jsonb(e)::text payload FROM fmv.document_events e WHERE document_id=$1::uuid',
      [id],
    )
  ).rows;
  assert.ok(
    events.every(({ payload }) => !payload.includes('SYNTHETIC')),
    'audit contains no source text',
  );
}
