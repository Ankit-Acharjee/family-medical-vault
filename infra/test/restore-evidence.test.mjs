import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  encodeRestoreEvidence,
  planRestoreReconciliation,
} from '../backup/restore-evidence.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ledgerId = 'a'.repeat(32);
const event = (
  sequence,
  kind = 'grant.revoked',
  resource = 10,
  lifecycle = null,
) => ({
  sequence,
  eventId: id(sequence),
  patientId: id(1),
  resourceId: id(resource),
  kind,
  lifecycle,
  occurredAt: 100,
});
const batch = (events) => ({
  format: 'fmv-restore-evidence-v1',
  ledgerId,
  afterSequence: 0,
  throughSequence: events.length,
  events,
});
const input = (value) => {
  const evidence = encodeRestoreEvidence(value);
  return {
    evidence,
    snapshotAnchor: { ledgerId, sequence: value.afterSequence },
    trustedHead: {
      ledgerId,
      afterSequence: value.afterSequence,
      throughSequence: value.throughSequence,
      evidenceSha256: createHash('sha256').update(evidence).digest('hex'),
    },
    now: 100,
  };
};
const reject = (work) =>
  assert.throws(
    work,
    /^Error: Restore evidence validation failed; services must remain closed$/,
  );
test('complete evidence produces deterministic idempotent fences without automatic reopening or deletion', () => {
  const value = batch([
    event(1, 'document.trashed', 20, 1),
    event(2, 'document.restored', 20, 2),
    event(3),
    event(4, 'link.revoked', 30),
    event(5),
  ]);
  const args = input(value),
    before = globalThis.structuredClone(value);
  const result = planRestoreReconciliation(args);
  assert.equal(result.documentFences[0].kind, 'document.restored');
  assert.equal(result.documentFences[0].lifecycle, 2);
  assert.equal(result.revokedGrants.length, 1);
  assert.equal(result.revokedLinks.length, 1);
  assert.equal(result.automaticReopenAllowed, false);
  assert.equal(result.automaticLedgerDeletionAllowed, false);
  assert.deepEqual(planRestoreReconciliation(args), result);
  assert.deepEqual(value, before);
  assert.equal(
    planRestoreReconciliation(input(batch([]))).automaticReopenAllowed,
    false,
  );
});
test('rejects missing tail, reordered/duplicate records and unsupported/private fields', () => {
  for (const value of [
    { ...batch([event(1)]), throughSequence: 2 },
    batch([event(2), event(1)]),
    batch([event(1), { ...event(2), eventId: id(1) }]),
    batch([{ ...event(1), title: 'private' }]),
    batch([event(1, 'document.purged')]),
    batch([{ ...event(1), lifecycle: 1 }]),
    batch([event(1, 'document.trashed', 20, 0)]),
    { ...batch([]), events: new Array(1), throughSequence: 1 },
  ])
    reject(() => encodeRestoreEvidence(value));
});
test('independent anchor, ledger identity and exact digest prevent accepting an old prefix or substituted batch', () => {
  const args = input(batch([event(1), event(2, 'link.revoked', 30)]));
  reject(() =>
    planRestoreReconciliation({
      ...args,
      trustedHead: { ...args.trustedHead, throughSequence: 3 },
    }),
  );
  reject(() =>
    planRestoreReconciliation({
      ...args,
      snapshotAnchor: { ledgerId, sequence: 1 },
    }),
  );
  reject(() =>
    planRestoreReconciliation({
      ...args,
      trustedHead: { ...args.trustedHead, ledgerId: 'b'.repeat(32) },
    }),
  );
  reject(() =>
    planRestoreReconciliation({
      ...args,
      evidence: Buffer.from(
        args.evidence.toString().replace('grant.revoked', 'link.revoked'),
      ),
    }),
  );
  reject(() =>
    planRestoreReconciliation({
      ...args,
      evidence: Buffer.from(args.evidence.toString() + '\n'),
      trustedHead: {
        ...args.trustedHead,
        evidenceSha256: createHash('sha256')
          .update(args.evidence.toString() + '\n')
          .digest('hex'),
      },
    }),
  );
  reject(() => planRestoreReconciliation({ ...args, now: 99 }));
});
test('patient mismatches, conflicting or skipped lifecycle transitions fail closed', () => {
  for (const events of [
    [event(1), { ...event(2), patientId: id(2) }],
    [event(1, 'document.trashed', 20, 1), event(2, 'document.restored', 20, 3)],
    [event(1, 'document.trashed', 20, 1), event(2, 'document.trashed', 20, 2)],
  ])
    reject(() => planRestoreReconciliation(input(batch(events))));
});
test('nonzero snapshot anchor supports exact subsequent batch and enforces batch bounds', () => {
  const value = {
    ...batch([event(11)]),
    afterSequence: 10,
    throughSequence: 11,
  };
  assert.equal(planRestoreReconciliation(input(value)).throughSequence, 11);
  reject(() =>
    encodeRestoreEvidence(
      batch(Array.from({ length: 1001 }, (_, n) => event(n + 1))),
    ),
  );
  reject(() =>
    planRestoreReconciliation({
      ...input(value),
      evidence: Buffer.alloc(524289),
    }),
  );
});
