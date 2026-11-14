import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isSaveMetadataSuggestions } from '@fmv/contracts';
import { isUuid } from '../access/permission.service.js';
import type { Principal } from '../identity/person.store.js';
import type { DocumentStore } from './document.store.js';
import type { ExtractionService } from './extraction.service.js';

export class MetadataSuggestionsService {
  constructor(
    private readonly extraction: ExtractionService,
    private readonly store: DocumentStore,
  ) {}
  private ids(p: string, d: string) {
    if (!isUuid(p) || !isUuid(d)) throw new NotFoundException();
  }
  private failure(e: unknown): never {
    if (
      e instanceof NotFoundException ||
      e instanceof BadRequestException ||
      e instanceof ConflictException ||
      e instanceof ServiceUnavailableException
    )
      throw e;
    throw new ServiceUnavailableException();
  }
  async read(principal: Principal, p: string, d: string) {
    this.ids(p, d);
    try {
      const result = await this.store.readMetadata(
        p,
        d,
        this.extraction.authorize(principal, p, d, false),
      );
      if (!result) throw new NotFoundException();
      return result;
    } catch (e) {
      this.failure(e);
    }
  }
  async save(principal: Principal, p: string, d: string, input: unknown) {
    this.ids(p, d);
    // Resource authority precedes detailed input validation.
    await this.extraction.read(principal, p, d, false, true);
    if (!isSaveMetadataSuggestions(input)) throw new BadRequestException();
    try {
      const result = await this.store.saveMetadata(
        p,
        d,
        input,
        this.extraction.authorize(principal, p, d, true),
      );
      if (result === 'missing') throw new NotFoundException();
      if (result === 'conflict') throw new ConflictException();
      return result;
    } catch (e) {
      this.failure(e);
    }
  }
}
