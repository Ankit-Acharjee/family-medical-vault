import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { isCreateManagedProfile } from '@fmv/contracts';
import { ManagedProfilesService } from '../dist/identity/managed-profiles.service.js';
import { documentSetup } from './support/document-fixture.mjs';
test('managed creation requires explicit bounded identity and caregiver confirmation', () => {
  const b = {
    requestId: randomUUID(),
    displayName: 'SYNTHETIC person',
    confirmed: true,
  };
  assert.ok(isCreateManagedProfile(b));
  for (const patch of [
    { displayName: '' },
    { displayName: ' padded ' },
    { displayName: 'x'.repeat(101) },
    { displayName: 'new\nline' },
    { confirmed: false },
    { owner: true },
    { dob: '2020-01-01' },
  ])
    assert.equal(isCreateManagedProfile({ ...b, ...patch }), false);
});
test('managed creation requires current verified session and same-origin CSRF', async () =>
  documentSetup(async (f) => {
    const service = f.app.get(ManagedProfilesService),
      calls = [];
    service.create = async (...args) => {
      calls.push(args);
      return { synthetic: true };
    };
    const path = '/api/patients/managed',
      body = {
        requestId: randomUUID(),
        displayName: 'SYNTHETIC person',
        confirmed: true,
      };
    assert.equal((await f.request('POST', path, undefined, body)).status, 401);
    const session = await f.login();
    assert.equal(
      (
        await f.request('POST', path, session, body, {
          'X-CSRF-Token': undefined,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request('POST', path, session, body, {
          Origin: 'https://other.example.test',
        })
      ).status,
      403,
    );
    assert.equal(calls.length, 0);
    assert.equal((await f.request('POST', path, session, body)).status, 200);
    assert.equal(calls.length, 1);
  }));
