import type { DocumentMimeType } from '@fmv/contracts';
export const OBJECT_STORE = Symbol('FMV_OBJECT_STORE');

// The application authorizes every operation. Adapters never return public URLs.
export interface ObjectStore {
  readonly ready: boolean;
  put(key: string, bytes: Buffer, mime: DocumentMimeType): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export class UnavailableObjectStore implements ObjectStore {
  readonly ready = false;
  async put(): Promise<void> {
    throw new Error('Object storage unavailable');
  }
  async get(): Promise<Buffer> {
    throw new Error('Object storage unavailable');
  }
  async remove(): Promise<void> {
    throw new Error('Object storage unavailable');
  }
}
