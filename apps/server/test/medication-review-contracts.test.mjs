import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  extractMedicationFields,
  isMedicationCandidate,
  isSaveMedicationReview,
  isWithdrawMedicationReview,
  isMedicationReviewResult,
  isMedicationHistoryResult,
  medicationFieldsEqual,
} from '@fmv/contracts';
const sha = 'a'.repeat(64),
  c = extractMedicationFields([
    {
      page: 1,
      text: 'Medication: SYNTHETIC historical/stopped?\nDose: as written only\nFrequency: if needed (uncertain)',
    },
  ])[0];
const context = {
  sourceRevision: 1,
  sourceSha256: sha,
  lifecycleVersion: 0,
  revision: 1,
  canVerify: true,
};
const snapshot = {
  revision: 1,
  sourceRevision: 1,
  sourceSha256: sha,
  confirmedAt: '2026-11-15T00:00:00.000Z',
  action: 'confirmation',
  meaning: 'source-fields-only',
  ruleVersion: 'labeled-medication-blocks-v1',
  extraction: {
    method: 'pdf-text',
    engineVersion: 'pdfjs-6.5.438',
    partial: false,
    partialReason: null,
    downsized: false,
  },
  statements: [c],
  withdrawnStatements: [],
};
const input = () => ({
  requestId: randomUUID(),
  expectedRevision: 0,
  sourceRevision: 1,
  sourceSha256: sha,
  lifecycleVersion: 0,
  confirmed: true,
  meaning: 'source-fields-only',
  candidateIds: [c.id],
});
test('medication attestation inputs accept exact references only and cannot assert regimen status', () => {
  assert.equal(isSaveMedicationReview(input()), true);
  for (const extra of [
    { status: 'current' },
    { verified: true },
    { fields: { dose: 'SYNTHETIC altered' } },
    { regimenId: randomUUID() },
    { schedule: [] },
    { actorAccountId: randomUUID() },
    { code: 'SYNTHETIC' },
  ])
    assert.equal(isSaveMedicationReview({ ...input(), ...extra }), false);
  for (const change of [
    { meaning: 'current-medication' },
    { confirmed: false },
    { candidateIds: [] },
    { candidateIds: ['page-51-medication-0'] },
    { candidateIds: ['page-1-medication-500000'] },
    { candidateIds: ['page-1-medication-00'] },
    { candidateIds: [c.id, c.id] },
    { sourceRevision: 0 },
    { requestId: 'x' },
    { expectedRevision: 2147483648 },
    { lifecycleVersion: -1 },
    { sourceSha256: 'A'.repeat(64) },
  ])
    assert.equal(isSaveMedicationReview({ ...input(), ...change }), false);
  const { sourceRevision, ...withdraw } = input();
  void sourceRevision;
  withdraw.expectedRevision = 1;
  assert.equal(isWithdrawMedicationReview(withdraw), true);
  assert.equal(
    isWithdrawMedicationReview({ ...withdraw, sourceRevision: 1 }),
    false,
  );
  assert.equal(
    isWithdrawMedicationReview({ ...withdraw, expectedRevision: 0 }),
    false,
  );
});
test('medication candidate guard preserves all source fields and rejects forged evidence', () => {
  assert.equal(isMedicationCandidate(c), true);
  for (const value of [
    { ...c, verified: true },
    { ...c, page: 2 },
    { ...c, confidence: 'high' },
    { ...c, id: 'page-1-medication-500000' },
    { ...c, fields: { ...c.fields, status: 'active' } },
    { ...c, fields: { ...c.fields, medication: null } },
    {
      ...c,
      fields: { ...c.fields, dose: { ...c.fields.dose, value: 'altered' } },
    },
    {
      ...c,
      fields: {
        ...c.fields,
        dose: { value: 'x', excerpt: 'Dose: x\nDose: y' },
      },
    },
    {
      ...c,
      fields: { ...c.fields, dose: { value: 'x', excerpt: 'Frequency: x' } },
    },
    {
      ...c,
      fields: {
        ...c.fields,
        medication: { value: '\ud800', excerpt: 'Medication: \ud800' },
      },
    },
    {
      ...c,
      fields: { ...c.fields, strength: { value: '', excerpt: 'Strength:' } },
    },
    {
      ...c,
      fields: {
        ...c.fields,
        route: { value: 'x'.repeat(121), excerpt: 'Route: ' + 'x'.repeat(121) },
      },
    },
    {
      ...c,
      fields: {
        ...c.fields,
        instructions: {
          value: 'x',
          excerpt: 'Instructions: x',
          verified: true,
        },
      },
    },
  ])
    assert.equal(isMedicationCandidate(value), false);
});
test('medication snapshots are explicit source-field attestations and keep withdrawal separate', () => {
  assert.equal(
    isMedicationReviewResult({ context, candidates: [c], snapshot }),
    true,
  );
  const withdrawn = {
    ...snapshot,
    action: 'withdrawal',
    statements: [],
    withdrawnStatements: [c],
  };
  assert.equal(
    isMedicationReviewResult({ context, candidates: [c], snapshot: withdrawn }),
    true,
  );
  for (const change of [
    { meaning: 'current-medication' },
    { verified: true },
    { statements: [], withdrawnStatements: [] },
    { action: 'withdrawal', withdrawnStatements: [c] },
    { revision: 2 },
    { sourceRevision: 2 },
    { confirmedAt: '2026-02-30T00:00:00.000Z' },
  ])
    assert.equal(
      isMedicationReviewResult({
        context,
        candidates: [c],
        snapshot: { ...snapshot, ...change },
      }),
      false,
    );
  assert.equal(
    isMedicationReviewResult({
      context: { ...context, revision: 0 },
      candidates: [c],
      snapshot: null,
    }),
    true,
  );
  assert.equal(
    isMedicationReviewResult({ context, candidates: [c], snapshot: null }),
    false,
  );
});
test('medication history validates current context while keeping prior revisions bounded', () => {
  assert.equal(
    isMedicationHistoryResult({
      context: { ...context, revision: 4 },
      snapshot,
      nextBefore: null,
    }),
    true,
  );
  assert.equal(
    isMedicationHistoryResult({
      context: { ...context, revision: 4 },
      snapshot: { ...snapshot, revision: 3 },
      nextBefore: 3,
    }),
    true,
  );
  for (const result of [
    { context, snapshot, nextBefore: 1 },
    { context, snapshot, nextBefore: 0 },
    { context: { ...context, revision: 0 }, snapshot, nextBefore: null },
    {
      context,
      snapshot: { ...snapshot, sourceSha256: 'b'.repeat(64) },
      nextBefore: null,
    },
  ])
    assert.equal(isMedicationHistoryResult(result), false);
});

test('medication evidence equality ignores JSONB key order without ignoring values or missing fields', () => {
  const reversed = Object.fromEntries(
    Object.entries(c.fields)
      .reverse()
      .map(([key, field]) => [
        key,
        field && { excerpt: field.excerpt, value: field.value },
      ]),
  );
  assert.equal(medicationFieldsEqual(c.fields, reversed), true);
  assert.equal(
    medicationFieldsEqual(c.fields, { ...reversed, dose: null }),
    false,
  );
  const { route, ...missing } = reversed;
  void route;
  assert.equal(medicationFieldsEqual(c.fields, missing), false);
  assert.equal(
    medicationFieldsEqual(c.fields, { ...reversed, extra: null }),
    false,
  );
});
test('all nine medication fields preserve exact uncertain and historical wording, not active status', () => {
  const candidate = extractMedicationFields([
    {
      page: 50,
      text: 'Medication: SYNTHETIC stopped?\nInstructions: <literal> historical only\nEnd date: unknown\nStart date: unclear\nDuration: per source\nRoute: unspecified?\nFrequency: if needed\nDose:  1?\nStrength: 10? units',
    },
  ])[0];
  assert.equal(isMedicationCandidate(candidate), true);
  assert.equal(candidate.fields.dose.value, ' 1?');
  assert.equal(Object.hasOwn(candidate, 'active'), false);
  const changes = [
    null,
    [],
    true,
    {},
    {
      ...input(),
      candidateIds: Array.from(
        { length: 21 },
        (_, i) => `page-1-medication-${i}`,
      ),
    },
  ];
  for (const change of changes)
    assert.equal(isSaveMedicationReview(change), false);
});

test('medication guards preserve literal trailing CR regardless of source field order', () => {
  for (const text of [
    'Medication: SYNTHETIC\nInstructions: retained\nDose: literal\r',
    'Medication: SYNTHETIC\r',
    'Medication: SYNTHETIC\nFrequency: literal\r',
  ]) {
    const candidate = extractMedicationFields([{ page: 1, text }])[0];
    assert.ok(candidate);
    assert.equal(isMedicationCandidate(candidate), true);
    assert.equal(
      isMedicationReviewResult({
        context,
        candidates: [candidate],
        snapshot: { ...snapshot, statements: [candidate] },
      }),
      true,
    );
  }
});
