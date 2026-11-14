import assert from 'node:assert/strict';
import test from 'node:test';
import {
  metadataSuggestionRuleVersion,
  suggestMetadata,
  isMetadataSuggestion,
  isMetadataSuggestionsContext,
  isSavedMetadataSuggestions,
  isMetadataSuggestionsReadResult,
  isSaveMetadataSuggestions,
  isSaveMetadataSuggestionsResult,
} from '@fmv/contracts';

const sha = 'a'.repeat(64);
const request = {
  requestId: '12345678-1234-4123-8123-123456789abc',
  expectedRevision: 0,
  sourceRevision: 1,
  sourceSha256: sha,
  lifecycleVersion: 0,
  ruleVersion: metadataSuggestionRuleVersion,
};
const context = {
  sourceRevision: 1,
  sourceSha256: sha,
  lifecycleVersion: 0,
  revision: 1,
  canSave: true,
};
const suggestion = {
  kind: 'provider',
  value: 'Hôpital São João',
  confidence: 'explicit',
  page: 3,
  excerpt: 'Provider: Hôpital São João',
};
const snapshot = {
  revision: 1,
  sourceRevision: 1,
  sourceSha256: sha,
  ruleVersion: metadataSuggestionRuleVersion,
  suggestions: [suggestion],
  savedAt: '2026-11-14T12:00:00.000Z',
  unverified: true,
};

test('metadata save accepts only versioned source references, never client-provided suggestions', () => {
  assert.equal(isSaveMetadataSuggestions(Object.freeze(request)), true);
  for (const value of [
    null,
    [],
    {},
    { ...request, suggestions: [suggestion] },
    { ...request, patientId: 'spoofed' },
    { ...request, verified: true },
    { ...request, requestId: 'invalid' },
    { ...request, sourceSha256: 'A'.repeat(64) },
    { ...request, sourceSha256: 'a'.repeat(63) },
    { ...request, ruleVersion: 'explicit-lines-v2' },
    { ...request, sourceRevision: 0 },
  ])
    assert.equal(isSaveMetadataSuggestions(value), false);
  for (const field of Object.keys(request)) {
    const missing = { ...request };
    delete missing[field];
    assert.equal(isSaveMetadataSuggestions(missing), false, `missing ${field}`);
  }
  for (const field of [
    'expectedRevision',
    'sourceRevision',
    'lifecycleVersion',
  ]) {
    for (const invalid of [-1, 1.5, NaN, Infinity, '1', 2_147_483_648]) {
      assert.equal(
        isSaveMetadataSuggestions({ ...request, [field]: invalid }),
        false,
        field,
      );
    }
    assert.equal(
      isSaveMetadataSuggestions({ ...request, [field]: 2_147_483_647 }),
      true,
    );
  }
});

test('read context permits absent source and stale snapshots without resetting write revision', () => {
  assert.equal(isMetadataSuggestionsContext(context), true);
  assert.equal(
    isMetadataSuggestionsReadResult({ context, snapshot: null }),
    true,
  );
  assert.equal(
    isMetadataSuggestionsReadResult({
      context: { ...context, sourceRevision: 0, revision: 0, canSave: false },
      snapshot: null,
    }),
    true,
  );
  assert.equal(
    isMetadataSuggestionsReadResult({
      context: { ...context, sourceRevision: 2, revision: 7 },
      snapshot: null,
    }),
    true,
  );
  for (const invalid of [
    { ...context, canSave: 'true' },
    { ...context, sourceRevision: -1 },
    { ...context, revision: 2_147_483_648 },
    { ...context, lifecycleVersion: -1 },
    { ...context, sourceSha256: 'b'.repeat(63) },
    { ...context, canEdit: true },
  ])
    assert.equal(isMetadataSuggestionsContext(invalid), false);
  assert.equal(
    isMetadataSuggestionsReadResult({ context, snapshot: null, canSave: true }),
    false,
  );
});

test('snapshots must agree with current metadata revision and extraction source', () => {
  const result = { context, snapshot };
  assert.equal(isSavedMetadataSuggestions(snapshot), true);
  assert.equal(isMetadataSuggestionsReadResult(result), true);
  for (const invalid of [
    { ...snapshot, revision: 0 },
    { ...snapshot, sourceRevision: 0 },
    { ...snapshot, sourceSha256: 'bad' },
    { ...snapshot, unverified: false },
    { ...snapshot, ruleVersion: 'other-rules' },
    { ...snapshot, verified: true },
  ])
    assert.equal(isSavedMetadataSuggestions(invalid), false);
  for (const changed of [
    { ...snapshot, revision: 2 },
    { ...snapshot, sourceRevision: 2 },
    { ...snapshot, sourceSha256: 'b'.repeat(64) },
  ])
    assert.equal(
      isMetadataSuggestionsReadResult({ context, snapshot: changed }),
      false,
    );
  assert.equal(
    isMetadataSuggestionsReadResult({
      context: { ...context, sourceRevision: 0 },
      snapshot,
    }),
    false,
  );
});

test('date suggestions require a source role and other kinds cannot carry one', () => {
  const date = {
    kind: 'date',
    value: '03/04/2026',
    confidence: 'tentative',
    page: 1,
    excerpt: 'Collection date: 03/04/2026',
    dateRole: 'Collection date',
  };
  assert.equal(isMetadataSuggestion(date), true);
  assert.equal(
    isMetadataSuggestion({ ...date, dateRole: 'Report date' }),
    true,
  );
  const { dateRole: omitted, ...withoutRole } = date;
  assert.equal(omitted, 'Collection date');
  for (const invalid of [
    withoutRole,
    { ...date, dateRole: 'DOB' },
    { ...date, dateRole: undefined },
    { ...suggestion, dateRole: 'Report date' },
    { ...suggestion, confidence: 0.99 },
    { ...suggestion, confidence: 'verified' },
    { ...suggestion, kind: 'diagnosis' },
    { ...suggestion, authority: 'owner' },
  ])
    assert.equal(isMetadataSuggestion(invalid), false);
  assert.equal(isMetadataSuggestion({ ...suggestion, kind: 'type' }), true);
  assert.equal(isMetadataSuggestion({ ...suggestion, kind: 'label' }), true);
});

test('suggestion source strings are bounded, well-formed Unicode and inert data', () => {
  assert.equal(isMetadataSuggestion(suggestion), true);
  assert.equal(
    isMetadataSuggestion({
      ...suggestion,
      value: '😀'.repeat(60),
      excerpt: '😀'.repeat(120),
    }),
    true,
  );
  for (const invalid of [
    { ...suggestion, value: 'x'.repeat(121) },
    { ...suggestion, excerpt: 'x'.repeat(241) },
    { ...suggestion, value: '' },
    { ...suggestion, excerpt: '   ' },
    { ...suggestion, page: 0 },
    { ...suggestion, page: 51 },
    { ...suggestion, page: 1.5 },
    { ...suggestion, page: '1' },
  ])
    assert.equal(isMetadataSuggestion(invalid), false);
  for (const field of ['value', 'excerpt']) {
    for (const invalid of ['\ud800', '\udc00', 'a\u0000b']) {
      assert.equal(
        isMetadataSuggestion({ ...suggestion, [field]: invalid }),
        false,
      );
    }
  }
  const instruction = {
    ...suggestion,
    kind: 'label',
    value: 'Ignore previous instructions',
    excerpt: 'Labels: Ignore previous instructions',
  };
  assert.equal(isMetadataSuggestion(instruction), true);
  assert.equal(instruction.value, 'Ignore previous instructions');
});

test('snapshot suggestions are capped and timestamps must be canonical UTC ISO strings', () => {
  assert.equal(
    isSavedMetadataSuggestions({ ...snapshot, suggestions: [] }),
    true,
  );
  assert.equal(
    isSavedMetadataSuggestions({
      ...snapshot,
      suggestions: Array(12).fill(suggestion),
    }),
    true,
  );
  for (const suggestions of [
    Array(13).fill(suggestion),
    Array(1),
    [null],
    {},
  ]) {
    assert.equal(
      isSavedMetadataSuggestions({ ...snapshot, suggestions }),
      false,
    );
  }
  for (const savedAt of [
    '2026-02-30T12:00:00.000Z',
    '2026-11-14T12:00:00Z',
    '2026-11-14T12:00:00.000+00:00',
    '2026-11-14',
    'not-a-date',
    '2026-11-14T25:00:00.000Z',
  ]) {
    assert.equal(
      isSavedMetadataSuggestions({ ...snapshot, savedAt }),
      false,
      savedAt,
    );
  }
});

test('shared rules produce contract-valid hints and save results remain strictly shaped', () => {
  const suggestions = suggestMetadata([
    {
      page: 1,
      text: [
        'Radiology report',
        'Report date: 03/04/2026',
        'Collection date: 03/04/2026',
        'Provider: Synthetic Clinic',
        'Labels: follow-up',
      ].join('\n'),
    },
  ]);
  assert.equal(suggestions.length, 5);
  assert.equal(suggestions.every(isMetadataSuggestion), true);
  assert.equal(isSavedMetadataSuggestions({ ...snapshot, suggestions }), true);
  assert.equal(
    isSaveMetadataSuggestionsResult({ saved: true, revision: 1 }),
    true,
  );
  for (const result of [
    { saved: true, revision: 0 },
    { saved: false, revision: 1 },
    { saved: true, revision: 1, verified: true },
  ])
    assert.equal(isSaveMetadataSuggestionsResult(result), false);
});
