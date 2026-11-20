import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateBackupFreshness } from '../backup/freshness.mjs';
const day = 86400000;
const now = 200 * day;
const point = (n, completedAt, verified = true) => ({
  id: n.toString(16).padStart(32, '0'),
  completedAt,
  verified,
});
test('weekly freshness uses successful completion and exact due boundary', () => {
  const points = [point(1, now - 7 * day)];
  assert.equal(evaluateBackupFreshness(points, now).status, 'current');
  const late = evaluateBackupFreshness(points, now + 1);
  assert.equal(late.status, 'overdue');
  assert.equal(late.overdueByMs, 1);
  assert.equal(late.alertsEnabled, false);
});
test('new incomplete sets never conceal missing or stale verified backups', () => {
  const missing = evaluateBackupFreshness([point(1, now, false)], now);
  assert.equal(missing.status, 'missing');
  assert.equal(missing.latestVerifiedAt, null);
  assert.equal(missing.nextDueAt, null);
  assert.equal(evaluateBackupFreshness([], now).status, 'missing');
  const stale = evaluateBackupFreshness(
    [point(1, now - 8 * day), point(2, now, false)],
    now,
  );
  assert.equal(stale.status, 'overdue');
  assert.equal(stale.overdueByMs, day);
});
test('unsorted histories select latest verified set and emit no object identifiers', () => {
  const points = [point(2, now - day), point(1, now - 10 * day)];
  const before = globalThis.structuredClone(points);
  const report = evaluateBackupFreshness(points, now);
  assert.equal(report.latestVerifiedAt, now - day);
  assert.equal(report.nextDueAt, now + 6 * day);
  assert.equal(report.overdueByMs, 0);
  assert.deepEqual(points, before);
  assert.ok(!JSON.stringify(report).includes(points[0].id));
});
test('invalid completion metadata and arithmetic overflow fail closed', () => {
  for (const points of [
    [point(1, now + 1)],
    new Array(1),
    [point(1, now), point(1, now)],
  ])
    assert.throws(() => evaluateBackupFreshness(points, now));
  assert.throws(() =>
    evaluateBackupFreshness(
      [point(1, Number.MAX_SAFE_INTEGER)],
      Number.MAX_SAFE_INTEGER,
    ),
  );
});
