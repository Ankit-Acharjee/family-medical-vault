import { maximumOriginalExportArchiveBytes } from '@fmv/contracts';
import { manualJson, ManualApiError } from '../manual-readings/api';
import { readClinicalJson } from './useClinicalReview';
import { readPrivateArchive } from '../../lib/private-archive';
export async function originalExportRequest(
  patientId: string,
  body: unknown,
  prepare: boolean,
  signal: AbortSignal,
) {
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
    throw Error();
  const response = await fetch(
    `/api/patients/${encodeURIComponent(patientId)}/exports/originals${prepare ? '/prepare' : ''}`,
    {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': boot.csrf,
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw new ManualApiError(response.status);
  return prepare
    ? readClinicalJson(response, signal)
    : readPrivateArchive(response, maximumOriginalExportArchiveBytes, signal);
}
