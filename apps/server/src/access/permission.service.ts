import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { permissionActions } from '@fmv/contracts';
import type {
  PermissionAction,
  PermissionScope,
  PatientsResult,
} from '@fmv/contracts';
import type { Principal } from '../identity/person.store.js';
import { AccessStore } from './access.store.js';
import type { AccessSnapshot, DocumentAuthority } from './access.store.js';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 && uuid.test(value);
}

function isScope(value: unknown): value is PermissionScope {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Object.hasOwn(value, 'kind')
  )
    return false;
  const scope = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(scope);
  switch (scope.kind) {
    case 'patient':
      return keys.length === 1;
    case 'category':
      return (
        keys.length === 2 &&
        Object.hasOwn(scope, 'categoryId') &&
        isUuid(scope.categoryId)
      );
    case 'document':
      return (
        keys.length === 2 &&
        Object.hasOwn(scope, 'documentId') &&
        isUuid(scope.documentId)
      );
    default:
      return false;
  }
}

@Injectable()
export class PermissionService {
  constructor(private readonly store: AccessStore) {}
  async patients(principal: Principal): Promise<PatientsResult> {
    try {
      return { patients: await this.store.list(principal) };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
  async snapshot(
    principal: Principal,
    patientId: string,
  ): Promise<AccessSnapshot> {
    if (!isUuid(patientId)) throw new NotFoundException();
    let snapshot: AccessSnapshot;
    try {
      snapshot = await this.store.load(principal, patientId);
    } catch {
      throw new ServiceUnavailableException();
    }
    if (
      !snapshot.accountId ||
      !snapshot.patient ||
      snapshot.patient.id !== patientId
    )
      throw new NotFoundException();
    return snapshot;
  }
  allows(
    snapshot: AccessSnapshot,
    action: PermissionAction,
    target: PermissionScope,
    resource?: DocumentAuthority,
  ): boolean {
    if (
      !permissionActions.includes(action) ||
      !isScope(target) ||
      !snapshot.patient ||
      !snapshot.accountId
    )
      return false;
    if (
      target.kind === 'document' &&
      (!resource ||
        resource.id !== target.documentId ||
        resource.patientId !== snapshot.patient.id)
    )
      return false;
    if (snapshot.patient.ownerAccountId === snapshot.accountId) return true;
    return snapshot.grants.some(
      (g) =>
        isScope(g.scope) &&
        g.patientId === snapshot.patient!.id &&
        g.granteeAccountId === snapshot.accountId &&
        g.revokedAt === null &&
        (g.expiresAt === null ||
          g.expiresAt.getTime() > snapshot.now.getTime()) &&
        g.actions.includes(action) &&
        (g.scope.kind === 'patient' ||
          (target.kind === 'category' &&
            g.scope.kind === 'category' &&
            target.categoryId === g.scope.categoryId) ||
          (target.kind === 'document' &&
            ((g.scope.kind === 'document' &&
              target.documentId === g.scope.documentId) ||
              (g.scope.kind === 'category' &&
                resource?.categoryId === g.scope.categoryId)))),
    );
  }
  async require(
    principal: Principal,
    patientId: string,
    action: PermissionAction,
    target: PermissionScope = { kind: 'patient' },
  ) {
    if (!permissionActions.includes(action) || !isScope(target))
      throw new NotFoundException();
    const snapshot = await this.snapshot(principal, patientId);
    let resource: DocumentAuthority | undefined;
    try {
      if (target.kind === 'document') {
        if (!isUuid(target.documentId)) throw new NotFoundException();
        resource = (await this.store.document(target.documentId)) ?? undefined;
        if (!resource || resource.patientId !== patientId)
          throw new NotFoundException();
      } else if (target.kind === 'category') {
        if (
          !isUuid(target.categoryId) ||
          !(await this.store.category(target.categoryId))
        )
          throw new NotFoundException();
      }
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new ServiceUnavailableException();
    }
    if (!this.allows(snapshot, action, target, resource))
      throw new NotFoundException();
    return { accountId: snapshot.accountId!, patientId };
  }
}
