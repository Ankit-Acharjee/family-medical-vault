import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  BeginUpload,
  DocumentsResult,
  DocumentSummary,
  PermissionAction,
  UploadResult,
  TrashDocumentsResult,
} from '@fmv/contracts';
import { PermissionService, isUuid } from '../access/permission.service.js';
import type { AccessSnapshot } from '../access/access.store.js';
import type { Principal } from '../identity/person.store.js';
import { DocumentIntake } from './intake.js';
import type { IntakeRecord } from './intake.js';
import { DocumentStore } from './document.store.js';
import { ExtractionService } from './extraction.service.js';
import type { ObjectStore } from './object-store.js';

@Injectable()
export class DocumentsService {
  readonly extraction: ExtractionService;
  constructor(
    private readonly permissions: PermissionService,
    private readonly store: DocumentStore,
    private readonly objects: ObjectStore,
  ) {
    this.extraction = new ExtractionService(permissions, store);
  }
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
      .filter(
        (r) => !r.deletedAt && r.patientId === patientId && r.state === 'ready',
      )
      .map((r) => this.summary(r, current, categories))
      .filter((r) => r.canView || r.canExport);
    return { documents, storageReady: this.objects.ready };
  }
  private summary(
    r: IntakeRecord & { displayTitle?: string | null },
    current: AccessSnapshot,
    categories: { id: string; name: string }[],
    includeTrashed = false,
  ): DocumentSummary {
    const resource = {
      id: r.documentId,
      patientId: r.patientId,
      categoryId: r.categoryId,
      state: r.state,
      deletedAt: r.deletedAt ?? null,
    };
    const target = { kind: 'document' as const, documentId: r.documentId };
    return {
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
        target,
        resource,
        includeTrashed,
      ),
      canView: this.permissions.allows(
        current,
        'view',
        target,
        resource,
        includeTrashed,
      ),
      canExport: this.permissions.allows(
        current,
        'export',
        target,
        resource,
        includeTrashed,
      ),
    };
  }
  async listTrash(
    principal: Principal,
    patientId: string,
  ): Promise<TrashDocumentsResult> {
    const initial = await this.permissions.snapshot(principal, patientId);
    if (!this.permitted(initial)) throw new NotFoundException();
    let rows: (IntakeRecord & { displayTitle?: string | null })[],
      categories: { id: string; name: string }[];
    try {
      rows = await this.store.listTrash(patientId);
      categories = await this.store.categories();
    } catch {
      throw new ServiceUnavailableException();
    }
    const current = await this.permissions.snapshot(principal, patientId);
    if (!this.permitted(current)) throw new NotFoundException();
    return {
      documents: rows.flatMap((r) => {
        if (!r.deletedAt || r.patientId !== patientId || r.state !== 'ready')
          return [];
        // Trash exposes metadata only, and requires edit plus independent read/export.
        const summary = this.summary(r, current, categories, true);
        if (!summary.canEdit || !(summary.canView || summary.canExport))
          return [];
        const deadline = new Date(
          r.deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000,
        );
        return [
          {
            ...summary,
            canView: false,
            canExport: false,
            canEdit: false,
            deletedAt: r.deletedAt.toISOString(),
            restoreUntil: deadline.toISOString(),
            canRestore: current.now.getTime() < deadline.getTime(),
          },
        ];
      }),
    };
  }
  async changeTrash(
    principal: Principal,
    patientId: string,
    documentId: string,
    action: 'trash' | 'restore',
    input: unknown,
  ) {
    if (!isUuid(documentId)) throw new NotFoundException();
    const target = { kind: 'document' as const, documentId };
    const actor = await this.permissions.require(
      principal,
      patientId,
      'edit',
      target,
      true,
    );
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).length
    )
      throw new BadRequestException();
    const authorize = async () => {
      await this.permissions.require(
        principal,
        patientId,
        'edit',
        target,
        true,
      );
    };
    try {
      const outcome = await this.store.changeTrash(
        patientId,
        documentId,
        action,
        actor.accountId,
        authorize,
      );
      if (outcome === 'missing') throw new NotFoundException();
      if (outcome === 'expired')
        throw new ConflictException('Recovery is unavailable.');
    } catch (e) {
      if (
        e instanceof NotFoundException ||
        e instanceof ConflictException ||
        e instanceof ServiceUnavailableException
      )
        throw e;
      throw new ServiceUnavailableException();
    }
    return { saved: true as const };
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
    const result = await i.core.begin(patientId, input, i.authorize);
    return result.state === 'ready'
      ? this.duplicateWarning(principal, patientId, result)
      : result;
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
    const result = await i.core.finalize(patientId, uploadId, i.authorize);
    return this.duplicateWarning(principal, patientId, result);
  }
  private async duplicateWarning(
    principal: Principal,
    patientId: string,
    result: UploadResult,
  ): Promise<UploadResult> {
    // Advisory metadata only: never fetch, remove or reuse another original.
    // A lookup failure cannot turn a committed READY original into FAILED.
    let rows: IntakeRecord[];
    try {
      rows = await this.store.list(patientId);
    } catch {
      await this.permissions.require(principal, patientId, 'upload', {
        kind: 'document',
        documentId: result.documentId,
      });
      return result;
    }
    await this.permissions.require(principal, patientId, 'upload', {
      kind: 'document',
      documentId: result.documentId,
    });
    const current = await this.permissions.snapshot(principal, patientId);
    const source = rows.find(
      (r) =>
        r.patientId === patientId &&
        r.documentId === result.documentId &&
        r.uploadId === result.uploadId &&
        r.state === 'ready' &&
        !r.deletedAt,
    );
    if (!source) return result;
    const resource = (r: IntakeRecord) => ({
      id: r.documentId,
      patientId: r.patientId,
      categoryId: r.categoryId,
      state: r.state,
      deletedAt: r.deletedAt ?? null,
    });
    if (
      !this.permissions.allows(
        current,
        'upload',
        { kind: 'document', documentId: source.documentId },
        resource(source),
      )
    )
      throw new NotFoundException();
    const match = rows.some(
      (r) =>
        r.patientId === patientId &&
        r.state === 'ready' &&
        !r.deletedAt &&
        r.documentId !== source.documentId &&
        r.sha256 === source.sha256 &&
        r.bytes === source.bytes &&
        (this.permissions.allows(
          current,
          'view',
          { kind: 'document', documentId: r.documentId },
          resource(r),
        ) ||
          this.permissions.allows(
            current,
            'export',
            { kind: 'document', documentId: r.documentId },
            resource(r),
          )),
    );
    // No existence signal at all for upload-only users or hidden matches.
    return match ? { ...result, potentialDuplicate: true } : result;
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
