import {
  canonicalSummarySnapshot,
  maximumSummaryExportBytes,
} from '@fmv/contracts';
import type { GroundedSummary } from '@fmv/contracts';
import { manualJson, ManualApiError } from '../manual-readings/api';
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
  if (!response.ok) throw new ManualApiError(response.status);
  if (
    response.headers.get('content-type')?.split(';')[0] !== 'application/zip' ||
    Number(response.headers.get('content-length')) > maximumSummaryExportBytes
  ) {
    void response.body?.cancel();
    throw Error('Invalid archive response');
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error('Missing archive');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.length;
      if (size > maximumSummaryExportBytes) {
        void reader.cancel();
        throw Error('Archive too large');
      }
      chunks.push(new Uint8Array(next.value));
    }
  } finally {
    reader.releaseLock();
  }
  signal.throwIfAborted();
  const blob = new Blob(chunks, { type: 'application/zip' });
  const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  signal.throwIfAborted();
  if (
    size < 4 ||
    header[0] !== 0x50 ||
    header[1] !== 0x4b ||
    header[2] !== 3 ||
    header[3] !== 4
  )
    throw Error('Invalid archive');
  return blob;
}
