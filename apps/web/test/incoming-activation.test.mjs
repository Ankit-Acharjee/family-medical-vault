import assert from 'node:assert/strict';
import test from 'node:test';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import {
  isProfileActivationList,
  isIssuedProfileActivation,
  isActivationInspection,
  isActivationClaimStatus,
} from '@fmv/contracts';
const source = ts
  .transpileModule(
    await readFile(
      new URL(
        '../src/features/activation/incoming-activation.ts',
        import.meta.url,
      ),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  )
  .outputText.replaceAll(
    "'@fmv/contracts'",
    JSON.stringify(import.meta.resolve('@fmv/contracts')),
  );
const token = 'a'.repeat(43),
  id = '11111111-1111-4111-8111-111111111111',
  ref = '22222222-2222-4222-8222-222222222222';
let api,
  rewritten = '';
const previous = globalThis.window;
try {
  globalThis.window = {
    location: { hash: '#activate=' + token, pathname: '/app' },
    history: {
      replaceState(_a, _b, value) {
        rewritten = value;
      },
    },
  };
  api = await import(
    'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  );
} finally {
  if (previous === undefined) delete globalThis.window;
  else globalThis.window = previous;
}
test('activation secret is removed before rendering and seed references can be cleared without browser storage', () => {
  assert.equal(rewritten, '/app#activate');
  assert.equal(api.incomingActivationSeed().token, token);
  api.clearActivationSeed();
  assert.equal(api.incomingActivationSeed(), null);
  for (const hash of [
    '#activate',
    '#activate=short',
    '#activate=' + token + '&x=1',
  ])
    assert.deepEqual(api.parseIncomingActivation(hash), {
      active: true,
      token: null,
    });
  assert.equal(api.parseIncomingActivation('#auth-login'), null);
  const url = new URL(
    api.activationUrl('https://example.test/app?private=value#old', token),
  );
  assert.equal(url.search, '');
  assert.equal(url.hash, '#activate=' + token);
  assert.equal(url.pathname, '/app');
  assert.throws(() =>
    api.activationUrl('https://user:pass@example.test', token),
  );
});
test('activation responses reject recovered replay secrets, mixed scopes and malformed claimant identities', () => {
  const row = {
    id,
    patientId: id,
    state: 'pending',
    claimantRef: null,
    createdAt: '2026-11-19T00:00:00.000Z',
    expiresAt: '2026-11-20T00:00:00.000Z',
  };
  assert.ok(
    isProfileActivationList({
      patientId: id,
      activations: [row],
      limited: false,
    }),
  );
  assert.equal(
    isProfileActivationList({
      patientId: ref,
      activations: [row],
      limited: false,
    }),
    false,
  );
  assert.equal(
    isProfileActivationList({
      patientId: id,
      activations: [row, row],
      limited: false,
    }),
    false,
  );
  assert.ok(
    isIssuedProfileActivation({ activation: row, token, created: true }),
  );
  assert.equal(
    isIssuedProfileActivation({ activation: row, token, created: false }),
    false,
  );
  assert.ok(
    isActivationInspection({
      patientId: id,
      patientName: 'Synthetic',
      expiresAt: row.expiresAt,
      claimantRef: null,
      state: 'pending',
    }),
  );
  assert.equal(
    isActivationInspection({
      patientId: id,
      patientName: 'Synthetic',
      expiresAt: row.expiresAt,
      claimantRef: null,
      state: 'claimed',
    }),
    false,
  );
  assert.ok(
    isActivationClaimStatus({
      patientId: id,
      claimantRef: ref,
      state: 'accepted',
    }),
  );
  assert.equal(
    isActivationClaimStatus({
      patientId: id,
      claimantRef: 'email@example.test',
      state: 'claimed',
    }),
    false,
  );
});
