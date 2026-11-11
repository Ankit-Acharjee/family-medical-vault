import { createHash, randomBytes } from 'node:crypto';
import { permissionActions } from '@fmv/contracts';
import type { PermissionAction, PermissionScope } from '@fmv/contracts';

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function hashInvitationToken(token: unknown): string | null {
  if (
    typeof token !== 'string' ||
    token.length !== 43 ||
    !tokenPattern.test(token)
  )
    return null;
  return createHash('sha256').update(token).digest('hex');
}

export function generateInvitationToken(): {
  token: string;
  tokenHash: string;
} {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInvitationToken(token)! };
}

export class ProposalError extends Error {
  readonly status = 400;
  constructor() {
    super('The proposal is invalid.');
    this.name = 'ProposalError';
  }
}

export type InvitationProposal = {
  actions: PermissionAction[];
  scope: PermissionScope;
  expiresInHours: number;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ProposalError();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new ProposalError();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key)) ||
    keys.some(
      (key) =>
        !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'),
    )
  )
    throw new ProposalError();
}

// Validates only the displayed proposal. Patient/recipient identity and the
// issuer's current delegation authority must be resolved by the caller.
export function validateProposal(input: unknown): InvitationProposal {
  try {
    const proposal = record(input);
    exactKeys(proposal, ['actions', 'scope', 'expiresInHours']);
    const { actions, expiresInHours } = proposal;
    if (
      !Array.isArray(actions) ||
      actions.length < 1 ||
      actions.length > permissionActions.length ||
      new Set(actions).size !== actions.length ||
      ![...actions].every(
        (action: unknown) =>
          typeof action === 'string' &&
          permissionActions.includes(action as PermissionAction),
      ) ||
      typeof expiresInHours !== 'number' ||
      !Number.isInteger(expiresInHours) ||
      expiresInHours < 1 ||
      expiresInHours > 168
    )
      throw new ProposalError();
    const scopeInput = record(proposal.scope);
    let scope: PermissionScope;
    if (scopeInput.kind === 'patient') {
      exactKeys(scopeInput, ['kind']);
      scope = { kind: 'patient' };
    } else if (scopeInput.kind === 'category') {
      exactKeys(scopeInput, ['kind', 'categoryId']);
      if (
        typeof scopeInput.categoryId !== 'string' ||
        scopeInput.categoryId.length !== 36 ||
        !uuidPattern.test(scopeInput.categoryId)
      )
        throw new ProposalError();
      scope = { kind: 'category', categoryId: scopeInput.categoryId };
    } else if (scopeInput.kind === 'document') {
      exactKeys(scopeInput, ['kind', 'documentId']);
      if (
        typeof scopeInput.documentId !== 'string' ||
        scopeInput.documentId.length !== 36 ||
        !uuidPattern.test(scopeInput.documentId)
      )
        throw new ProposalError();
      scope = { kind: 'document', documentId: scopeInput.documentId };
    } else throw new ProposalError();
    return {
      actions: [...actions] as PermissionAction[],
      scope,
      expiresInHours,
    };
  } catch {
    throw new ProposalError();
  }
}

export function isInvitationOpen(
  invitation: { state: 'pending' | 'accepted' | 'revoked'; expiresAt: Date },
  now: Date,
): boolean {
  return (
    invitation.state === 'pending' &&
    invitation.expiresAt instanceof Date &&
    now instanceof Date &&
    Number.isFinite(now.getTime()) &&
    invitation.expiresAt.getTime() > now.getTime()
  );
}
