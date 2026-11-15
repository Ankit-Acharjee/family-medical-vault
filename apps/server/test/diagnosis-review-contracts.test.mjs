import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  extractDiagnosisFields,
  isDiagnosisCandidate,
  isSaveDiagnosisReview,
  isWithdrawDiagnosisReview,
  isDiagnosisReviewResult,
  isDiagnosisHistoryResult,
} from '@fmv/contracts';
const sha = 'a'.repeat(64),
  c = extractDiagnosisFields([
    { page: 1, text: 'Diagnosis: No SYNTHETIC current condition' },
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
  meaning: 'source-statement-only',
  ruleVersion: 'explicit-diagnosis-lines-v1',
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
  meaning: 'source-statement-only',
  candidateIds: [c.id],
});
test('diagnosis attestation inputs accept exact references only and cannot assert disease status', () => {
  assert.equal(isSaveDiagnosisReview(input()), true);
  for (const extra of [
    { status: 'current' },
    { verified: true },
    { statement: 'SYNTHETIC altered' },
    { actorAccountId: randomUUID() },
    { code: 'SYNTHETIC' },
  ])
    assert.equal(isSaveDiagnosisReview({ ...input(), ...extra }), false);
  for (const change of [
    { meaning: 'current-diagnosis' },
    { confirmed: false },
    { candidateIds: [] },
    { candidateIds: [c.id, c.id] },
    { sourceRevision: 0 },
    { requestId: 'x' },
    { expectedRevision: 2147483648 },
    { lifecycleVersion: -1 },
    { sourceSha256: 'A'.repeat(64) },
  ])
    assert.equal(isSaveDiagnosisReview({ ...input(), ...change }), false);
  const { sourceRevision, ...withdraw } = input();
  void sourceRevision;
  withdraw.expectedRevision = 1;
  assert.equal(isWithdrawDiagnosisReview(withdraw), true);
  assert.equal(
    isWithdrawDiagnosisReview({ ...withdraw, sourceRevision: 1 }),
    false,
  );
  assert.equal(
    isWithdrawDiagnosisReview({ ...withdraw, expectedRevision: 0 }),
    false,
  );
});
test('diagnosis candidate guard preserves exact labeled source text and qualifiers', () => {
  assert.equal(isDiagnosisCandidate(c), true);
  for (const value of [
    { ...c, verified: true },
    { ...c, page: 2 },
    { ...c, field: { ...c.field, value: 'SYNTHETIC condition' } },
    { ...c, field: { ...c.field, excerpt: 'Diagnosis: SYNTHETIC\nother' } },
    {
      ...c,
      field: { ...c.field, value: '\ud800', excerpt: 'Diagnosis: \ud800' },
    },
    { ...c, confidence: 'high' },
  ])
    assert.equal(isDiagnosisCandidate(value), false);
});
test('diagnosis snapshots are explicit source attestations and keep withdrawal separate', () => {
  assert.equal(
    isDiagnosisReviewResult({ context, candidates: [c], snapshot }),
    true,
  );
  const withdrawn = {
    ...snapshot,
    action: 'withdrawal',
    statements: [],
    withdrawnStatements: [c],
  };
  assert.equal(
    isDiagnosisReviewResult({ context, candidates: [c], snapshot: withdrawn }),
    true,
  );
  for (const change of [
    { meaning: 'current-diagnosis' },
    { verified: true },
    { statements: [], withdrawnStatements: [] },
    { action: 'withdrawal', withdrawnStatements: [c] },
    { revision: 2 },
    { sourceRevision: 2 },
    { confirmedAt: '2026-02-30T00:00:00.000Z' },
  ])
    assert.equal(
      isDiagnosisReviewResult({
        context,
        candidates: [c],
        snapshot: { ...snapshot, ...change },
      }),
      false,
    );
  assert.equal(
    isDiagnosisReviewResult({
      context: { ...context, revision: 0 },
      candidates: [c],
      snapshot: null,
    }),
    true,
  );
  assert.equal(
    isDiagnosisReviewResult({ context, candidates: [c], snapshot: null }),
    false,
  );
});
test('diagnosis history validates current context while keeping prior revisions bounded', () => {
  assert.equal(
    isDiagnosisHistoryResult({
      context: { ...context, revision: 4 },
      snapshot,
      nextBefore: null,
    }),
    true,
  );
  assert.equal(
    isDiagnosisHistoryResult({
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
    assert.equal(isDiagnosisHistoryResult(result), false);
});
