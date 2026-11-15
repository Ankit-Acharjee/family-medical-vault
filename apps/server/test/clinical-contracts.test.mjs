import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  extractLabFields,
  isLabFieldCandidate,
  isSaveClinicalReview,
  isWithdrawClinicalReview,
  isClinicalReviewResult,
} from '@fmv/contracts';
const fields = {
  analyte: 'Synthetic test',
  result: '<5.4',
  unit: 'synthetic/unit',
  reference: null,
  specimen: null,
  method: null,
  date: null,
  laboratory: null,
};
const source = () =>
  extractLabFields([
    {
      page: 1,
      text: 'Test: Synthetic test\nResult: <5.4\nUnit: synthetic/unit',
    },
  ])[0];
const context = {
  sourceRevision: 1,
  sourceSha256: 'a'.repeat(64),
  lifecycleVersion: 0,
  revision: 0,
  canVerify: true,
};
const input = () => ({
  requestId: randomUUID(),
  expectedRevision: 0,
  sourceRevision: 1,
  sourceSha256: context.sourceSha256,
  lifecycleVersion: 0,
  confirmed: true,
  selections: [{ candidateId: source().id, fields }],
});
test('synthetic parser vectors abstain conservatively and preserve evidence', async () => {
  const vectors = JSON.parse(
    await readFile(
      new URL('./support/lab-field-vectors.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(vectors.length, 8);
  for (const v of vectors) {
    const found = extractLabFields(v.pages, v.options);
    assert.equal(found.length, v.expectedCount, v.name);
    assert.ok(found.every(isLabFieldCandidate));
    for (const c of found) {
      assert.equal(c.confidence, 'unrated');
      assert.equal(c.unverified, true);
      for (const f of Object.values(c.fields).filter(Boolean)) {
        assert.ok(
          v.pages.find((p) => p.page === c.page).text.includes(f.excerpt),
        );
        assert.ok(f.excerpt.includes(f.value));
      }
    }
  }
});
test('blank/duplicate/prose, unsupported layouts and oversized input cannot fabricate fields', () => {
  for (const text of [
    'Test: \nResult: 1',
    'Test: Test\nResult:  ',
    'Test: X\nResult: 1\nDiagnosis: Y',
    'Test: X\nResult: 1\nUnit: a\nUnits: b',
    'Hb 13.5 g/dL',
  ])
    assert.deepEqual(extractLabFields([{ page: 1, text }]), []);
  assert.deepEqual(
    extractLabFields([{ page: 1, text: 'x'.repeat(500001) }]),
    [],
  );
  assert.deepEqual(
    extractLabFields([{ page: 1, text: 'Test: X\nResult: 1\u0000' }]),
    [],
  );
  assert.deepEqual(
    extractLabFields([{ page: 1, text: 'Test: X\nResult: \ud800' }]),
    [],
  );
  const text = Array.from({ length: 21 }, () => 'Test: X\nResult: 1\n').join(
    '\n',
  );
  assert.equal(extractLabFields([{ page: 1, text }]).length, 20);
});
test('only final page final line is dropped after character truncation, without losing earlier complete blocks', () => {
  const pages = [
    { page: 1, text: 'Test: Earlier\nResult: 1' },
    { page: 2, text: 'Test: Incomplete\nResult: 2' },
  ];
  const result = extractLabFields(pages, { truncatedFinalLine: true });
  assert.equal(result.length, 1);
  assert.equal(result[0].fields.analyte.value, 'Earlier');
  const unicode = extractLabFields([
    {
      page: 7,
      text: 'Test: Ω\nResult: <0.5\nUnit: μg/L\nCollection date: 03/04/2026',
    },
  ])[0];
  assert.equal(unicode.fields.result.value, '<0.5');
  assert.equal(unicode.fields.date.value, '03/04/2026');
  assert.equal(unicode.fields.unit.value, 'μg/L');
});
test('clinical confirmation is strict, bounded and explicit; no user source evidence or verification authority accepted', () => {
  assert.equal(isSaveClinicalReview(input()), true);
  for (const bad of [
    { confirmed: false },
    { confirmed: 'true' },
    { selections: [] },
    { canVerify: true },
    { sourceRevision: 0 },
    { selections: [{ ...input().selections[0], source: source() }] },
    {
      selections: [
        { candidateId: source().id, fields: { ...fields, result: ' ' } },
      ],
    },
    {
      selections: [
        {
          candidateId: source().id,
          fields: { ...fields, unit: 'x'.repeat(121) },
        },
      ],
    },
  ])
    assert.equal(isSaveClinicalReview({ ...input(), ...bad }), false);
  const s = input().selections[0];
  assert.equal(isSaveClinicalReview({ ...input(), selections: [s, s] }), false);
});
test('verified results require actual owner snapshot shape and preserve older source provenance', () => {
  const snapshot = {
    action: 'confirmation',
    withdrawnItems: [],
    revision: 1,
    sourceRevision: 1,
    sourceSha256: context.sourceSha256,
    verifiedAt: '2026-11-14T00:00:00.000Z',
    ruleVersion: 'labeled-lab-blocks-v1',
    extraction: {
      method: 'pdf-text',
      engineVersion: 'pdfjs-6.5.438',
      partial: false,
      partialReason: null,
      downsized: false,
    },
    items: [{ source: source(), fields }],
    verified: true,
  };
  assert.equal(
    isClinicalReviewResult({
      context: { ...context, revision: 1, sourceRevision: 2 },
      candidates: [source()],
      snapshot,
    }),
    true,
  );
  assert.equal(
    isClinicalReviewResult({ context, candidates: [source()], snapshot: null }),
    true,
  );
  for (const changed of [
    { verified: false },
    { sourceSha256: 'b'.repeat(64) },
    { items: [] },
    { verifiedAt: '2026-02-31T00:00:00.000Z' },
  ])
    assert.equal(
      isClinicalReviewResult({
        context: { ...context, revision: 1 },
        candidates: [source()],
        snapshot: { ...snapshot, ...changed },
      }),
      false,
    );
  const wrong = { ...source(), page: 2 };
  assert.equal(isLabFieldCandidate(wrong), false);
});

test('withdrawal input requires explicit owner intent and no client-supplied clinical evidence', () => {
  const value = {
    requestId: randomUUID(),
    expectedRevision: 1,
    sourceSha256: context.sourceSha256,
    lifecycleVersion: 2,
    confirmed: true,
    candidateIds: [source().id],
  };
  assert.equal(isWithdrawClinicalReview(value), true);
  for (const patch of [
    { confirmed: false },
    { candidateIds: [] },
    { candidateIds: [source().id, source().id] },
    { candidateIds: ['not-a-source-id'] },
    { candidateIds: Array(21).fill(source().id) },
    { expectedRevision: 0 },
    { lifecycleVersion: -1 },
    { sourceSha256: 'a'.repeat(64) + '\n' },
    { actorAccountId: randomUUID() },
    { fields },
    { verified: true },
  ])
    assert.equal(isWithdrawClinicalReview({ ...value, ...patch }), false);
});
test('withdrawing the last confirmed entry leaves no verified active facts while retaining evidence', () => {
  const snapshot = {
    action: 'withdrawal',
    withdrawnItems: [{ source: source(), fields }],
    items: [],
    revision: 1,
    sourceRevision: 1,
    sourceSha256: context.sourceSha256,
    verifiedAt: '2026-11-15T00:00:00.000Z',
    ruleVersion: 'labeled-lab-blocks-v1',
    verified: false,
    extraction: {
      method: 'pdf-text',
      engineVersion: 'pdfjs-6.5.438',
      partial: false,
      partialReason: null,
      downsized: false,
    },
  };
  const result = {
    context: { ...context, revision: 1, sourceRevision: 2 },
    candidates: [],
    snapshot,
  };
  assert.equal(isClinicalReviewResult(result), true);
  for (const patch of [
    { verified: true },
    { action: 'confirmation' },
    { withdrawnItems: [] },
    { items: snapshot.withdrawnItems, verified: true },
  ])
    assert.equal(
      isClinicalReviewResult({
        ...result,
        snapshot: { ...snapshot, ...patch },
      }),
      false,
    );
});
