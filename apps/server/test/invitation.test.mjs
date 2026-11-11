import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { permissionActions } from '@fmv/contracts';
import {
  generateInvitationToken,
  hashInvitationToken,
  isInvitationOpen,
  ProposalError,
  validateProposal,
} from '../dist/access/invitation.js';

const proposal = (extra = {}) => ({
  actions: ['view'],
  scope: { kind: 'patient' },
  expiresInHours: 24,
  ...extra,
});
const invalid = (value) =>
  assert.throws(
    () => validateProposal(value),
    (error) =>
      error instanceof ProposalError &&
      error.status === 400 &&
      error.message === 'The proposal is invalid.',
  );

test('generated invitation secrets contain 32 random bytes with distinct SHA256 digests', () => {
  const tokens = new Set();
  const hashes = new Set();
  for (let i = 0; i < 128; i++) {
    const { token, tokenHash } = generateInvitationToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(token, 'base64url').length, 32);
    assert.match(tokenHash, /^[a-f0-9]{64}$/);
    assert.equal(tokenHash, createHash('sha256').update(token).digest('hex'));
    assert.equal(hashInvitationToken(token), tokenHash);
    tokens.add(token);
    hashes.add(tokenHash);
  }
  assert.equal(tokens.size, 128);
  assert.equal(hashes.size, 128);
});

test('token hashes are deterministic over the exact secret and reject malformed inputs without coercion', () => {
  const valid = 'A'.repeat(43);
  const expected = createHash('sha256').update(valid).digest('hex');
  assert.equal(hashInvitationToken(valid), expected);
  assert.notEqual(hashInvitationToken('a'.repeat(43)), expected);
  for (const token of [
    null,
    undefined,
    43,
    true,
    {},
    [],
    new String(valid),
    Buffer.from(valid),
    '',
    'A'.repeat(42),
    'A'.repeat(44),
    `${valid}=`,
    `${valid}\n`,
    `${valid} `,
    ` ${valid}`,
    `${'A'.repeat(42)}+`,
    `${'A'.repeat(42)}/`,
    `${'A'.repeat(42)}é`,
  ])
    assert.equal(hashInvitationToken(token), null);
  assert.ok(hashInvitationToken('_'.repeat(43)));
  assert.ok(hashInvitationToken('-'.repeat(43)));
});

test('valid proposals preserve independent actions and narrowly typed UUID scopes', () => {
  const categoryId = randomUUID();
  const documentId = randomUUID();
  for (const scope of [
    { kind: 'patient' },
    { kind: 'category', categoryId },
    { kind: 'document', documentId },
  ])
    for (const expiresInHours of [1, 168]) {
      const input = proposal({
        actions: [...permissionActions],
        scope,
        expiresInHours,
      });
      assert.deepEqual(validateProposal(input), input);
    }
  assert.deepEqual(
    validateProposal(proposal({ actions: ['manage'] })).actions,
    ['manage'],
  );
  assert.deepEqual(validateProposal(proposal({ actions: ['view'] })).actions, [
    'view',
  ]);
});

test('proposal output is detached from caller arrays and scope and never includes identities', () => {
  const input = proposal({
    scope: { kind: 'document', documentId: randomUUID() },
  });
  const originalDocumentId = input.scope.documentId;
  const output = validateProposal(input);
  input.actions.push('export');
  input.scope.documentId = randomUUID();
  assert.deepEqual(output.actions, ['view']);
  assert.equal(output.scope.documentId, originalDocumentId);
  assert.deepEqual(Object.keys(output).sort(), [
    'actions',
    'expiresInHours',
    'scope',
  ]);
  invalid(proposal({ patientId: randomUUID() }));
  invalid(proposal({ recipientAccountId: randomUUID() }));
  invalid(proposal({ email: 'synthetic@example.test' }));
});

test('empty, duplicate, unknown or malformed actions fail without implicitly granting permissions', () => {
  for (const actions of [
    [],
    ['view', 'view'],
    ['view', 'export', 'view'],
    ['admin'],
    ['download'],
    ['VIEW'],
    [' view'],
    ['view', null],
    [1],
    'view',
    null,
    {},
    ['view', 'upload', 'edit', 'export', 'manage', 'other'],
    Array(1),
  ])
    invalid(proposal({ actions }));
});

test('scope discriminants, UUIDs and extra fields fail closed', () => {
  for (const scope of [
    null,
    [],
    'patient',
    {},
    { kind: 'household' },
    { kind: 'patient', patientId: randomUUID() },
    { kind: 'patient', documentId: randomUUID() },
    { kind: 'category' },
    { kind: 'document' },
    { kind: 'category', categoryId: 'unclassified' },
    { kind: 'document', documentId: '00000000-0000-0000-0000-000000000000' },
    { kind: 'category', categoryId: 123 },
    { kind: 'document', documentId: ` ${randomUUID()}` },
    { kind: 'category', categoryId: randomUUID(), documentId: randomUUID() },
    { kind: 'document', documentId: randomUUID(), categoryId: randomUUID() },
  ])
    invalid(proposal({ scope }));
  const id = randomUUID().toUpperCase();
  assert.equal(
    validateProposal(proposal({ scope: { kind: 'document', documentId: id } }))
      .scope.documentId,
    id,
  );
});

test('expiry accepts only integer hours from 1 through 168', () => {
  for (const expiresInHours of [
    0,
    -1,
    169,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
    '24',
    null,
    undefined,
    true,
    {},
    [],
  ])
    invalid(proposal({ expiresInHours }));
});

test('missing, inherited, accessor and unknown proposal fields return one sanitized error', () => {
  for (const input of [
    null,
    undefined,
    true,
    1,
    '',
    [],
    {},
    new Date(),
    { actions: ['view'] },
  ])
    invalid(input);
  invalid(Object.create(proposal()));
  const unknown = proposal();
  unknown[Symbol('sensitive fixture')] = 'synthetic confidential input';
  invalid(unknown);
  const accessor = proposal();
  Object.defineProperty(accessor, 'actions', {
    get() {
      throw new Error('synthetic sensitive data');
    },
    enumerable: true,
  });
  invalid(accessor);
  assert.deepEqual(
    validateProposal(Object.assign(Object.create(null), proposal())),
    proposal(),
  );
});

test('only pending invitations strictly before their expiry are open', () => {
  const now = new Date('2026-11-10T00:00:00.000Z');
  const future = new Date(now.getTime() + 1);
  const invitation = { state: 'pending', expiresAt: future };
  assert.equal(isInvitationOpen(invitation, now), true);
  for (const expiresAt of [
    new Date(now),
    new Date(now.getTime() - 1),
    new Date(Number.NaN),
  ])
    assert.equal(isInvitationOpen({ state: 'pending', expiresAt }, now), false);
  for (const state of ['accepted', 'revoked', 'unknown'])
    assert.equal(isInvitationOpen({ state, expiresAt: future }, now), false);
  assert.equal(isInvitationOpen(invitation, new Date(Number.NaN)), false);
  assert.equal(
    isInvitationOpen(
      { state: 'pending', expiresAt: future.toISOString() },
      now,
    ),
    false,
  );
  assert.equal(invitation.state, 'pending');
  assert.equal(invitation.expiresAt, future);
});
