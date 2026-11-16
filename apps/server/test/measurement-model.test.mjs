import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isConfirmedMeasurement,
  isMeasurementWorkspace,
  isMeasurementComparisonResult,
  measurementMember,
  classifyMeasurementDate,
  classifyMeasurementResult,
  projectConfirmedMeasurements,
} from '@fmv/contracts';

const patientId = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';
const sha = 'a'.repeat(64);
const fields = (result = '1.20', date = '2024-02-29') => ({
  analyte: 'Synthetic analyte',
  result,
  unit: 'synthetic/unit',
  reference: '1–2',
  specimen: 'synthetic specimen',
  method: 'synthetic method',
  date,
  laboratory: 'synthetic laboratory',
});
const candidate = (id, values = fields()) => ({
  id,
  page: 1,
  unverified: true,
  confidence: 'unrated',
  fields: Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      value === null ? null : { value, excerpt: `Label: ${value}` },
    ]),
  ),
});
const review = () => {
  const source = candidate('page-1-block-1');
  return {
    context: {
      sourceRevision: 3,
      sourceSha256: sha,
      lifecycleVersion: 2,
      revision: 4,
      canVerify: true,
    },
    candidates: [source],
    snapshot: {
      action: 'confirmation',
      withdrawnItems: [],
      revision: 4,
      sourceRevision: 3,
      sourceSha256: sha,
      verifiedAt: '2026-11-15T00:00:00.000Z',
      ruleVersion: 'labeled-lab-blocks-v1',
      verified: true,
      extraction: {
        method: 'pdf-text',
        engineVersion: 'pdfjs-6.5.438',
        partial: false,
        partialReason: null,
        downsized: false,
      },
      items: [{ source, fields: fields('1.234567890123456789', '2024-02-29') }],
    },
  };
};

test('result classification preserves exact decimal precision and original representation', () => {
  for (const raw of [
    '0',
    '-0',
    '+12',
    '1.20',
    '.1',
    '1.',
    '9007199254740993',
    '0.123456789012345678901234567890',
  ])
    assert.deepEqual(classifyMeasurementResult(raw), {
      kind: 'numeric',
      raw,
      decimal: raw,
    });
  for (const operator of ['<', '<=', '>', '>=', '≤', '≥']) {
    const raw = `${operator}1.2300000000000000001`;
    assert.deepEqual(classifyMeasurementResult(raw), {
      kind: 'qualified',
      raw,
      operator,
      decimal: '1.2300000000000000001',
    });
  }
  for (const [raw, operator, decimal] of [
    ['< 5', '<', '5'],
    ['>\t+0.20', '>', '+0.20'],
    ['≤ \t1.00', '≤', '1.00'],
  ])
    assert.deepEqual(classifyMeasurementResult(raw), {
      kind: 'qualified',
      raw,
      operator,
      decimal,
    });
  for (const raw of [
    '1e3',
    ' 5',
    '5 ',
    '<\n5',
    '<\r5',
    '1,000',
    '1,2',
    '１２',
    '١٢',
    '−1',
    '1/2',
    '1-2',
    'positive',
    '',
    'NaN',
    'Infinity',
    '1 mg',
    '1.2.3',
  ])
    assert.deepEqual(classifyMeasurementResult(raw), { kind: 'text', raw });
});

test('date classification accepts real unambiguous ISO calendar days only', () => {
  assert.deepEqual(classifyMeasurementDate(null), {
    kind: 'unknown',
    raw: null,
  });
  for (const raw of ['2024-02-29', '2000-02-29', '2026-11-15'])
    assert.deepEqual(classifyMeasurementDate(raw), {
      kind: 'day',
      raw,
      isoDate: raw,
    });
  for (const raw of [
    '0000-01-01',
    '0099-01-01',
    '2023-02-29',
    '1900-02-29',
    '2024-04-31',
    '2024-00-01',
    '2024-13-01',
    '2024-01-00',
    '2024-2-01',
    '01/02/2024',
    '2024-02-29T00:00:00Z',
    '２０２４-０２-２９',
    '',
  ])
    assert.deepEqual(classifyMeasurementDate(raw), { kind: 'unparsed', raw });
});

test('projection preserves corrected fields and source evidence with isolated nested copies', () => {
  const input = review();
  const projected = projectConfirmedMeasurements(patientId, documentId, input);
  assert.deepEqual(projected, [
    {
      fields: input.snapshot.items[0].fields,
      source: input.snapshot.items[0].source,
      provenance: {
        patientId,
        documentId,
        reviewRevision: 4,
        sourceRevision: 3,
        sourceSha256: sha,
        lifecycleVersion: 2,
        verifiedAt: '2026-11-15T00:00:00.000Z',
      },
      result: {
        kind: 'numeric',
        raw: '1.234567890123456789',
        decimal: '1.234567890123456789',
      },
      collectionDate: { kind: 'day', raw: '2024-02-29', isoDate: '2024-02-29' },
      comparability: { status: 'unconfirmed' },
    },
  ]);
  projected[0].fields.result = 'changed';
  projected[0].source.fields.result.value = 'changed';
  assert.equal(input.snapshot.items[0].fields.result, '1.234567890123456789');
  assert.equal(input.snapshot.items[0].source.fields.result.value, '1.20');
});

test('projection uses only current active items, never withdrawn or provisional candidates', () => {
  const input = review();
  const withdrawn = candidate('page-1-block-2');
  const provisional = candidate('page-1-block-3');
  input.snapshot.action = 'withdrawal';
  input.snapshot.withdrawnItems = [{ source: withdrawn, fields: fields('9') }];
  input.candidates.push(withdrawn, provisional);
  assert.equal(
    projectConfirmedMeasurements(patientId, documentId, input).length,
    1,
  );
  input.snapshot.items = [];
  input.snapshot.verified = false;
  assert.deepEqual(
    projectConfirmedMeasurements(patientId, documentId, input),
    [],
  );
  const noSnapshot = review();
  noSnapshot.context.revision = 0;
  noSnapshot.snapshot = null;
  assert.deepEqual(
    projectConfirmedMeasurements(patientId, documentId, noSnapshot),
    [],
  );
});

test('matching measurements are not automatically comparable or grouped', () => {
  const input = review();
  const source = candidate('page-1-block-2');
  input.snapshot.items.push({
    source,
    fields: globalThis.structuredClone(input.snapshot.items[0].fields),
  });
  const projected = projectConfirmedMeasurements(patientId, documentId, input);
  assert.equal(projected.length, 2);
  assert.deepEqual(
    projected.map((item) => item.comparability),
    [{ status: 'unconfirmed' }, { status: 'unconfirmed' }],
  );
});

test('invalid IDs, malformed review and stale or mismatched source cannot produce measurements', () => {
  for (const [patient, document, input] of [
    ['', documentId, review()],
    [patientId, 'invalid', review()],
    [null, documentId, review()],
    [patientId, documentId, null],
    [patientId, documentId, {}],
  ])
    assert.deepEqual(
      projectConfirmedMeasurements(patient, document, input),
      [],
    );
  const stale = review();
  stale.context.sourceRevision++;
  assert.deepEqual(
    projectConfirmedMeasurements(patientId, documentId, stale),
    [],
  );
  const mismatch = review();
  mismatch.context.sourceSha256 = 'b'.repeat(64);
  assert.deepEqual(
    projectConfirmedMeasurements(patientId, documentId, mismatch),
    [],
  );
  const malformed = review();
  malformed.snapshot.items[0].source.fields.result.excerpt = 'no evidence';
  assert.deepEqual(
    projectConfirmedMeasurements(patientId, documentId, malformed),
    [],
  );
});

test('measurement workspace guards preserve provenance, precision and bounded disclosure', () => {
  const measurement = projectConfirmedMeasurements(
    patientId,
    documentId,
    review(),
  )[0];
  const option = {
    member: measurementMember(measurement),
    measurement,
    title: 'Synthetic source.pdf',
  };
  const workspace = {
    patientId,
    canConfirm: true,
    measurements: [option],
    measurementsLimited: false,
    comparisons: [],
    comparisonsLimited: false,
    sources: [
      {
        documentId,
        title: option.title,
        bytes: 100,
        mimeType: 'application/pdf',
      },
    ],
  };
  assert.equal(isConfirmedMeasurement(measurement), true);
  assert.equal(isMeasurementWorkspace(workspace), true);
  for (const patch of [
    { sources: [] },
    { measurements: [option, option] },
    { patientId: documentId },
    { extra: true },
    { sources: [{ ...workspace.sources[0], title: 'Different title' }] },
    { sources: [{ ...workspace.sources[0], bytes: 0 }] },
    { sources: [{ ...workspace.sources[0], title: 'bad\ud800' }] },
    { measurementsLimited: 'true' },
  ])
    assert.equal(isMeasurementWorkspace({ ...workspace, ...patch }), false);
  for (const patch of [
    {
      result: {
        kind: 'numeric',
        raw: measurement.fields.result,
        decimal: '1.23',
      },
    },
    { comparability: { status: 'confirmed' } },
    { provenance: { ...measurement.provenance, reviewRevision: 0 } },
    {
      provenance: {
        ...measurement.provenance,
        verifiedAt: '2026-02-30T00:00:00.000Z',
      },
    },
    { source: { ...measurement.source, unverified: false } },
    { extra: true },
  ])
    assert.equal(isConfirmedMeasurement({ ...measurement, ...patch }), false);
  const summary = {
    setId: documentId,
    revision: 1,
    status: 'current',
    analyte: 'Synthetic analyte',
    recordedAt: '2026-11-16T00:00:00.000Z',
    memberCount: 2,
  };
  assert.equal(
    isMeasurementWorkspace({ ...workspace, comparisons: [summary] }),
    true,
  );
  for (const comparisons of [
    [summary, summary],
    [{ ...summary, status: 'invalid' }],
    [{ ...summary, recordedAt: '2026-02-30T00:00:00.000Z' }],
    Array(11).fill(summary),
  ])
    assert.equal(isMeasurementWorkspace({ ...workspace, comparisons }), false);
  const second = globalThis.structuredClone(measurement);
  second.provenance.documentId = '33333333-3333-4333-8333-333333333333';
  const set = {
    setId: documentId,
    revision: 1,
    status: 'current',
    canConfirm: true,
    members: [measurementMember(measurement), measurementMember(second)],
    measurements: [measurement, second],
  };
  assert.equal(isMeasurementComparisonResult(set), true);
  const crossPatient = globalThis.structuredClone(second);
  crossPatient.provenance.patientId = documentId;
  assert.equal(
    isMeasurementComparisonResult({
      ...set,
      measurements: [measurement, crossPatient],
    }),
    false,
  );
  assert.equal(
    isMeasurementComparisonResult({
      ...set,
      measurements: [second, measurement],
    }),
    false,
  );
  assert.equal(
    isMeasurementComparisonResult({ ...set, status: 'withdrawn' }),
    false,
  );
  assert.equal(
    isMeasurementComparisonResult({
      ...set,
      status: 'withdrawn',
      measurements: [],
    }),
    true,
  );
});
