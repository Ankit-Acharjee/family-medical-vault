import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clinicalHistoryCursor,
  isClinicalHistoryResult,
  extractLabFields,
} from '@fmv/contracts';
const source = extractLabFields([
  { page: 1, text: 'Test: Synthetic history\nResult: literal' },
])[0];
const context = {
  sourceRevision: 3,
  sourceSha256: 'a'.repeat(64),
  lifecycleVersion: 2,
  revision: 4,
  canVerify: false,
};
const snapshot = {
  revision: 2,
  sourceRevision: 1,
  sourceSha256: context.sourceSha256,
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
  items: [
    {
      source,
      fields: Object.fromEntries(
        Object.entries(source.fields).map(([k, v]) => [k, v?.value ?? null]),
      ),
    },
  ],
};
test('history cursors are canonical positive int32 values only', () => {
  assert.equal(clinicalHistoryCursor('1'), 1);
  assert.equal(clinicalHistoryCursor('2147483647'), 2147483647);
  for (const value of [
    0,
    1,
    null,
    undefined,
    [],
    {},
    '',
    '0',
    '01',
    '-1',
    '1.0',
    ' 1',
    '1\n',
    '2147483648',
    '99999999999',
  ])
    assert.equal(clinicalHistoryCursor(value), null);
});
test('history validates old source provenance independently of current revision without weakening exact shapes', () => {
  const value = { context, snapshot, nextBefore: 2 };
  assert.equal(isClinicalHistoryResult(value), true);
  assert.equal(isClinicalHistoryResult({ ...value, nextBefore: null }), true);
  assert.equal(
    isClinicalHistoryResult({ ...value, snapshot: null, nextBefore: null }),
    true,
  );
  for (const bad of [
    { ...value, nextBefore: 3 },
    { ...value, snapshot: null },
    { ...value, extra: true },
    { ...value, context: { ...context, revision: 1 } },
    { ...value, context: { ...context, extra: true } },
    { ...value, snapshot: { ...snapshot, sourceRevision: 4 } },
    { ...value, snapshot: { ...snapshot, sourceSha256: 'b'.repeat(64) } },
    { ...value, snapshot: { ...snapshot, verified: false } },
  ])
    assert.equal(isClinicalHistoryResult(bad), false);
});
