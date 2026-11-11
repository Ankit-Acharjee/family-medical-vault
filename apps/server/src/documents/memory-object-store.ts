import type { DocumentMimeType } from '@fmv/contracts';
import type { ObjectStore } from './object-store.js';

// Synthetic adapter only. Production must explicitly configure a private adapter.
export class MemoryObjectStore implements ObjectStore {
  readonly ready = true;
  private readonly objects = new Map<
    string,
    { bytes: Buffer; mime: DocumentMimeType }
  >();
  async put(key: string, bytes: Buffer, mime: DocumentMimeType): Promise<void> {
    this.objects.set(key, { bytes: Buffer.from(bytes), mime });
  }
  async get(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    if (!object) throw new Error('Object unavailable');
    return Buffer.from(object.bytes);
  }
  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
