import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import {
  classifyMeasurementDate,
  classifyMeasurementResult,
  measurementMember,
} from '@fmv/contracts';
const source = await readFile(
  new URL('../src/features/measurements/trendPlot.ts', import.meta.url),
  'utf8',
);
const compiled = ts
  .transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  .outputText.replaceAll(
    "'@fmv/contracts'",
    JSON.stringify(import.meta.resolve('@fmv/contracts')),
  );
const { projectTrend } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);
const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
function measurement(i, result, date = '2026-11-16') {
  const fields = {
    analyte: 'Synthetic marker',
    result,
    unit: 'synthetic/unit',
    date,
    reference: i ? '2–4' : '1–3',
    method: null,
    specimen: null,
    laboratory: null,
  };
  return {
    fields,
    source: {
      id: 'page-1-block-0',
      page: 1,
      unverified: true,
      confidence: 'unrated',
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [
          k,
          v === null ? null : { value: v, excerpt: `${k}: ${v}` },
        ]),
      ),
    },
    provenance: {
      patientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      documentId: ids[i],
      reviewRevision: 1,
      sourceRevision: 1,
      sourceSha256: 'a'.repeat(64),
      lifecycleVersion: 0,
      verifiedAt: '2026-11-16T00:00:00.000Z',
    },
    result: classifyMeasurementResult(result),
    collectionDate: classifyMeasurementDate(date),
    comparability: { status: 'unconfirmed' },
  };
}
function set(values) {
  return {
    setId: ids[0],
    revision: 1,
    status: 'current',
    canConfirm: false,
    members: values.map(measurementMember),
    measurements: values,
  };
}
test('exact decimal scaling retains precision beyond Number and does not mutate clinical fields', () => {
  const input = set([
    measurement(0, '9007199254740993', '2026-11-15'),
    measurement(1, '9007199254740994', '2026-11-16'),
  ]);
  const before = JSON.stringify(input),
    plot = projectTrend(input);
  assert.equal(plot.domain.minimum, '9007199254740993');
  assert.equal(plot.domain.maximum, '9007199254740994');
  assert.deepEqual(
    plot.points.map((p) => [p.x, p.y]),
    [
      [0, 1],
      [1, 0],
    ],
  );
  assert.equal(JSON.stringify(input), before);
  const tiny = projectTrend(
    set([
      measurement(0, '0.00000000000000000000000000001'),
      measurement(1, '0.00000000000000000000000000002'),
    ]),
  );
  assert.deepEqual(
    tiny.points.map((p) => p.y),
    [1, 0],
  );
});
test('negative extremes, fractional signs and identical observations are finite and exact', () => {
  for (const [a, b] of [
    ['-' + '9'.repeat(115), '9'.repeat(115)],
    ['-.00001', '+.00002'],
    ['-0', '+0.00'],
    ['1.2300', '1.23'],
  ]) {
    const plot = projectTrend(set([measurement(0, a), measurement(1, b)]));
    assert.ok(
      plot.points.every(
        (p) =>
          Number.isFinite(p.x) &&
          Number.isFinite(p.y) &&
          p.x >= 0 &&
          p.x <= 1 &&
          p.y >= 0 &&
          p.y <= 1,
      ),
    );
    assert.deepEqual(
      plot.points.map((p) => p.measurement.fields.result),
      [a, b],
    );
    if (a === '-0' || a === '1.2300')
      assert.deepEqual(
        plot.points.map((p) => [p.x, p.y]),
        [
          [0.5, 0.5],
          [0.5, 0.5],
        ],
      );
  }
});
test('dates order lexically as exact calendar days, duplicate days and per-source ranges remain distinct', () => {
  const plot = projectTrend(
    set([measurement(0, '1', '2026-11-16'), measurement(1, '2', '2026-11-01')]),
  );
  assert.equal(plot.domain.firstDay, '2026-11-01');
  assert.equal(plot.points[0].measurement.fields.result, '2');
  assert.deepEqual(
    plot.points.map((p) => p.measurement.fields.reference),
    ['2–4', '1–3'],
  );
  assert.deepEqual(
    projectTrend(set([measurement(0, '1'), measurement(1, '2')])).points.map(
      (p) => p.x,
    ),
    [0.5, 0.5],
  );
});
test('qualified, textual and imprecise dates are never numeric chart points', () => {
  for (const [value, date, reason] of [
    ['< 5', '2026-11-16', 'Qualified limit'],
    ['positive', '2026-11-16', 'Non-numeric'],
    ['3', null, 'Exact collection day unavailable'],
    ['3', '16/11/2026', 'Exact collection day unavailable'],
    ['3', '2026-02-30', 'Exact collection day unavailable'],
  ]) {
    const m = measurement(0, value, date),
      plot = projectTrend(set([m, measurement(1, '2')]));
    assert.equal(plot.points.length, 1);
    assert.ok(plot.excluded[0].reason.includes(reason));
    assert.deepEqual(plot.excluded[0].measurement, m);
  }
  const none = projectTrend(
    set([measurement(0, '<5'), measurement(1, 'positive')]),
  );
  assert.equal(none.domain, null);
  assert.deepEqual(none.points, []);
});
test('withdrawn, stale, mismatched and unconfirmed data never produce trusted chart projections', () => {
  const input = set([measurement(0, '1'), measurement(1, '2')]);
  for (const v of [
    null,
    {},
    { ...input, status: 'invalid', measurements: [] },
    { ...input, status: 'withdrawn', measurements: [] },
    { ...input, revision: 0 },
    {
      ...input,
      members: [{ ...input.members[0], sourceRevision: 2 }, input.members[1]],
    },
  ])
    assert.equal(projectTrend(v), null);
  for (const [field, value] of [
    ['unit', 'other-unit'],
    ['analyte', 'Different test'],
    ['method', 'B'],
    ['specimen', 'B'],
  ]) {
    const changed = globalThis.structuredClone(input);
    changed.measurements[0].fields.method = 'A';
    changed.measurements[0].fields.specimen = 'A';
    changed.measurements[1].fields[field] = value;
    assert.equal(projectTrend(changed), null);
  }
});
