import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  canonicalComparisonMembers,
  isConfirmMeasurementComparison,
  isMeasurementComparisonMember,
  isMeasurementComparisonMembers,
  isWithdrawMeasurementComparison,
} from '@fmv/contracts';

const member = (documentId = randomUUID()) => ({
  documentId,
  candidateId: 'page-1-block-1',
  reviewRevision: 1,
  sourceRevision: 1,
  sourceSha256: 'a'.repeat(64),
  lifecycleVersion: 0,
});
const input = () => ({
  requestId: randomUUID(),
  expectedRevision: 0,
  confirmed: true,
  members: [member(), member()],
});

test('LAB-03 comparison requests accept only complete, distinct source references', () => {
  const valid = input();
  assert.equal(isConfirmMeasurementComparison(valid), true);
  assert.equal(isMeasurementComparisonMembers(valid.members), true);
  for (const patch of [
    { documentId: 'not-a-uuid' },
    { documentId: valid.members[0].documentId + '\n' },
    { sourceSha256: 'a'.repeat(64) + '\n' },
    { candidateId: 'page-1-block-1\n' },
    { candidateId: 'page-1-block-1\u2028' },
    { candidateId: 'page-1-block-1\u2029' },
    { candidateId: 'page-0-block-1' },
    { candidateId: 'page-51-block-1' },
    { reviewRevision: 0 },
    { sourceRevision: 1.5 },
    { lifecycleVersion: -1 },
    { sourceSha256: 'A'.repeat(64) },
    { sourceSha256: 'a'.repeat(63) },
    { reviewRevision: 2147483648 },
    { extra: true },
  ])
    assert.equal(
      isMeasurementComparisonMember({ ...valid.members[0], ...patch }),
      false,
    );
  const incomplete = { ...valid.members[0] };
  delete incomplete.sourceRevision;
  assert.equal(isMeasurementComparisonMember(incomplete), false);
  for (const members of [
    [],
    [valid.members[0]],
    Array(21).fill(valid.members[0]),
    [valid.members[0], { ...valid.members[0] }],
    [valid.members[0], { ...valid.members[0], candidateId: 'page-1-block-2' }],
  ])
    assert.equal(isMeasurementComparisonMembers(members), false);
  for (const patch of [
    { confirmed: false },
    { confirmed: 'true' },
    { expectedRevision: -1 },
    { expectedRevision: 1.5 },
    { requestId: 'invalid' },
    { actorAccountId: randomUUID() },
  ])
    assert.equal(isConfirmMeasurementComparison({ ...valid, ...patch }), false);
});

test('LAB-03 withdrawal is strict and canonical member order is stable', () => {
  const value = {
    requestId: randomUUID(),
    expectedRevision: 2,
    confirmed: true,
  };
  assert.equal(isWithdrawMeasurementComparison(value), true);
  for (const patch of [
    { confirmed: false },
    { expectedRevision: -1 },
    { members: [] },
    { requestId: '' },
  ])
    assert.equal(
      isWithdrawMeasurementComparison({ ...value, ...patch }),
      false,
    );
  const refs = [
    member('BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB'),
    member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ];
  const before = globalThis.structuredClone(refs);
  const canonical = canonicalComparisonMembers(refs);
  assert.deepEqual(
    canonical.map((x) => x.documentId),
    [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ],
  );
  assert.deepEqual(refs, before);
  assert.deepEqual(canonicalComparisonMembers([...refs].reverse()), canonical);
});
