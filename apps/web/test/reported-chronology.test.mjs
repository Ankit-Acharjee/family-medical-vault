import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import {
  projectConfirmedMeasurements,
  measurementMember,
  projectGroundedSummary,
} from '@fmv/contracts';
const code = ts
  .transpileModule(
    await readFile(
      new URL(
        '../src/features/summaries/reported-chronology.ts',
        import.meta.url,
      ),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  )
  .outputText.replaceAll(
    "'@fmv/contracts'",
    JSON.stringify(import.meta.resolve('@fmv/contracts')),
  );
const { reportedChronology } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);
const patient = '11111111-1111-4111-8111-111111111111',
  stamp = '2026-11-18T00:00:00.000Z',
  sha = 'a'.repeat(64);
function fixture(scope = 'patient') {
  const records = [
    ['2024-02-29', 'mg/dL'],
    ['2024-02-29', 'mmol/L'],
    ['2026-11-17', 'synthetic/unit'],
    ['February 2024', 'synthetic/unit'],
  ].map(([date, unit], i) => {
    const doc = '22222222-2222-4222-8222-' + String(i + 1).padStart(12, '0');
    const fields = {
      analyte: 'SYNTHETIC analyte',
      result: '<0.123456789012345678901',
      unit,
      reference: null,
      specimen: null,
      method: null,
      date,
      laboratory: null,
    };
    const source = {
      id: 'page-1-block-0',
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
    const [measurement] = projectConfirmedMeasurements(patient, doc, {
      context: {
        sourceRevision: 1,
        sourceSha256: sha,
        lifecycleVersion: 0,
        revision: 1,
        canVerify: false,
      },
      candidates: [],
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
        items: [{ source, fields }],
      },
    });
    assert.ok(measurement);
    return {
      row: {
        member: measurementMember(measurement),
        title: 'SYNTHETIC report ' + i,
        measurement,
      },
      source: {
        documentId: doc,
        title: 'SYNTHETIC report ' + i,
        bytes: 10,
        mimeType: 'application/pdf',
      },
    };
  });
  const medications = {
    patientId: patient,
    canWrite: false,
    entries: [
      {
        sourceState: 'current-source',
        entry: {
          medicationId: '33333333-3333-4333-8333-333333333333',
          patientId: patient,
          revision: 1,
          action: 'reconciliation',
          recordedAt: stamp,
          meaning: 'owner-recorded-medication-context',
          recordedStatus: 'historical',
          source: {
            documentId: records[0].source.documentId,
            candidateId: 'page-1-medication-0',
            sourceRevision: 1,
            sourceSha256: sha,
            lifecycleVersion: 0,
            reviewRevision: 1,
          },
          fields: {
            medication: 'SYNTHETIC medication',
            strength: null,
            dose: null,
            frequency: null,
            route: null,
            duration: null,
            start: '2024-02-29',
            end: '2024-03-01',
            instructions: null,
          },
        },
      },
    ],
    nextCursor: null,
  };
  const result = projectGroundedSummary({
    patientId: patient,
    generatedAt: stamp,
    request: { scope, period: null },
    laboratory: {
      patientId: patient,
      canConfirm: false,
      measurements: records.map((r) => r.row),
      measurementsLimited: false,
      sources: records.map((r) => r.source),
      comparisons: [],
      comparisonsLimited: false,
    },
    manual: {
      patientId: patient,
      canWrite: false,
      entries: [
        {
          readingId: '44444444-4444-4444-8444-444444444444',
          patientId: patient,
          revision: 1,
          action: 'record',
          provenance: 'manual',
          recordedAt: stamp,
          reading: {
            kind: 'glucose',
            unit: 'mg/dL',
            observedAt: '2024-02-29T23:30:00-12:00',
            values: { value: '100.00000000000001' },
          },
        },
      ],
      nextCursor: null,
    },
    medications,
  });
  assert.ok(result);
  return result;
}
test('calendar buckets sort newest first and retain different sources, units and provenance separately', () => {
  const value = fixture(),
    before = JSON.stringify(value),
    result = reportedChronology(value);
  assert.deepEqual(
    result.days.map((d) => d.date),
    ['2026-11-17', '2024-02-29'],
  );
  const day = result.days[1];
  assert.equal(day.observations.length, 3);
  assert.equal(new Set(day.observations.map((r) => r.key)).size, 3);
  assert.deepEqual(
    day.observations
      .filter((r) => r.kind === 'laboratory')
      .map((r) => r.value.measurement.fields.unit),
    ['mg/dL', 'mmol/L'],
  );
  for (const row of day.observations.filter((r) => r.kind === 'laboratory')) {
    assert.equal(row.value.measurement.comparability.status, 'unconfirmed');
    assert.equal(row.value.measurement.result.raw, '<0.123456789012345678901');
  }
  assert.equal(JSON.stringify(value), before);
});
test('reported manual date and offset remain literal instead of moving to the UTC calendar day', () => {
  const result = reportedChronology(fixture());
  const row = result.days
    .find((d) => d.date === '2024-02-29')
    .observations.find((r) => r.kind === 'manual');
  assert.equal(row.value.reading.observedAt, '2024-02-29T23:30:00-12:00');
  assert.equal(row.value.reading.values.value, '100.00000000000001');
  assert.equal(
    result.days.some((d) => d.date === '2024-03-01'),
    false,
  );
});
test('imprecise dates stay outside calendar positions and generated/review dates supply no fallback', () => {
  const result = reportedChronology(fixture());
  assert.equal(result.undated.length, 1);
  assert.equal(result.undated[0].measurement.fields.date, 'February 2024');
  assert.equal(
    result.days.some((d) => d.date === '2026-11-18'),
    false,
  );
  assert.equal(
    result.days.some((d) =>
      d.observations.some(
        (r) =>
          r.kind === 'laboratory' &&
          r.value.measurement.fields.date === 'February 2024',
      ),
    ),
    false,
  );
});
test('medication treatment labels never create chronology events and scope remains bounded', () => {
  const meds = reportedChronology(fixture('medication'));
  assert.deepEqual(meds, { days: [], undated: [] });
  assert.equal(
    reportedChronology(fixture('manual')).days[0].observations.every(
      (r) => r.kind === 'manual',
    ),
    true,
  );
  assert.equal(
    reportedChronology(fixture('laboratory')).days.every((d) =>
      d.observations.every((r) => r.kind === 'laboratory'),
    ),
    true,
  );
});
test('source identity orders ties deterministically without mutating or merging records', () => {
  const value = fixture(),
    first = reportedChronology(value);
  value.laboratory.dated.reverse();
  const before = JSON.stringify(value),
    second = reportedChronology(value);
  assert.deepEqual(
    first.days.map((d) => d.observations.map((r) => r.key)),
    second.days.map((d) => d.observations.map((r) => r.key)),
  );
  assert.equal(JSON.stringify(value), before);
});
test('malformed, wrong-patient, stale or duplicate summary observations fail closed', () => {
  for (const change of [
    (v) => (v.manual[0].patientId = '22222222-2222-4222-8222-222222222222'),
    (v) =>
      (v.laboratory.dated[0].measurement.collectionDate.isoDate = '2023-02-29'),
    (v) => v.laboratory.dated.push(v.laboratory.dated[0]),
    (v) => (v.medications[0].sourceState = 'source-review-required'),
  ]) {
    const value = fixture();
    change(value);
    assert.equal(reportedChronology(value), null);
  }
});
