import { documentMimeTypes, maximumDocumentBytes } from '@fmv/contracts';
import type { DocumentMimeType } from '@fmv/contracts';
export class OriginalPreviewError extends Error {
  constructor(readonly reason: 'invalid' | 'size' | 'mismatch') {
    super(reason);
  }
}
export async function readOriginalPreview(
  response: Response,
  expected: { bytes: number; mime: DocumentMimeType; sha256: string },
  signal: AbortSignal,
): Promise<Blob> {
  signal.throwIfAborted();
  const mime = response.headers
    .get('content-type')
    ?.split(';')[0]
    ?.trim()
    .toLowerCase();
  const declared = response.headers.get('content-length');
  if (
    !response.ok ||
    !Number.isInteger(expected.bytes) ||
    expected.bytes <= 0 ||
    !documentMimeTypes.includes(expected.mime) ||
    mime !== expected.mime ||
    expected.sha256.length !== 64 ||
    !/^[a-f0-9]+$/.test(expected.sha256)
  ) {
    void response.body?.cancel().catch(() => {});
    throw new OriginalPreviewError('invalid');
  }
  if (
    expected.bytes > maximumDocumentBytes ||
    (declared !== null &&
      (!/^[0-9]+$/.test(declared) || Number(declared) > maximumDocumentBytes))
  ) {
    void response.body?.cancel().catch(() => {});
    throw new OriginalPreviewError('size');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new OriginalPreviewError('invalid');
  const chunks: Uint8Array[] = [];
  let size = 0,
    complete = false;
  try {
    while (true) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) {
        complete = true;
        break;
      }
      size += part.value.byteLength;
      if (size > maximumDocumentBytes) throw new OriginalPreviewError('size');
      if (size > expected.bytes) throw new OriginalPreviewError('mismatch');
      chunks.push(part.value);
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (size !== expected.bytes) throw new OriginalPreviewError('mismatch');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  chunks.length = 0;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  signal.throwIfAborted();
  if (
    [...hash].map((b) => b.toString(16).padStart(2, '0')).join('') !==
    expected.sha256
  )
    throw new OriginalPreviewError('mismatch');
  return new Blob([bytes.buffer], { type: expected.mime });
}
