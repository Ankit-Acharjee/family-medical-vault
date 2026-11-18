import { readPrivateArchive } from '../../lib/private-archive';
import {
  canonicalSummarySnapshot,
  maximumSummaryExportBytes,
} from '@fmv/contracts';
import type { GroundedSummary } from '@fmv/contracts';
import { manualJson } from '../manual-readings/api';
export async function downloadSummary(
  value: GroundedSummary,
  signal: AbortSignal,
) {
  const canonical = canonicalSummarySnapshot(value);
  if (!canonical) throw Error('Invalid summary');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  );
  signal.throwIfAborted();
  const snapshotSha256 = Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  const boot = await manualJson('/api/auth/bootstrap', signal);
  if (
    !boot ||
    typeof boot !== 'object' ||
    !('enabled' in boot) ||
    boot.enabled !== true ||
    !('csrf' in boot) ||
    typeof boot.csrf !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(boot.csrf)
  )
    throw Error('Authentication unavailable');
  const response = await fetch(
    `/api/patients/${encodeURIComponent(value.patientId)}/summary/export`,
    {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': boot.csrf,
      },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        confirmed: true,
        format: 'zip',
        request: { scope: value.scope, period: value.period },
        snapshotSha256,
      }),
    },
  );
  return readPrivateArchive(response, maximumSummaryExportBytes, signal);
}
