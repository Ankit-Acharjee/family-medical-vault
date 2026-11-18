import { ManualApiError } from '../features/manual-readings/api';
export async function readPrivateArchive(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
) {
  if (!response.ok) throw new ManualApiError(response.status);
  if (
    response.headers.get('content-type')?.split(';')[0] !== 'application/zip' ||
    Number(response.headers.get('content-length')) > maximumBytes
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
      if (size > maximumBytes) {
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
