import { planBackupRetention } from './retention-plan.mjs';
const WEEK_MS = 7 * 86400000;

/** Evaluate authenticated completion metadata only. This sends no alerts and
 * does not prove recovery integrity, capacity, scheduler health or key custody.
 */
export function evaluateBackupFreshness(points, now) {
  // Reuse the bounded, strict metadata validator; expiration is advisory only.
  planBackupRetention(points, now);
  let latest = null;
  for (const point of points) {
    if (point.verified && (latest === null || point.completedAt > latest))
      latest = point.completedAt;
  }
  if (latest === null) {
    return {
      status: 'missing',
      latestVerifiedAt: null,
      nextDueAt: null,
      overdueByMs: null,
      alertsEnabled: false,
    };
  }
  const due = latest + WEEK_MS;
  if (!Number.isSafeInteger(due))
    throw new Error('Invalid backup freshness input');
  return {
    status: now > due ? 'overdue' : 'current',
    latestVerifiedAt: latest,
    nextDueAt: due,
    overdueByMs: Math.max(0, now - due),
    alertsEnabled: false,
  };
}
