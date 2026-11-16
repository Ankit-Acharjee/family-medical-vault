import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  isExtractionResult,
  isSaveExtraction,
  isExtractionReadResult,
  extractLabFields,
  extractDiagnosisFields,
  extractMedicationFields,
} from '@fmv/contracts';
import { rangeResult, rangeVectors } from './support/pdf-pages-ocr-vectors.mjs';

for (const { name, result, valid } of rangeVectors())
  test(`selected-page range contract: ${name}`, () =>
    assert.equal(isExtractionResult(result), valid));

test('range saves retain exact source and unverified envelope', () => {
  const context = {
    sourceSha256: 'a'.repeat(64),
    lifecycleVersion: 2,
    revision: 3,
    canSave: true,
  };
  const result = rangeResult();
  assert.equal(
    isSaveExtraction({
      requestId: randomUUID(),
      expectedRevision: 3,
      lifecycleVersion: 2,
      sourceSha256: context.sourceSha256,
      result,
    }),
    true,
  );
  const value = {
    context,
    snapshot: {
      ...result,
      sourceSha256: context.sourceSha256,
      revision: 3,
      savedAt: '2026-11-16T00:00:00.000Z',
      unverified: true,
    },
  };
  assert.equal(isExtractionReadResult(value), true);
  assert.equal(
    isExtractionReadResult({
      ...value,
      snapshot: { ...value.snapshot, unverified: false },
    }),
    false,
  );
  assert.equal(
    isExtractionReadResult({
      ...value,
      snapshot: { ...value.snapshot, sourceSha256: 'b'.repeat(64) },
    }),
    false,
  );
});

test('range text rejects malformed Unicode and sparse pages', () => {
  for (const text of ['\u0000', '\ud800', '\udc00', 'prefix\ud800suffix'])
    assert.equal(
      isExtractionResult(rangeResult({ pages: [{ page: 1, text }] })),
      false,
    );
  assert.equal(isExtractionResult(rangeResult({ pages: new Array(2) })), false);
});

test('range character truncation drops only final-page trailing source line', () => {
  for (const [extract, text, field] of [
    [extractDiagnosisFields, 'Diagnosis: SYNTHETIC literal', 'field'],
    [extractMedicationFields, 'Medication: SYNTHETIC literal', 'fields'],
    [extractLabFields, 'Test: SYNTHETIC literal\nResult: literal', 'fields'],
  ]) {
    const pages = [
      { page: 7, text },
      { page: 8, text },
    ];
    const values = extract(pages, { truncatedFinalLine: true });
    assert.equal(values.filter((v) => v.page === 7).length, 1);
    assert.equal(values.filter((v) => v.page === 8).length, 0);
    assert.ok(values[0][field]);
    assert.equal(extract(pages).length, 2);
  }
});
