import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  isDocumentSearchInput,
  isDocumentSearchResult,
  maximumDocumentSearchHits,
  maximumDocumentSearchQueryLength,
} from '@fmv/contracts';

test('saved-text search accepts only its strict JSON input envelope', () => {
  assert.equal(maximumDocumentSearchQueryLength, 200);
  for (const input of [
    { query: 'synthetic' },
    { query: '  synthetic term\n' },
    { query: '!!!' },
    { query: '合成 😀' },
    { query: 'synthetic', categoryId: randomUUID() },
    {
      query: 'synthetic',
      categoryId: randomUUID(),
      uploadedFrom: '2026-11-01T00:00:00.000Z',
      uploadedBefore: '2026-12-01T00:00:00.000Z',
    },
  ])
    assert.equal(isDocumentSearchInput(input), true, JSON.stringify(input));
  for (const input of [
    null,
    [],
    'synthetic',
    {},
    { query: null },
    { query: 1 },
    { query: '' },
    { query: '\t \n' },
    { query: 'synthetic', documentId: randomUUID() },
    { query: 'synthetic', patientId: randomUUID() },
    { query: 'synthetic', limit: 201 },
    { query: 'synthetic', categoryId: 'invalid' },
    { query: 'synthetic', categoryId: null },
    { query: 'synthetic', categoryId: undefined },
  ])
    assert.equal(isDocumentSearchInput(input), false, JSON.stringify(input));
});

test('query bounds use trimmed UTF-16 units and reject NUL or ill-formed Unicode', () => {
  for (const query of [
    'x'.repeat(200),
    '😀'.repeat(100),
    `  ${'x'.repeat(200)}\n`,
    `  ${'😀'.repeat(100)}  `,
  ])
    assert.equal(isDocumentSearchInput({ query }), true);
  for (const query of [
    'x'.repeat(201),
    '😀'.repeat(100) + 'x',
    '😀'.repeat(101),
    'synthetic\u0000term',
    '\u0000synthetic',
    '\ud800',
    '\udc00',
    'synthetic\ud800',
    '\ud800synthetic',
    '\ud800\ud800\udc00',
  ])
    assert.equal(
      isDocumentSearchInput({ query }),
      false,
      JSON.stringify(query),
    );
});

test('upload bounds require valid canonical UTC instants and a nonempty forward range', () => {
  const start = '2026-11-01T00:00:00.000Z';
  const end = '2026-11-02T00:00:00.000Z';
  for (const field of ['uploadedFrom', 'uploadedBefore']) {
    assert.equal(isDocumentSearchInput({ query: 'x', [field]: start }), true);
    for (const value of [
      null,
      undefined,
      0,
      '',
      '2026-11-01',
      '2026-11-01T00:00:00Z',
      '2026-11-01T00:00:00.00Z',
      '2026-11-01T00:00:00.000+00:00',
      '2026-11-01T05:30:00.000+05:30',
      '2026-02-30T00:00:00.000Z',
      '2026-11-01T24:00:00.000Z',
      '2026-11-01T00:00:60.000Z',
      'invalid',
    ])
      assert.equal(
        isDocumentSearchInput({ query: 'x', [field]: value }),
        false,
        `${field}: ${JSON.stringify(value)}`,
      );
  }
  assert.equal(
    isDocumentSearchInput({
      query: 'x',
      uploadedFrom: start,
      uploadedBefore: end,
    }),
    true,
  );
  for (const uploadedBefore of [start, '2026-10-31T23:59:59.999Z'])
    assert.equal(
      isDocumentSearchInput({
        query: 'x',
        uploadedFrom: start,
        uploadedBefore,
      }),
      false,
    );
});

test('search results expose only up to 200 unique opaque document IDs and truncation', () => {
  assert.equal(maximumDocumentSearchHits, 200);
  const documentIds = Array.from({ length: 200 }, () => randomUUID());
  for (const result of [
    { documentIds: [], truncated: false },
    { documentIds: [randomUUID()], truncated: false },
    { documentIds, truncated: false },
    { documentIds, truncated: true },
  ])
    assert.equal(isDocumentSearchResult(result), true);
  const id = 'abcdef01-0000-4000-8000-000000000001';
  for (const result of [
    null,
    [],
    {},
    { documentIds },
    { documentIds: [], truncated: 0 },
    { documentIds: [randomUUID(), 'bad'], truncated: false },
    { documentIds: [null], truncated: false },
    { documentIds: [...documentIds, randomUUID()], truncated: true },
    { documentIds: [id, id], truncated: false },
    { documentIds: [id, id.toUpperCase()], truncated: false },
    { documentIds: [], truncated: false, total: 0 },
    { documentIds: [], truncated: false, query: 'private synthetic term' },
    { documentIds: [], truncated: false, snippets: [] },
  ])
    assert.equal(isDocumentSearchResult(result), false, JSON.stringify(result));
});

// Generic GLM interface-only vectors, independently reviewed. Corrected the
// worker's overlength count and escaped surrogate to exercise actual bounds.
test('reviewed external interface-only search validation vectors', () => {
  const vectors = JSON.parse(
    readFileSync(
      new URL('./support/search-vectors.json', import.meta.url),
      'utf8',
    ),
  );
  for (const vector of vectors)
    assert.equal(isDocumentSearchInput(vector.input), vector.valid);
});
