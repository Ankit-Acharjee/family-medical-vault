import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  clinicalHistoryCursor,
  isSaveDiagnosisReview,
  isWithdrawDiagnosisReview,
} from '@fmv/contracts';
import type { Principal } from '../identity/person.store.js';
import { isUuid } from '../access/permission.service.js';
import type { DocumentStore } from './document.store.js';
import type { ClinicalReviewService } from './clinical-review.service.js';
export class DiagnosisReviewService {
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
  async read(principal: Principal, p: string, d: string, owner = false) {
    this.ids(p, d);
    try {
      const result = await this.store.readDiagnosisReview(
        p,
        d,
        this.clinical.authorize(principal, p, d, owner),
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
      const result = await this.store.readDiagnosisReview(
        p,
        d,
        this.clinical.authorize(principal, p, d),
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
    action: 'confirmation' | 'withdrawal',
  ) {
    await this.read(principal, p, d, true);
    if (
      !(action === 'confirmation'
        ? isSaveDiagnosisReview(input)
        : isWithdrawDiagnosisReview(input))
    )
      throw new BadRequestException();
    try {
      const result = await this.store.writeDiagnosisReview(
        p,
        d,
        input as
          | import('@fmv/contracts').SaveDiagnosisReview
          | import('@fmv/contracts').WithdrawDiagnosisReview,
        action,
        this.clinical.authorize(principal, p, d, true),
      );
      if (result === 'missing') throw new NotFoundException();
      if (result === 'conflict') throw new ConflictException();
      return result;
    } catch (e) {
      this.fail(e);
    }
  }
}
