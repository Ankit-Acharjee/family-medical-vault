import { createHash, randomUUID } from 'node:crypto';
import { documentMimeTypes, maximumDocumentBytes } from '@fmv/contracts';
import type {
  BeginUpload,
  DocumentMimeType,
  PermissionAction,
  PermissionScope,
  UploadResult,
  UploadState,
} from '@fmv/contracts';
import type { ObjectStore } from './object-store.js';

export type IntakeRecord = {
  uploadId: string;
  documentId: string;
  patientId: string;
  title: string;
  mimeType: DocumentMimeType;
  bytes: number;
  sha256: string;
  idempotencyKey: string;
  categoryId: string;
  objectKey: string;
  state: UploadState;
  createdAt: Date;
};

export interface IntakeMetadata {
  resolveCategory(categoryId?: string): Promise<string | null>;
  findByIdempotency(
    patientId: string,
    key: string,
  ): Promise<IntakeRecord | null>;
  findUpload(patientId: string, uploadId: string): Promise<IntakeRecord | null>;
  findDocument(
    patientId: string,
    documentId: string,
  ): Promise<IntakeRecord | null>;
  create(record: IntakeRecord): Promise<void>;
  setState(uploadId: string, state: UploadState): Promise<void>;
}

export interface IntakeStore {
  // Serialize across processes, not just one JS instance. The metadata adapter
  // must commit returned outcomes; a caught upload failure can contain a durable
  // FAILED transition and must not be rolled back by throwing outside the lock.
  withLock<T>(
    key: string,
    work: (metadata: IntakeMetadata) => Promise<T>,
  ): Promise<T>;
}

export type IntakeAuthorization = (
  patientId: string,
  action: PermissionAction,
  target: PermissionScope,
) => Promise<void>;

export class IntakeError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 413 | 415 | 503) {
    super(
      status === 503
        ? 'Document storage unavailable'
        : 'Document operation unavailable',
    );
    this.name = 'IntakeError';
  }
}

type Outcome<T> = { value: T } | { error: unknown };
class AuthorizationFailure {
  constructor(readonly error: unknown) {}
}
const result = (record: IntakeRecord): UploadResult => ({
  uploadId: record.uploadId,
  documentId: record.documentId,
  state: record.state,
});
const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const lockKey = (kind: string, ...parts: string[]) =>
  `intake:${kind}:${digest(Buffer.from(JSON.stringify(parts)))}`;
const categoryUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function declaration(input: BeginUpload): BeginUpload {
  if (
    !input ||
    typeof input.title !== 'string' ||
    input.title.trim().length < 1 ||
    input.title.trim().length > 200 ||
    typeof input.idempotencyKey !== 'string' ||
    input.idempotencyKey.length < 1 ||
    input.idempotencyKey.length > 128 ||
    /[^A-Za-z0-9_-]/.test(input.idempotencyKey) ||
    typeof input.sha256 !== 'string' ||
    input.sha256.length !== 64 ||
    !/^[a-fA-F0-9]{64}$/.test(input.sha256) ||
    !Number.isSafeInteger(input.bytes) ||
    input.bytes < 1 ||
    (input.categoryId !== undefined &&
      (typeof input.categoryId !== 'string' ||
        input.categoryId.length !== 36 ||
        !categoryUuid.test(input.categoryId)))
  )
    throw new IntakeError(400);
  if (input.bytes > maximumDocumentBytes) throw new IntakeError(413);
  if (!documentMimeTypes.includes(input.mimeType)) throw new IntakeError(415);
  return {
    ...input,
    title: input.title.trim(),
    sha256: input.sha256.toLowerCase(),
  };
}

// This is a strict signature boundary, not a claim to scan or decode a file.
// Renderers still need isolation and safe response content types.
function validSignature(bytes: Buffer, mime: DocumentMimeType): boolean {
  switch (mime) {
    case 'application/pdf':
      return (
        bytes.length >= 5 && bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
      );
    case 'image/jpeg':
      return (
        bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
      );
    case 'image/png':
      return (
        bytes.length >= 8 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      );
    case 'image/webp':
      return (
        bytes.length >= 16 &&
        bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.readUInt32LE(4) + 8 === bytes.length &&
        bytes.toString('ascii', 8, 12) === 'WEBP' &&
        ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))
      );
  }
}

function validateBytes(bytes: Buffer, record: IntakeRecord) {
  if (!Buffer.isBuffer(bytes)) throw new IntakeError(400);
  if (bytes.length > maximumDocumentBytes) throw new IntakeError(413);
  if (bytes.length !== record.bytes || digest(bytes) !== record.sha256)
    throw new IntakeError(400);
  if (!validSignature(bytes, record.mimeType)) throw new IntakeError(415);
}

export class DocumentIntake {
  constructor(
    private readonly store: IntakeStore,
    private readonly objects: ObjectStore,
  ) {}

  get storageReady(): boolean {
    return this.objects.ready;
  }

  async begin(
    patientId: string,
    input: BeginUpload,
    authorize: IntakeAuthorization,
  ): Promise<UploadResult> {
    const declared = declaration(input);
    return this.lock(
      lockKey('begin', patientId, declared.idempotencyKey),
      async (metadata) => {
        this.available();
        const categoryId = await metadata.resolveCategory(declared.categoryId);
        if (!categoryId) throw new IntakeError(400);
        await this.authorize(authorize, patientId, 'upload', {
          kind: 'category',
          categoryId,
        });
        const previous = await metadata.findByIdempotency(
          patientId,
          declared.idempotencyKey,
        );
        if (previous) {
          if (
            previous.title !== declared.title ||
            previous.mimeType !== declared.mimeType ||
            previous.bytes !== declared.bytes ||
            previous.sha256 !== declared.sha256 ||
            previous.categoryId !== categoryId
          )
            throw new IntakeError(409);
          return result(previous);
        }
        const record: IntakeRecord = {
          ...declared,
          categoryId,
          patientId,
          uploadId: randomUUID(),
          documentId: randomUUID(),
          objectKey: randomUUID().replaceAll('-', ''),
          state: 'pending',
          createdAt: new Date(),
        };
        await metadata.create(record);
        return result(record);
      },
    );
  }

  async content(
    patientId: string,
    uploadId: string,
    bytes: Buffer,
    authorize: IntakeAuthorization,
  ): Promise<UploadResult> {
    // Copy before awaiting so a caller cannot mutate validated bytes during IO.
    if (!Buffer.isBuffer(bytes)) throw new IntakeError(400);
    if (bytes.length > maximumDocumentBytes) throw new IntakeError(413);
    const original = Buffer.from(bytes);
    return this.lock(
      lockKey('upload', patientId, uploadId),
      async (metadata) => {
        const record = await this.upload(
          metadata,
          patientId,
          uploadId,
          authorize,
        );
        this.available();
        validateBytes(original, record);
        if (record.state === 'ready') return result(record);
        // A retry first removes any partial or previous object under the same key.
        // Removal must be idempotent. Failure leaves the record non-READY.
        await this.fail(metadata, record);
        await metadata.setState(uploadId, 'pending');
        try {
          await this.objects.put(record.objectKey, original, record.mimeType);
        } catch {
          await this.fail(metadata, record);
          throw new IntakeError(503);
        }
        return result({ ...record, state: 'pending' });
      },
    );
  }

  async finalize(
    patientId: string,
    uploadId: string,
    authorize: IntakeAuthorization,
  ): Promise<UploadResult> {
    return this.lock(
      lockKey('upload', patientId, uploadId),
      async (metadata) => {
        const record = await this.upload(
          metadata,
          patientId,
          uploadId,
          authorize,
        );
        this.available();
        if (record.state === 'failed') throw new IntakeError(409);
        let bytes: Buffer;
        try {
          bytes = await this.objects.get(record.objectKey);
          validateBytes(bytes, record);
        } catch {
          // An existing READY record must not lose its object if the transaction
          // that records FAILED later rolls back. Leave it unavailable for review.
          if (record.state !== 'ready') await this.fail(metadata, record);
          throw new IntakeError(503);
        }
        // Revocation during object IO must stop finalization as well.
        await this.authorize(authorize, patientId, 'upload', {
          kind: 'category',
          categoryId: record.categoryId,
        });
        if (record.state === 'ready') return result(record);
        try {
          await metadata.setState(uploadId, 'ready');
        } catch {
          // Mark FAILED before compensation: if the READY write committed before
          // a connection failure, removing first could leave READY without bytes.
          await this.fail(metadata, record);
          throw new IntakeError(503);
        }
        return result({ ...record, state: 'ready' });
      },
    );
  }

  async read(
    patientId: string,
    documentId: string,
    action: 'view' | 'export',
    authorize: IntakeAuthorization,
  ): Promise<{ record: IntakeRecord; bytes: Buffer }> {
    if (action !== 'view' && action !== 'export') throw new IntakeError(404);
    return this.lock(
      lockKey('read', patientId, documentId),
      async (metadata) => {
        const record = await metadata.findDocument(patientId, documentId);
        if (
          !record ||
          record.patientId !== patientId ||
          record.documentId !== documentId
        )
          throw new IntakeError(404);
        await this.authorize(authorize, patientId, action, {
          kind: 'document',
          documentId,
        });
        if (record.state !== 'ready') throw new IntakeError(404);
        this.available();
        let bytes: Buffer;
        try {
          bytes = await this.objects.get(record.objectKey);
          validateBytes(bytes, record);
        } catch {
          throw new IntakeError(503);
        }
        await this.authorize(authorize, patientId, action, {
          kind: 'document',
          documentId,
        });
        return { record, bytes: Buffer.from(bytes) };
      },
    );
  }

  private available() {
    if (!this.objects.ready) throw new IntakeError(503);
  }

  private async upload(
    metadata: IntakeMetadata,
    patientId: string,
    uploadId: string,
    authorize: IntakeAuthorization,
  ): Promise<IntakeRecord> {
    const record = await metadata.findUpload(patientId, uploadId);
    if (
      !record ||
      record.patientId !== patientId ||
      record.uploadId !== uploadId
    )
      throw new IntakeError(404);
    await this.authorize(authorize, patientId, 'upload', {
      kind: 'category',
      categoryId: record.categoryId,
    });
    return record;
  }

  private async fail(metadata: IntakeMetadata, record: IntakeRecord) {
    // Never remove a potentially READY object unless FAILED is durably recorded.
    await metadata.setState(record.uploadId, 'failed');
    try {
      await this.objects.remove(record.objectKey);
    } catch {
      // FAILED retains the opaque key so a retry can safely retry compensation.
      throw new IntakeError(503);
    }
  }

  private async authorize(
    authorize: IntakeAuthorization,
    patientId: string,
    action: PermissionAction,
    target: PermissionScope,
  ) {
    try {
      await authorize(patientId, action, target);
    } catch (error) {
      throw new AuthorizationFailure(error);
    }
  }

  private async lock<T>(
    key: string,
    work: (metadata: IntakeMetadata) => Promise<T>,
  ): Promise<T> {
    let outcome: Outcome<T>;
    try {
      outcome = await this.store.withLock(key, async (metadata) => {
        try {
          return { value: await work(metadata) };
        } catch (error) {
          return { error };
        }
      });
    } catch {
      throw new IntakeError(503);
    }
    if ('error' in outcome) {
      if (outcome.error instanceof AuthorizationFailure)
        throw outcome.error.error;
      if (outcome.error instanceof IntakeError) throw outcome.error;
      throw new IntakeError(503);
    }
    return outcome.value;
  }
}
