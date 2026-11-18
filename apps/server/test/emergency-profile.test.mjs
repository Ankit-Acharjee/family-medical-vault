import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  isEmergencyProfileFields,
  isSaveEmergencyProfile,
  isEmergencyProfile,
} from '@fmv/contracts';
import { EmergencyProfileService } from '../dist/emergency/emergency-profile.service.js';
import { documentSetup } from './support/document-fixture.mjs';
const fields = {
  contactName: null,
  contactRelationship: null,
  contactPhone: null,
  note: null,
};
test('emergency fields are bounded optional owner-reported text, never clinical inference', () => {
  assert.ok(isEmergencyProfileFields(fields));
  assert.ok(
    isEmergencyProfileFields({ ...fields, note: 'বাংলা\nContact owner' }),
  );
  for (const patch of [
    { note: '' },
    { note: ' padded ' },
    { contactName: 'line\nline' },
    { note: 'x'.repeat(1001) },
    { contactPhone: 123 },
    { allergies: [] },
    { note: 'bad\u0000value' },
  ])
    assert.equal(isEmergencyProfileFields({ ...fields, ...patch }), false);
  const body = {
    requestId: randomUUID(),
    expectedRevision: 0,
    fields,
    confirmed: true,
  };
  assert.ok(isSaveEmergencyProfile(body));
  for (const patch of [
    { expectedRevision: -1 },
    { expectedRevision: 1.5 },
    { confirmed: false },
    { public: true },
  ])
    assert.equal(isSaveEmergencyProfile({ ...body, ...patch }), false);
  assert.ok(
    isEmergencyProfile({
      patientId: randomUUID(),
      canWrite: true,
      profile: null,
    }),
  );
});
test('emergency HTTP boundary requires current session and same-origin CSRF', async () =>
  documentSetup(async (f) => {
    const service = f.app.get(EmergencyProfileService),
      path = f.path('emergency-profile'),
      calls = [];
    service.read = async (...args) => {
      calls.push(args);
      return { synthetic: true };
    };
    service.save = service.read;
    assert.equal((await f.request('GET', path)).status, 401);
    const session = await f.login();
    assert.equal((await f.request('GET', path, session)).status, 200);
    assert.equal(
      (await f.request('PUT', path, session, {}, { 'X-CSRF-Token': undefined }))
        .status,
      403,
    );
    assert.equal(
      (
        await f.request(
          'PUT',
          path,
          session,
          {},
          { Origin: 'https://other.example.test' },
        )
      ).status,
      403,
    );
    assert.equal(calls.length, 1);
    assert.equal((await f.request('PUT', path, session, {})).status, 200);
    assert.equal((await f.request('GET', '/api/emergency/public')).status, 404);
  }));
