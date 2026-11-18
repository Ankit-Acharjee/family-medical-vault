import { Readable } from 'node:stream';
import { Buffer } from 'node:buffer';
import { ZipFile } from 'yazl';
import { PayloadTooLargeException } from '@nestjs/common';
export async function zipBuffers(
  files: readonly (readonly [string, Buffer])[],
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  signal.throwIfAborted();
  return await new Promise<Buffer>((resolve, reject) => {
    const zip = new ZipFile(),
      chunks: Buffer[] = [];
    let size = 0,
      settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', cancel);
      if (error) {
        if (zip.outputStream instanceof Readable) zip.outputStream.destroy();
        reject(error);
      } else resolve(Buffer.concat(chunks, size));
    };
    const cancel = () => finish(new Error('Export cancelled'));
    zip.on('error', finish);
    zip.outputStream.on('error', finish);
    zip.outputStream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maximumBytes) finish(new PayloadTooLargeException());
      else chunks.push(chunk);
    });
    zip.outputStream.on('end', () => finish());
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      for (const [name, bytes] of files)
        zip.addBuffer(bytes, name, {
          compressionLevel: 0,
          mtime: new Date('2000-01-01T00:00:00.000Z'),
          mode: 0o100600,
        });
      zip.end();
    } catch (error) {
      finish(error);
    }
  });
}
