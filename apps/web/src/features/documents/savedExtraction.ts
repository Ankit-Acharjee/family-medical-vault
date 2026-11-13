import {
  isExtractionContext,
  isSaveExtraction,
  maximumExtractionRequestBytes,
} from '@fmv/contracts';
import type { ExtractionContext, ExtractionResult } from '@fmv/contracts';

export const extractionPath = (patientId: string, documentId: string) =>
  `/api/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(documentId)}/extraction`;

export type SaveExtractionAttempt = { requestId: string; body: string };

export function createSaveExtractionAttempt(
  context: ExtractionContext | null,
  result: ExtractionResult,
): SaveExtractionAttempt | null {
  if (!context?.canSave) return null;
  const requestId = crypto.randomUUID();
  const payload = {
    requestId,
    expectedRevision: context.revision,
    lifecycleVersion: context.lifecycleVersion,
    sourceSha256: context.sourceSha256,
    result,
  };
  if (!isSaveExtraction(payload)) return null;
  const body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).byteLength > maximumExtractionRequestBytes)
    return null;
  return { requestId, body };
}

/** Optional metadata must finish before reading original bytes, but cannot prevent extraction. */
export async function readExtractionContext(
  path: string,
  signal: AbortSignal,
): Promise<ExtractionContext | null> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  const deadline = window.setTimeout(cancel, 3000);
  try {
    signal.throwIfAborted();
    const response = await fetch(`${path}/context`, {
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (
      !value ||
      typeof value !== 'object' ||
      !('context' in value) ||
      !isExtractionContext(value.context)
    )
      return null;
    return value.context;
  } catch {
    return null;
  } finally {
    window.clearTimeout(deadline);
    signal.removeEventListener('abort', cancel);
  }
}
