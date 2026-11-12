import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  BeginUpload,
  DocumentsResult,
  DocumentSummary,
  PermissionAction,
} from '@fmv/contracts';
import { PermissionService, isUuid } from '../access/permission.service.js';
import type { AccessSnapshot } from '../access/access.store.js';
import type { Principal } from '../identity/person.store.js';
import { DocumentIntake } from './intake.js';
import type { IntakeRecord } from './intake.js';
import { DocumentStore } from './document.store.js';
import type { ObjectStore } from './object-store.js';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly permissions: PermissionService,
    private readonly store: DocumentStore,
    private readonly objects: ObjectStore,
  ) {}
  private permitted(s: AccessSnapshot, action?: PermissionAction) {
    return (
      s.patient?.ownerAccountId === s.accountId ||
      s.grants.some(
        (g) =>
          g.patientId === s.patient?.id &&
          g.granteeAccountId === s.accountId &&
          !g.revokedAt &&
          (!g.expiresAt || g.expiresAt > s.now) &&
          (!action || g.actions.includes(action)),
      )
    );
  }
  private async intake(principal: Principal, patientId: string) {
    const s = await this.permissions.snapshot(principal, patientId);
    if (!this.permitted(s)) throw new NotFoundException();
    return {
      core: new DocumentIntake(this.store.asActor(s.accountId!), this.objects),
      authorize: async (
        p: string,
        a: PermissionAction,
        t: Parameters<PermissionService['require']>[3],
      ) => {
        await this.permissions.require(principal, p, a, t);
      },
    };
  }
  async list(
    principal: Principal,
    patientId: string,
  ): Promise<DocumentsResult> {
    const s = await this.permissions.snapshot(principal, patientId);
    if (!this.permitted(s)) throw new NotFoundException();
    let rows: (IntakeRecord & { displayTitle?: string | null })[];
    let categories: { id: string; name: string }[];
    try {
      rows = await this.store.list(patientId);
      categories = await this.store.categories();
    } catch {
      throw new ServiceUnavailableException();
    }
    // Re-read current grants after metadata IO; upload-only users receive readiness,
    // not document names or clinical metadata.
    const current = await this.permissions.snapshot(principal, patientId);
    if (!this.permitted(current)) throw new NotFoundException();
    const documents: DocumentSummary[] = rows
      .map((r) => ({
        id: r.documentId,
        patientId: r.patientId,
        title: r.displayTitle ?? r.title,
        originalTitle: r.title,
        categoryName:
          categories.find((c) => c.id === r.categoryId)?.name ?? 'Unclassified',
        mimeType: r.mimeType,
        bytes: r.bytes,
        createdAt: r.createdAt.toISOString(),
        categoryId: r.categoryId,
        canEdit: this.permissions.allows(
          current,
          'edit',
          { kind: 'document', documentId: r.documentId },
          {
            id: r.documentId,
            patientId: r.patientId,
            categoryId: r.categoryId,
            state: r.state,
          },
        ),
        canView: this.permissions.allows(
          current,
          'view',
          { kind: 'document', documentId: r.documentId },
          {
            id: r.documentId,
            patientId: r.patientId,
            categoryId: r.categoryId,
            state: r.state,
          },
        ),
        canExport: this.permissions.allows(
          current,
          'export',
          { kind: 'document', documentId: r.documentId },
          {
            id: r.documentId,
            patientId: r.patientId,
            categoryId: r.categoryId,
            state: r.state,
          },
        ),
      }))
      .filter((r) => r.canView || r.canExport);
    return { documents, storageReady: this.objects.ready };
  }
  async rename(
    principal: Principal,
    patientId: string,
    documentId: string,
    input: unknown,
  ) {
    if (!isUuid(documentId)) throw new NotFoundException();
    const target = { kind: 'document' as const, documentId };
    const actor = await this.permissions.require(
      principal,
      patientId,
      'edit',
      target,
    );
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).length !== 1 ||
      !Object.hasOwn(input, 'title') ||
      typeof (input as { title: unknown }).title !== 'string'
    )
      throw new BadRequestException();
    const raw = (input as { title: string }).title;
    const title = raw.trim();
    if (
      !title ||
      title.length > 200 ||
      Array.from(raw).some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || (code >= 127 && code <= 159);
      })
    )
      throw new BadRequestException();
    const authorize = async () => {
      await this.permissions.require(principal, patientId, 'edit', target);
    };
    try {
      if (
        !(await this.store.rename(
          patientId,
          documentId,
          title,
          actor.accountId,
          authorize,
        ))
      )
        throw new NotFoundException();
    } catch (e) {
      if (
        e instanceof NotFoundException ||
        e instanceof ServiceUnavailableException
      )
        throw e;
      throw new ServiceUnavailableException();
    }
    return { saved: true as const };
  }
  async categories(principal: Principal, patientId: string) {
    const s = await this.permissions.snapshot(principal, patientId);
    if (!this.permitted(s, 'upload')) throw new NotFoundException();
    try {
      return {
        categories: (await this.store.categories()).filter((c) =>
          this.permissions.allows(s, 'upload', {
            kind: 'category',
            categoryId: c.id,
          }),
        ),
      };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
  async begin(principal: Principal, patientId: string, input: BeginUpload) {
    const i = await this.intake(principal, patientId);
    return i.core.begin(patientId, input, i.authorize);
  }
  async content(
    principal: Principal,
    patientId: string,
    uploadId: string,
    bytes: Buffer,
  ) {
    if (!isUuid(uploadId)) throw new NotFoundException();
    const i = await this.intake(principal, patientId);
    return i.core.content(patientId, uploadId, bytes, i.authorize);
  }
  async finalize(principal: Principal, patientId: string, uploadId: string) {
    if (!isUuid(uploadId)) throw new NotFoundException();
    const i = await this.intake(principal, patientId);
    return i.core.finalize(patientId, uploadId, i.authorize);
  }
  async read(
    principal: Principal,
    patientId: string,
    documentId: string,
    action: 'view' | 'export',
  ) {
    if (!isUuid(documentId)) throw new NotFoundException();
    const i = await this.intake(principal, patientId);
    const result = await i.core.read(
      patientId,
      documentId,
      action,
      i.authorize,
    );
    const actor = await this.permissions.require(principal, patientId, action, {
      kind: 'document',
      documentId,
    });
    try {
      await this.store.audit(
        patientId,
        documentId,
        actor.accountId,
        action === 'view' ? 'document.viewed' : 'document.exported',
      );
    } catch {
      throw new ServiceUnavailableException();
    }
    await i.authorize(patientId, action, { kind: 'document', documentId });
    return result;
  }
}
