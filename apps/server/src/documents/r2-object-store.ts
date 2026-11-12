import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { documentMimeTypes, maximumDocumentBytes } from '@fmv/contracts';
import type { DocumentMimeType } from '@fmv/contracts';
import type { ObjectStore } from './object-store.js';
import type { R2Config } from './storage.config.js';
import { isObjectKey } from './object-key.js';

type Command = PutObjectCommand | GetObjectCommand | DeleteObjectCommand;
export interface R2Sender {
  send(
    command: Command,
    options: { abortSignal: AbortSignal },
  ): Promise<unknown>;
}

const deadlineMilliseconds = 8000;
const unavailable = () => new Error('Object storage unavailable');
const accountPattern = /^[a-f0-9]{32}$/;
const bucketPattern = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keyValid(key: unknown): key is string {
  return isObjectKey(key);
}

function configValid(config: R2Config): boolean {
  return (
    object(config) &&
    typeof config.accountId === 'string' &&
    config.accountId.length === 32 &&
    accountPattern.test(config.accountId) &&
    typeof config.bucket === 'string' &&
    config.bucket.length >= 3 &&
    config.bucket.length <= 63 &&
    !/[^a-z0-9-]/.test(config.bucket) &&
    bucketPattern.test(config.bucket) &&
    [config.accessKeyId, config.secretAccessKey].every(
      (value) =>
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 256 &&
        !/[^\x21-\x7e]/.test(value),
    )
  );
}

function outputValid(value: unknown): value is Record<string, unknown> {
  if (!object(value)) return false;
  if (value.$metadata === undefined) return true;
  if (!object(value.$metadata)) return false;
  const status = value.$metadata.httpStatusCode;
  return (
    status === undefined ||
    (typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= 200 &&
      status < 300)
  );
}

function destroyBody(body: Readable | undefined) {
  try {
    body?.destroy();
  } catch {
    // Cleanup failures must not expose SDK or object details.
  }
}

// Configured-ready does not establish bucket privacy, credentials or provider
// health. The caller supplies current patient authorization before every access.
export class R2ObjectStore implements ObjectStore {
  private readonly sender: R2Sender;
  private readonly client: S3Client | undefined;
  private readonly bucket: string;
  private readonly active = new Set<() => void>();
  private destroyed = false;

  constructor(config: R2Config, sender?: R2Sender) {
    if (!configValid(config)) throw unavailable();
    this.bucket = config.bucket;
    try {
      if (sender) {
        if (typeof sender.send !== 'function') throw unavailable();
        this.sender = sender;
      } else {
        this.client = new S3Client({
          endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
          region: 'auto',
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
          maxAttempts: 1,
          // R2's S3 compatibility differs from AWS checksum defaults. Clinical
          // integrity remains the intake core's full-byte SHA256 validation.
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
          followRegionRedirects: false,
        });
        this.sender = this.client;
      }
    } catch {
      throw unavailable();
    }
  }

  get ready(): boolean {
    return !this.destroyed;
  }

  async put(key: string, bytes: Buffer, mime: DocumentMimeType): Promise<void> {
    if (
      !keyValid(key) ||
      !Buffer.isBuffer(bytes) ||
      bytes.length < 1 ||
      bytes.length > maximumDocumentBytes ||
      !documentMimeTypes.includes(mime)
    )
      throw unavailable();
    // Preserve the validated bytes even if the caller mutates its buffer later.
    const original = Buffer.from(bytes);
    await this.command(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: original,
        ContentLength: original.length,
        ContentType: mime,
        CacheControl: 'private, no-store',
      }),
      async () => undefined,
    );
  }

  async get(key: string): Promise<Buffer> {
    if (!keyValid(key)) throw unavailable();
    return this.command(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      async (output, body, signal, started) => {
        const declared = output.ContentLength;
        if (
          !(body instanceof Readable) ||
          (declared !== undefined &&
            (typeof declared !== 'number' ||
              !Number.isInteger(declared) ||
              declared < 1 ||
              declared > maximumDocumentBytes))
        )
          throw unavailable();
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of body) {
          if (
            signal.aborted ||
            Date.now() - started >= deadlineMilliseconds ||
            !(chunk instanceof Uint8Array)
          )
            throw unavailable();
          size += chunk.byteLength;
          if (size > maximumDocumentBytes) throw unavailable();
          if (chunk.byteLength) chunks.push(Buffer.from(chunk));
        }
        if (
          signal.aborted ||
          size < 1 ||
          (declared !== undefined && size !== declared)
        )
          throw unavailable();
        return Buffer.concat(chunks, size);
      },
    );
  }

  async remove(key: string): Promise<void> {
    if (!keyValid(key)) throw unavailable();
    // DeleteObject's successful response also covers an already absent key.
    // A timeout remains ambiguous; the intake core retains its retired manifest.
    await this.command(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      async () => undefined,
    );
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const cancel of this.active) cancel();
    try {
      this.client?.destroy();
    } catch {
      // Shutdown must not expose SDK internals or credentials.
    }
  }

  onModuleDestroy(): void {
    this.destroy();
  }

  private async command<T>(
    command: Command,
    consume: (
      output: Record<string, unknown>,
      body: Readable | undefined,
      signal: AbortSignal,
      started: number,
    ) => Promise<T>,
  ): Promise<T> {
    if (this.destroyed) throw unavailable();
    const controller = new AbortController();
    const started = Date.now();
    let body: Readable | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = () => {
        controller.abort();
        destroyBody(body);
        reject(unavailable());
      };
      timer = setTimeout(cancel, deadlineMilliseconds);
    });
    this.active.add(cancel);
    const request = (async () => {
      const output = await this.sender.send(command, {
        abortSignal: controller.signal,
      });
      if (object(output) && output.Body instanceof Readable) body = output.Body;
      // SDK promises may resolve after cancellation. Dispose late response bodies
      // too, so a timed-out request cannot retain an open socket.
      if (controller.signal.aborted || this.destroyed) {
        destroyBody(body);
        throw unavailable();
      }
      if (!outputValid(output)) throw unavailable();
      return consume(output, body, controller.signal, started);
    })();
    try {
      return await Promise.race([request, cancelled]);
    } catch {
      controller.abort();
      throw unavailable();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.active.delete(cancel);
      destroyBody(body);
    }
  }
}
