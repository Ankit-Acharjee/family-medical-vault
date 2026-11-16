import test from 'node:test';
import assert from 'node:assert/strict';
import { isRelatedDocumentsResult } from '@fmv/contracts';
import { matchRelatedHints } from '../dist/documents/related-documents.store.js';
const provider = {
  kind: 'provider',
  value: 'Hôpital São João',
  confidence: 'explicit',
  page: 1,
  excerpt: 'Provider: Hôpital São João',
};
const date = {
  kind: 'date',
  value: '2024-02-29',
  dateRole: 'Report date',
  confidence: 'explicit',
  page: 2,
  excerpt: 'Report date: 2024-02-29',
};
const c = (documentId) => ({
  documentId,
  sourceSha256: 'a'.repeat(64),
  sourceRevision: 1,
  metadataRevision: 1,
  lifecycleVersion: 0,
});
const source = c('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const candidate = c('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const evidence = {
  sourceProvider: provider,
  sourceDate: date,
  candidateProvider: provider,
  candidateDate: date,
};
const valid = {
  source,
  status: 'ready',
  matches: [{ ...candidate, title: 'A report', evidence }],
  limited: false,
};
test('match requires identical explicit provider and valid ISO date and role', () => {
  assert.deepEqual(
    matchRelatedHints([provider, date], [provider, date]),
    evidence,
  );
  for (const other of [
    { ...provider, value: 'Hôpital São João' },
    { ...provider, confidence: 'tentative' },
  ])
    assert.equal(matchRelatedHints([provider, date], [other, date]), null);
  for (const other of [
    { ...date, value: '2023-02-29' },
    { ...date, value: '29/02/2024' },
    { ...date, dateRole: 'Collection date' },
    { ...date, confidence: 'tentative' },
  ])
    assert.equal(matchRelatedHints([provider, date], [provider, other]), null);
});
test('related response validates evidence, identities and bounds', () => {
  assert.equal(isRelatedDocumentsResult(valid), true);
  const match = valid.matches[0];
  for (const value of [
    { ...valid, extra: true },
    { ...valid, source: { ...source, sourceRevision: 0 } },
    {
      ...valid,
      matches: [{ ...match, documentId: source.documentId.toUpperCase() }],
    },
    {
      ...valid,
      matches: [
        match,
        { ...match, documentId: candidate.documentId.toUpperCase() },
      ],
    },
    { ...valid, matches: Array(21).fill(match) },
    { ...valid, status: 'insufficient-hints' },
    { ...valid, matches: [{ ...match, title: '\ud800' }] },
    {
      ...valid,
      matches: [
        {
          ...match,
          evidence: {
            ...evidence,
            candidateDate: { ...date, dateRole: 'Collection date' },
          },
        },
      ],
    },
    {
      ...valid,
      matches: [
        {
          ...match,
          evidence: {
            ...evidence,
            candidateProvider: { ...provider, confidence: 'tentative' },
          },
        },
      ],
    },
  ])
    assert.equal(isRelatedDocumentsResult(value), false);
  assert.equal(
    isRelatedDocumentsResult({
      ...valid,
      status: 'insufficient-hints',
      matches: [],
      limited: false,
    }),
    true,
  );
});
