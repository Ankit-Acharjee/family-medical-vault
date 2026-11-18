import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectConfirmedMeasurements,
  measurementMember,
  projectGroundedSummary,
  isGroundedSummary,
  isGroundedSummaryRequest,
  isSummaryPeriod,
} from '@fmv/contracts';
const patientId = '11111111-1111-4111-8111-111111111111',
  documentId = '22222222-2222-4222-8222-222222222222',
  medicationId = '33333333-3333-4333-8333-333333333333';
const stamp = '2026-11-18T00:00:00.000Z',
  sha = 'a'.repeat(64);
function laboratory(
  dates = ['2024-02-29', null, 'February 2024', '2026-11-17'],
) {
  const items = dates.map((date, i) => {
    const fields = {
      analyte: 'SYNTHETIC analyte',
      result: '<0.123456789012345678901',
      unit: 'synthetic/unit',
      reference: null,
      specimen: null,
      method: null,
      date,
      laboratory: null,
    };
    const source = {
      id: `page-1-block-${i}`,
      page: 1,
      unverified: true,
      confidence: 'unrated',
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [
          k,
          v === null ? null : { value: v, excerpt: `Label: ${v}` },
        ]),
      ),
    };
    return { source, fields };
  });
  const measurements = projectConfirmedMeasurements(patientId, documentId, {
    context: {
      sourceRevision: 1,
      sourceSha256: sha,
      lifecycleVersion: 0,
      revision: 1,
      canVerify: true,
    },
    candidates: items.map((i) => i.source),
    snapshot: {
      action: 'confirmation',
      withdrawnItems: [],
      revision: 1,
      sourceRevision: 1,
      sourceSha256: sha,
      verifiedAt: stamp,
      ruleVersion: 'labeled-lab-blocks-v1',
      verified: true,
      extraction: {
        method: 'pdf-text',
        engineVersion: 'pdfjs-6.5.438',
        partial: false,
        partialReason: null,
        downsized: false,
      },
      items,
    },
  });
  assert.equal(measurements.length, dates.length);
  return {
    patientId,
    canConfirm: true,
    measurements: measurements.map((measurement) => ({
      member: measurementMember(measurement),
      title: 'SYNTHETIC report',
      measurement,
    })),
    measurementsLimited: false,
    comparisons: [],
    comparisonsLimited: false,
    sources: [
      {
        documentId,
        title: 'SYNTHETIC report',
        bytes: 10,
        mimeType: 'application/pdf',
      },
    ],
  };
}
function fixture() {
  const manualEntry = {
    readingId: '44444444-4444-4444-8444-444444444444',
    patientId,
    revision: 1,
    action: 'record',
    reading: {
      kind: 'glucose',
      unit: 'mg/dL',
      observedAt: '2024-02-29T00:30:00+14:00',
      values: { value: '100.000000000000000001' },
    },
    recordedAt: stamp,
    provenance: 'manual',
  };
  const entry = {
    medicationId,
    patientId,
    revision: 1,
    action: 'reconciliation',
    recordedAt: stamp,
    meaning: 'owner-recorded-medication-context',
    source: {
      documentId,
      candidateId: 'page-1-medication-0',
      sourceRevision: 1,
      sourceSha256: sha,
      lifecycleVersion: 0,
      reviewRevision: 1,
    },
    recordedStatus: 'current',
    fields: {
      medication: 'SYNTHETIC medication',
      strength: null,
      dose: 'as written?',
      frequency: null,
      route: null,
      duration: null,
      start: null,
      end: null,
      instructions: null,
    },
  };
  return {
    patientId,
    generatedAt: stamp,
    request: {
      scope: 'patient',
      period: { fromDate: '2024-02-29', toDate: '2024-02-29' },
    },
    laboratory: laboratory(),
    manual: {
      patientId,
      canWrite: true,
      entries: [manualEntry],
      nextCursor: null,
    },
    medications: {
      patientId,
      canWrite: true,
      entries: [{ entry, sourceState: 'current-source' }],
      nextCursor: null,
    },
  };
}
test('periods are exact ordered calendar days; request shapes reject hints and unsupported scopes', () => {
  for (const period of [
    { fromDate: '2024-02-29', toDate: '2024-02-29' },
    { fromDate: '2024-01-01', toDate: '2026-12-31' },
  ])
    assert.equal(isSummaryPeriod(period), true);
  for (const period of [
    undefined,
    {},
    { fromDate: '2023-02-29', toDate: '2024-01-01' },
    { fromDate: '2024-02', toDate: '2024-03-01' },
    { fromDate: '2025-01-01', toDate: '2024-01-01' },
    { fromDate: '2024-01-01', toDate: '2024-01-01', verified: true },
  ])
    assert.equal(isSummaryPeriod(period), false);
  for (const scope of ['patient', 'laboratory', 'manual', 'medication'])
    assert.equal(isGroundedSummaryRequest({ scope, period: null }), true);
  for (const request of [
    { scope: 'diagnosis', period: null },
    { scope: 'patient', period: null, canView: true },
    { scope: 'patient' },
    { scope: ['patient'], period: null },
  ])
    assert.equal(isGroundedSummaryRequest(request), false);
});
test('period summary preserves precision, qualifiers, missing fields and exact source links', () => {
  const input = fixture(),
    before = JSON.stringify(input),
    result = projectGroundedSummary(input);
  assert.ok(result);
  assert.equal(isGroundedSummary(result), true);
  assert.equal(result.laboratory.dated.length, 1);
  assert.equal(result.laboratory.undated.length, 2);
  const m = result.laboratory.dated[0].measurement;
  assert.deepEqual(m.result, {
    kind: 'qualified',
    raw: '<0.123456789012345678901',
    operator: '<',
    decimal: '0.123456789012345678901',
  });
  assert.equal(m.fields.reference, null);
  assert.equal(m.provenance.documentId, documentId);
  assert.equal(m.source.page, 1);
  assert.equal(m.comparability.status, 'unconfirmed');
  assert.equal(JSON.stringify(input), before);
  result.laboratory.dated[0].measurement.fields.analyte = 'UI mutation';
  assert.equal(JSON.stringify(input), before);
});
test('manual period selection uses reported offset calendar day, never recording/UTC replacement', () => {
  const input = fixture(),
    result = projectGroundedSummary(input);
  assert.equal(result.manual.length, 1);
  assert.equal(
    result.manual[0].reading.observedAt,
    '2024-02-29T00:30:00+14:00',
  );
  assert.equal(result.manual[0].reading.values.value, '100.000000000000000001');
  input.request.period = { fromDate: '2024-02-28', toDate: '2024-02-28' };
  const previous = projectGroundedSummary(input);
  assert.equal(previous.manual.length, 0);
  assert.equal(previous.laboratory.undated.length, 2);
  input.request.period = { fromDate: '2026-11-18', toDate: '2026-11-18' };
  assert.equal(projectGroundedSummary(input).manual.length, 0);
});
test('medications remain current record snapshots without historical treatment-period inference', () => {
  const input = fixture();
  input.medications.entries[0].entry.recordedStatus = 'historical';
  const result = projectGroundedSummary(input);
  assert.equal(result.medicationMeaning, 'current-record-snapshot');
  assert.equal(result.medications.length, 1);
  assert.equal(result.medications[0].entry.recordedStatus, 'historical');
  assert.equal(result.medications[0].entry.fields.start, null);
  input.medications.entries[0].sourceState = 'source-review-required';
  assert.deepEqual(projectGroundedSummary(input).medications, []);
  const manual = input.manual.entries[0];
  manual.action = 'withdrawal';
  manual.revision = 2;
  assert.deepEqual(projectGroundedSummary(input).manual, []);
});
test('scope and bounded coverage remain explicit and never imply complete medical history', () => {
  for (const scope of ['patient', 'laboratory', 'manual', 'medication']) {
    const input = fixture();
    input.request = { scope, period: null };
    input.laboratory.measurementsLimited = true;
    input.manual.entries = Array.from({ length: 20 }, (_, i) => ({
      ...input.manual.entries[0],
      readingId: `44444444-4444-4444-8444-${(20 - i).toString(16).padStart(12, '0')}`,
    }));
    input.medications.entries = Array.from({ length: 20 }, (_, i) => ({
      ...input.medications.entries[0],
      entry: {
        ...input.medications.entries[0].entry,
        medicationId: `33333333-3333-4333-8333-${(20 - i).toString(16).padStart(12, '0')}`,
      },
    }));
    input.manual.nextCursor = {
      readingId: input.manual.entries.at(-1).readingId,
      recordedAt: stamp,
    };
    input.medications.nextCursor = {
      medicationId: input.medications.entries.at(-1).entry.medicationId,
      recordedAt: stamp,
    };
    const r = projectGroundedSummary(input);
    assert.ok(r);
    assert.equal(
      r.coverage.laboratoryLimited,
      scope === 'patient' || scope === 'laboratory',
    );
    assert.equal(
      r.coverage.manualLimited,
      scope === 'patient' || scope === 'manual',
    );
    assert.equal(
      r.coverage.medicationsLimited,
      scope === 'patient' || scope === 'medication',
    );
    if (scope !== 'patient' && scope !== 'laboratory')
      assert.deepEqual(r.laboratory, { dated: [], undated: [], sources: [] });
  }
});
test('wrong patient, malformed or substituted source projections fail closed', () => {
  for (const change of [
    (i) => (i.patientId = documentId),
    (i) => (i.manual.patientId = documentId),
    (i) => (i.medications.entries[0].entry.patientId = documentId),
    (i) => (i.laboratory.measurements[0].member.sourceRevision = 99),
    (i) => (i.laboratory.measurements[0].measurement.fields.result = '5'),
    (i) => (i.generatedAt = 'yesterday'),
  ]) {
    const i = fixture();
    change(i);
    assert.equal(projectGroundedSummary(i), null);
  }
  const result = projectGroundedSummary(fixture());
  for (const change of [
    (r) => (r.medications[0].sourceState = 'source-review-required'),
    (r) => (r.manual[0].action = 'withdrawal'),
    (r) => r.laboratory.dated.push(r.laboratory.undated[0]),
    (r) => (r.coverage.extra = true),
    (r) =>
      r.laboratory.sources.push({
        ...r.laboratory.sources[0],
        documentId: medicationId,
      }),
    (r) => (r.trusted = true),
  ]) {
    const r = JSON.parse(JSON.stringify(result));
    change(r);
    assert.equal(isGroundedSummary(r), false);
  }
});
