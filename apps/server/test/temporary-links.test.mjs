import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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
test('owner management HTTP endpoints enforce current session and Origin/CSRF; bearer access is a separate POST-only boundary', async () =>
  documentSetup(async (f) => {
    const service = f.app.get(TemporaryLinksService),
      path = f.path('sharing-links'),
      calls = [];
    for (const name of ['prepare', 'create', 'list', 'revoke'])
      service[name] = async (...args) => {
        calls.push({ name, args });
        return name === 'revoke'
          ? { revoked: true, protection: 'pending' }
          : { synthetic: true };
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
    const revocation = await f.request(
      'POST',
      path + '/' + randomUUID() + '/revoke',
      session,
      {},
    );
    assert.equal(revocation.status, 200);
    assert.deepEqual(await revocation.json(), {
      revoked: true,
      protection: 'pending',
    });
    assert.equal(calls.length, 3);
    assert.equal((await f.request('GET', '/api/sharing/open')).status, 404);
    const response = await f.request('GET', path, session);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }));

test('recipient POST endpoints use bearer-only scope with same-origin CSRF, private headers and no session principal', async () =>
  documentSetup(async (f) => {
    const service = f.app.get(TemporaryLinksService),
      token = opaque(),
      documentId = randomUUID(),
      calls = [];
    service.inspect = async (value) => {
      calls.push(value);
      return { synthetic: true };
    };
    service.readOriginal = async (...args) => {
      calls.push(args);
      return {
        bytes: Buffer.from('%PDF-1.7\nSynthetic shared original\n%%EOF'),
        mimeType: 'application/pdf',
      };
    };
    assert.equal(
      (
        await f.request(
          'POST',
          '/api/sharing/open',
          undefined,
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
          '/api/sharing/open',
          undefined,
          { token },
          { Origin: 'https://unapproved.example.test' },
        )
      ).status,
      403,
    );
    assert.equal(calls.length, 0);
    assert.equal(
      (
        await f.request('POST', '/api/sharing/open', undefined, {
          token,
          patientId: randomUUID(),
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.request('POST', '/api/sharing/open', undefined, { token }))
        .status,
      200,
    );
    assert.equal(calls[0], token);
    const response = await f.request(
      'POST',
      '/api/sharing/original',
      undefined,
      { token, documentId },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.ok(
      response.headers
        .get('content-disposition')
        .includes('shared-original.pdf'),
    );
    assert.ok(!response.headers.get('content-disposition').includes(token));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(calls[1][0], token);
    assert.equal(calls[1][1], documentId);
  }));
