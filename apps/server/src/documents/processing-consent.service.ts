import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  clinicalHistoryCursor,
  isSaveProcessingConsent,
  isWithdrawProcessingConsent,
} from '@fmv/contracts';
import type { Principal } from '../identity/person.store.js';
import { isUuid } from '../access/permission.service.js';
import type { DocumentStore } from './document.store.js';
import type { ClinicalReviewService } from './clinical-review.service.js';
export class ProcessingConsentService {
  constructor(
    private readonly clinical: ClinicalReviewService,
    private readonly store: DocumentStore,
  ) {}
  private ids(p: string, d: string) {
    if (!isUuid(p) || !isUuid(d)) throw new NotFoundException();
  }
  private fail(e: unknown): never {
    if (
      e instanceof BadRequestException ||
      e instanceof ConflictException ||
      e instanceof NotFoundException ||
      e instanceof ServiceUnavailableException
    )
      throw e;
    throw new ServiceUnavailableException();
  }
  async read(principal: Principal, p: string, d: string) {
    this.ids(p, d);
    try {
      const result = await this.store.readProcessingConsent(
        p,
        d,
        this.clinical.authorize(principal, p, d, true),
      );
      if (!result) throw new NotFoundException();
      return result;
    } catch (e) {
      this.fail(e);
    }
  }
  async history(principal: Principal, p: string, d: string, cursor: unknown) {
    this.ids(p, d);
    const before = clinicalHistoryCursor(cursor);
    if (before === null) throw new BadRequestException();
    try {
      const result = await this.store.readProcessingConsent(
        p,
        d,
        this.clinical.authorize(principal, p, d, true),
        before,
      );
      if (!result) throw new NotFoundException();
      return result;
    } catch (e) {
      this.fail(e);
    }
  }
  async write(
    principal: Principal,
    p: string,
    d: string,
    input: unknown,
    action: 'grant' | 'withdrawal',
  ) {
    this.ids(p, d);
    try {
      // Authorize against current source without listing provider policies:
      // retirement or catalog availability must never block withdrawal.
      const authorized = await this.store.readProcessingConsent(
        p,
        d,
        this.clinical.authorize(principal, p, d, true),
        1,
      );
      if (!authorized) throw new NotFoundException();
    } catch (e) {
      this.fail(e);
    }
    if (
      !(action === 'grant'
        ? isSaveProcessingConsent(input)
        : isWithdrawProcessingConsent(input))
    )
      throw new BadRequestException();
    try {
      const result = await this.store.writeProcessingConsent(
        p,
        d,
        input as
          | import('@fmv/contracts').SaveProcessingConsent
          | import('@fmv/contracts').WithdrawProcessingConsent,
        action,
        this.clinical.authorize(principal, p, d, true),
      );
      if (result === 'invalid') throw new BadRequestException();
      if (result === 'unavailable') throw new ServiceUnavailableException();
      if (result === 'missing') throw new NotFoundException();
      if (result === 'conflict') throw new ConflictException();
      return result;
    } catch (e) {
      this.fail(e);
    }
  }
}
