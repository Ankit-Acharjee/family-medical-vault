import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { isCreateTemporaryLink } from '@fmv/contracts';
import {
  TemporaryLinksService,
  hashTemporaryLink,
} from '../dist/sharing/temporary-links.service.js';
import { opaque } from '../dist/auth/auth.crypto.js';
import { documentSetup } from './support/document-fixture.mjs';
const input = () => ({
  requestId: randomUUID(),
  documentIds: [randomUUID()],
  selectionSha256: 'a'.repeat(64),
  expiresInHours: 1,
  confirmed: true,
});
test('temporary link contracts require explicit exact bounded selection, expiry and confirmation', () => {
  const body = input();
  assert.equal(isCreateTemporaryLink(body), true);
  assert.equal(isCreateTemporaryLink({ ...body, expiresInHours: 168 }), true);
  for (const patch of [
    { expiresInHours: 0 },
    { expiresInHours: 169 },
    { expiresInHours: 1.5 },
    { confirmed: false },
    { documentIds: [] },
    { scope: 'patient' },
    { token: 'untrusted' },
    { selectionSha256: 'bad' },
  ])
    assert.equal(isCreateTemporaryLink({ ...body, ...patch }), false);
});
test('temporary capabilities use opaque domain-separated hashes; raw tokens are never lookup hashes', () => {
  const token = opaque(),
    hash = hashTemporaryLink(token);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hashTemporaryLink(token), hash);
  assert.notEqual(hashTemporaryLink(opaque()), hash);
  for (const bad of [null, {}, '', token + 'x', '../' + token])
    assert.equal(hashTemporaryLink(bad), null);
});
test('owner management HTTP endpoints enforce current session and Origin/CSRF; no anonymous route is exposed', async () =>
  documentSetup(async (f) => {
    const service = f.app.get(TemporaryLinksService),
      path = f.path('sharing-links'),
      calls = [];
    for (const name of ['prepare', 'create', 'list', 'revoke'])
      service[name] = async (...args) => {
        calls.push({ name, args });
        return { synthetic: true };
      };
    assert.equal(
      (await f.request('POST', path, undefined, input())).status,
      401,
    );
    const session = await f.login();
    assert.equal(
      (
        await f.request('POST', path, session, input(), {
          'X-CSRF-Token': undefined,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          'POST',
          path + '/prepare',
          session,
          {},
          { Origin: 'https://unapproved.example.test' },
        )
      ).status,
      403,
    );
    assert.equal(calls.length, 0);
    assert.equal((await f.request('POST', path, session, input())).status, 200);
    assert.equal((await f.request('GET', path, session)).status, 200);
    assert.equal(
      (
        await f.request(
          'POST',
          path + '/' + randomUUID() + '/revoke',
          session,
          {},
        )
      ).status,
      200,
    );
    assert.equal(calls.length, 3);
    assert.equal(
      (
        await f.request('POST', '/api/sharing/open', undefined, {
          token: opaque(),
        })
      ).status,
      404,
    );
    const response = await f.request('GET', path, session);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }));
