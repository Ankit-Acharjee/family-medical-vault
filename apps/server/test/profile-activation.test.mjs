import { documentSetup } from './support/document-fixture.mjs';
import { ProfileActivationService } from '../dist/identity/profile-activation.service.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  isIssueProfileActivation,
  isApproveProfileActivation,
} from '@fmv/contracts';
import { hashActivationToken } from '../dist/identity/profile-activation.service.js';
import { opaque, digest } from '../dist/auth/auth.crypto.js';
test('activation requests require explicit bounded expiry and exact claimant confirmation', () => {
  const issue = {
    requestId: randomUUID(),
    expiresInHours: 24,
    confirmed: true,
  };
  assert.ok(isIssueProfileActivation(issue));
  for (const patch of [
    { expiresInHours: 0 },
    { expiresInHours: 169 },
    { expiresInHours: 1.5 },
    { confirmed: false },
    { ownerAccountId: randomUUID() },
  ])
    assert.equal(isIssueProfileActivation({ ...issue, ...patch }), false);
  const approval = {
    requestId: randomUUID(),
    claimantRef: randomUUID(),
    confirmed: true,
  };
  assert.ok(isApproveProfileActivation(approval));
  for (const patch of [
    { claimantRef: 'email@example.test' },
    { confirmed: false },
    { patientId: randomUUID() },
  ])
    assert.equal(isApproveProfileActivation({ ...approval, ...patch }), false);
});
test('activation capability hash is purpose-separated and malformed secrets are not lookup keys', () => {
  const token = opaque();
  assert.equal(
    hashActivationToken(token),
    digest('fmv-profile-activation-v1:' + token),
  );
  assert.notEqual(hashActivationToken(token), digest(token));
  for (const value of [null, {}, 'short', token + 'extra'])
    assert.equal(hashActivationToken(value), null);
});

test('activation endpoints require verified sessions and CSRF, with body-only capability and explicit claim confirmation', async () =>
  documentSetup(async (f) => {
    const service = f.app.get(ProfileActivationService),
      calls = [];
    for (const name of [
      'issue',
      'list',
      'approve',
      'revoke',
      'inspect',
      'claim',
      'status',
    ])
      service[name] = async (...args) => {
        calls.push({ name, args });
        return { synthetic: true };
      };
    const token = opaque(),
      paths = [
        '/api/profile-activation/inspect',
        '/api/profile-activation/claim',
        '/api/profile-activation/status',
      ];
    for (const path of paths)
      assert.equal(
        (await f.request('POST', path, undefined, { token, confirmed: true }))
          .status,
        401,
      );
    const session = await f.login();
    for (const path of paths) {
      assert.equal((await f.request('GET', path, session)).status, 404);
      assert.equal(
        (
          await f.request(
            'POST',
            path,
            session,
            { token },
            { 'X-CSRF-Token': undefined },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await f.request(
            'POST',
            path,
            session,
            { token },
            { Origin: 'https://other.example.test' },
          )
        ).status,
        403,
      );
    }
    assert.equal(calls.length, 0);
    assert.equal(
      (await f.request('POST', paths[1], session, { token })).status,
      400,
    );
    assert.equal(
      (
        await f.request('POST', paths[1], session, {
          token,
          confirmed: true,
          patientId: randomUUID(),
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.request('POST', paths[0], session, { token })).status,
      200,
    );
    assert.equal(
      (await f.request('POST', paths[1], session, { token, confirmed: true }))
        .status,
      200,
    );
    assert.equal(
      (await f.request('POST', paths[2], session, { token })).status,
      200,
    );
    const management = f.path('activations');
    assert.equal((await f.request('GET', management, session)).status, 200);
    assert.equal(
      (
        await f.request('POST', management, session, {
          requestId: randomUUID(),
          expiresInHours: 24,
          confirmed: true,
        })
      ).status,
      200,
    );
  }));
