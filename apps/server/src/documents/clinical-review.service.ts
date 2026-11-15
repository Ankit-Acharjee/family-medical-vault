import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  clinicalHistoryCursor,
  isSaveClinicalReview,
  isWithdrawClinicalReview,
} from '@fmv/contracts';
import { PermissionService, isUuid } from '../access/permission.service.js';
import type { Principal } from '../identity/person.store.js';
import type { DocumentStore } from './document.store.js';
import type { ClinicalAuthorization } from './clinical-review.store.js';
export class ClinicalReviewService {
  constructor(
    private readonly permissions: PermissionService,
    private readonly store: DocumentStore,
  ) {}
  authorize(
    principal: Principal,
    p: string,
    d: string,
    verify = false,
  ): ClinicalAuthorization {
    return async (source) => {
      if (
        source.patientId !== p ||
        source.documentId !== d ||
        source.state !== 'ready' ||
        source.deletedAt
      )
        throw new NotFoundException();
      const s = await this.permissions.snapshot(principal, p);
      if (
        !s.accountId ||
        !this.permissions.allows(
          s,
          'view',
          { kind: 'document', documentId: d },
          { ...source, id: d },
        )
      )
        throw new NotFoundException();
      const canVerify = s.patient?.ownerAccountId === s.accountId;
      if (verify && !canVerify) throw new NotFoundException();
      return { accountId: s.accountId, canVerify };
    };
  }
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
  async read(principal: Principal, p: string, d: string, requireOwner = false) {
    this.ids(p, d);
    try {
      const r = await this.store.readClinicalReview(
        p,
        d,
        this.authorize(principal, p, d, requireOwner),
      );
      if (!r) throw new NotFoundException();
      return r;
    } catch (e) {
      this.failure(e);
    }
  }
  async history(principal: Principal, p: string, d: string, cursor: unknown) {
    this.ids(p, d);
    const before = clinicalHistoryCursor(cursor);
    if (before === null) throw new BadRequestException();
    try {
      const r = await this.store.readClinicalHistory(
        p,
        d,
        before,
        this.authorize(principal, p, d),
      );
      if (!r) throw new NotFoundException();
      return r;
    } catch (e) {
      this.failure(e);
    }
  }
  async withdraw(principal: Principal, p: string, d: string, input: unknown) {
    this.ids(p, d);
    await this.read(principal, p, d, true);
    if (!isWithdrawClinicalReview(input)) throw new BadRequestException();
    try {
      const result = await this.store.withdrawClinicalReview(
        p,
        d,
        input,
        this.authorize(principal, p, d, true),
      );
      if (result === 'missing') throw new NotFoundException();
      if (result === 'conflict') throw new ConflictException();
      return result;
    } catch (e) {
      this.failure(e);
    }
  }
  async save(principal: Principal, p: string, d: string, input: unknown) {
    this.ids(p, d);
    await this.read(principal, p, d, true);
    if (!isSaveClinicalReview(input)) throw new BadRequestException();
    try {
      const r = await this.store.saveClinicalReview(
        p,
        d,
        input,
        this.authorize(principal, p, d, true),
      );
      if (r === 'missing') throw new NotFoundException();
      if (r === 'conflict') throw new ConflictException();
      return r;
    } catch (e) {
      this.failure(e);
    }
  }
}
