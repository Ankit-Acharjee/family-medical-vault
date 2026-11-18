import { manualJson, ManualApiError } from '../manual-readings/api';
import { readClinicalJson } from '../documents/useClinicalReview';
export async function sharingRequest(
  path: string,
  body: unknown,
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
    throw Error('Unavailable');
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': boot.csrf },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new ManualApiError(response.status);
  return response;
}
export async function sharingJson(
  path: string,
  body: unknown,
  signal: AbortSignal,
) {
  return readClinicalJson(await sharingRequest(path, body, signal), signal);
}
