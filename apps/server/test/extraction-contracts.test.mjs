import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import {
  isExtractionResult,
  isExtractionContext,
  isExtractionReadResult,
  isSaveExtraction,
  isSaveExtractionResult,
} from '@fmv/contracts';
const vectors = JSON.parse(
  await readFile(
    new URL('./support/extraction-vectors.json', import.meta.url),
    'utf8',
  ),
);
for (const { name, result, valid } of vectors)
  test(`synthetic contract: ${name}`, () =>
    assert.equal(isExtractionResult(result), valid));
const result = {
  method: 'pdf-text',
  engineVersion: 'pdfjs-6.5.438',
  pages: [{ page: 1, text: 'Synthetic source' }],
  partial: false,
  partialReason: null,
  downsized: false,
};
const context = {
  sourceSha256: 'a'.repeat(64),
  lifecycleVersion: 0,
  revision: 0,
  canSave: true,
};
test('request and response envelopes reject unexpected authority, versions and source metadata', () => {
  const input = {
    requestId: randomUUID(),
    expectedRevision: 0,
    lifecycleVersion: 0,
    sourceSha256: context.sourceSha256,
    result,
  };
  assert.equal(isSaveExtraction(input), true);
  for (const value of [
    { ...input, verified: true },
    { ...input, expectedRevision: NaN },
    { ...input, lifecycleVersion: 2147483648 },
    { ...input, sourceSha256: 'A'.repeat(64) },
    { ...input, requestId: 'bad' },
  ])
    assert.equal(isSaveExtraction(value), false);
  assert.equal(isExtractionContext(context), true);
  assert.equal(
    isExtractionContext({ ...context, patientId: 'spoofed' }),
    false,
  );
  assert.equal(isExtractionReadResult({ context, snapshot: null }), true);
  assert.equal(
    isExtractionReadResult({
      context: { ...context, revision: 1 },
      snapshot: null,
    }),
    false,
  );
  const snapshot = {
    ...result,
    revision: 1,
    sourceSha256: context.sourceSha256,
    savedAt: '2026-11-13T00:00:00.000Z',
    unverified: true,
  };
  assert.equal(
    isExtractionReadResult({ context: { ...context, revision: 1 }, snapshot }),
    true,
  );
  assert.equal(
    isExtractionReadResult({
      context: { ...context, revision: 1 },
      snapshot: { ...snapshot, unverified: false },
    }),
    false,
  );
  assert.equal(
    isExtractionReadResult({
      context: { ...context, revision: 1 },
      snapshot: { ...snapshot, sourceSha256: 'b'.repeat(64) },
    }),
    false,
  );
  assert.equal(isSaveExtractionResult({ saved: true, revision: 1 }), true);
  assert.equal(isSaveExtractionResult({ saved: true, revision: 0 }), false);
});
test('UTF16 bounds, well-formed text and partial provenance agree across methods', () => {
  for (const text of ['\ud800', '\udc00', 'a\u0000b'])
    assert.equal(
      isExtractionResult({ ...result, pages: [{ page: 1, text }] }),
      false,
    );
  assert.equal(
    isExtractionResult({
      ...result,
      pages: [{ page: 1, text: '😀'.repeat(250000) }],
    }),
    true,
  );
  assert.equal(
    isExtractionResult({
      ...result,
      pages: [{ page: 1, text: '😀'.repeat(250001) }],
    }),
    false,
  );
  assert.equal(
    isExtractionResult({
      ...result,
      pages: [{ page: 1, text: 'x'.repeat(500000) }],
    }),
    true,
  );
  const ocr = {
    method: 'image-ocr',
    engineVersion: 'tesseract-7.0.0+eng-1.0.0',
    pages: [{ page: 1, text: 'x'.repeat(100001) }],
    partial: false,
    partialReason: null,
    downsized: false,
  };
  assert.equal(isExtractionResult(ocr), false);
  assert.equal(
    isExtractionResult({ ...ocr, pages: [{ page: 1, text: 'valid' }] }),
    true,
  );
  const pages = Array.from({ length: 50 }, (_, i) => ({
    page: i + 1,
    text: i ? '' : 'Synthetic text',
  }));
  assert.equal(
    isExtractionResult({
      ...result,
      pages,
      partial: true,
      partialReason: 'pages',
    }),
    true,
  );
  assert.equal(
    isExtractionResult({
      ...result,
      pages: pages.slice(0, 49),
      partial: true,
      partialReason: 'pages',
    }),
    false,
  );
});
