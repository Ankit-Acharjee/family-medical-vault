const DAY_MS = 86400000;
const WINDOW_MS = 90 * DAY_MS;
const MAX_POINTS = 10000;

/** Planning only. Callers must authenticate completion manifests before supplying them.
 * No provider operations, deletion authority or last-good-point exceptions are inferred.
 */
export function planBackupRetention(points, now) {
  if (
    !Number.isSafeInteger(now) ||
    now < WINDOW_MS ||
    !Array.isArray(points) ||
    points.length > MAX_POINTS
  )
    throw new Error('Invalid backup retention input');
  const seen = new Set();
  const validated = Array.from(points)
    .map((point) => {
      if (
        !point ||
        typeof point !== 'object' ||
        Array.isArray(point) ||
        Object.keys(point).sort().join(',') !== 'completedAt,id,verified' ||
        typeof point.id !== 'string' ||
        !/^[a-f0-9]{32}$/.test(point.id) ||
        seen.has(point.id) ||
        !Number.isSafeInteger(point.completedAt) ||
        point.completedAt < 0 ||
        point.completedAt > now ||
        typeof point.verified !== 'boolean'
      )
        throw new Error('Invalid backup retention input');
      seen.add(point.id);
      return { ...point };
    })
    .sort((a, b) => a.completedAt - b.completedAt || a.id.localeCompare(b.id));
  const cutoff = now - WINDOW_MS;
  const retain = [],
    expirationCandidates = [],
    incomplete = [];
  for (const point of validated) {
    if (!point.verified) incomplete.push(point.id);
    else if (point.completedAt < cutoff) expirationCandidates.push(point.id);
    else retain.push(point.id);
  }
  return {
    retentionDays: 90,
    evaluatedAt: now,
    cutoff,
    retain,
    expirationCandidates,
    incomplete,
    deletionEnabled: false,
  };
}
