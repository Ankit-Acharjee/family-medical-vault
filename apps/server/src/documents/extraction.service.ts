import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isSaveExtraction } from '@fmv/contracts';
import type { ExtractionReadResult } from '@fmv/contracts';
import { PermissionService, isUuid } from '../access/permission.service.js';
import type { Principal } from '../identity/person.store.js';
import type {
  DocumentStore,
  ExtractionAuthorization,
} from './document.store.js';

export class ExtractionService {
  constructor(
    private readonly permissions: PermissionService,
    private readonly store: DocumentStore,
  ) {}

  private authorize(
    principal: Principal,
    patientId: string,
    documentId: string,
    requireSave: boolean,
  ): ExtractionAuthorization {
    return async (source) => {
      if (
        source.patientId !== patientId ||
        source.documentId !== documentId ||
        source.state !== 'ready' ||
        source.deletedAt
      )
        throw new NotFoundException();
      // Both independent actions use the same current authoritative snapshot
      // and the original resource locked by the extraction transaction.
      const snapshot = await this.permissions.snapshot(principal, patientId);
      const resource = { ...source, id: source.documentId };
      const target = { kind: 'document' as const, documentId };
      const canView = this.permissions.allows(
        snapshot,
        'view',
        target,
        resource,
      );
      const canSave =
        canView && this.permissions.allows(snapshot, 'edit', target, resource);
      if (!canView || (requireSave && !canSave) || !snapshot.accountId)
        throw new NotFoundException();
      return { accountId: snapshot.accountId, canSave };
    };
  }

  private ids(patientId: string, documentId: string) {
    if (!isUuid(patientId) || !isUuid(documentId))
      throw new NotFoundException();
  }

  private failure(error: unknown): never {
    if (
      error instanceof NotFoundException ||
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof ServiceUnavailableException
    )
      throw error;
    throw new ServiceUnavailableException();
  }

  async read(
    principal: Principal,
    patientId: string,
    documentId: string,
    includeSnapshot = true,
    requireSave = false,
  ): Promise<ExtractionReadResult> {
    this.ids(patientId, documentId);
    try {
      const result = await this.store.readExtraction(
        patientId,
        documentId,
        this.authorize(principal, patientId, documentId, requireSave),
        includeSnapshot,
      );
      if (!result) throw new NotFoundException();
      return result;
    } catch (error) {
      this.failure(error);
    }
  }

  async save(
    principal: Principal,
    patientId: string,
    documentId: string,
    input: unknown,
  ) {
    this.ids(patientId, documentId);
    // Authenticate resource authority before revealing validation outcomes.
    await this.read(principal, patientId, documentId, false, true);
    if (!isSaveExtraction(input)) throw new BadRequestException();
    const authorize = this.authorize(principal, patientId, documentId, true);
    try {
      const outcome = await this.store.saveExtraction(
        patientId,
        documentId,
        input,
        async (source) => {
          const authority = await authorize(source);
          const pdf = source.mimeType === 'application/pdf';
          if ((input.result.method === 'image-ocr') === pdf)
            throw new BadRequestException();
          return authority;
        },
      );
      if (outcome === 'missing') throw new NotFoundException();
      if (outcome === 'conflict') throw new ConflictException();
      return outcome;
    } catch (error) {
      this.failure(error);
    }
  }
}
