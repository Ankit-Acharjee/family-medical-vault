import assert from 'node:assert/strict';
import test from 'node:test';
import { planBackupRetention } from '../backup/retention-plan.mjs';
const day = 86400000;
const now = 200 * day;
const point = (n, completedAt, verified = true) => ({
  id: n.toString(16).padStart(32, '0'),
  completedAt,
  verified,
});
test('retention uses age, preserves exact boundary and never caps snapshot count', () => {
  const points = Array.from({ length: 20 }, (_, n) =>
    point(n + 1, now - n * day),
  );
  points.push(point(21, now - 90 * day), point(22, now - 90 * day - 1));
  const before = globalThis.structuredClone(points);
  const result = planBackupRetention(points, now);
  assert.equal(result.retain.length, 21);
  assert.deepEqual(result.expirationCandidates, [point(22, 0).id]);
  assert.equal(result.deletionEnabled, false);
  assert.deepEqual(points, before);
});
test('incomplete points are not recovery points or automatic expiration candidates', () => {
  const result = planBackupRetention([point(1, 0, false), point(2, now)], now);
  assert.deepEqual(result.incomplete, [point(1, 0).id]);
  assert.deepEqual(result.expirationCandidates, []);
  assert.deepEqual(result.retain, [point(2, 0).id]);
  assert.deepEqual(planBackupRetention([], now).retain, []);
});
test('invalid, ambiguous or future metadata fails closed without echoing values', () => {
  for (const points of [
    [point(1, now + 1)],
    [point(1, -1)],
    [point(1, NaN)],
    [point(1, now), point(1, now)],
    [null],
    [{ ...point(1, now), verified: 'true' }],
    [{ ...point(1, now), secret: 'not-for-output' }],
    [{ ...point(1, now), id: '../object' }],
    new Array(10001),
    new Array(1),
  ])
    assert.throws(
      () => planBackupRetention(points, now),
      /^Error: Invalid backup retention input$/,
    );
  for (const time of [NaN, Infinity, -1, 0, 'now'])
    assert.throws(() => planBackupRetention([], time));
});
test('deterministic ties and expired last point produce advisory classification only', () => {
  const a = point(1, 0),
    b = point(2, 0);
  const result = planBackupRetention([b, a], now);
  assert.deepEqual(result.expirationCandidates, [a.id, b.id]);
  assert.equal(result.deletionEnabled, false);
  assert.deepEqual(result.retain, []);
});
