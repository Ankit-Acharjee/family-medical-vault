import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { documentSetup } from './support/document-fixture.mjs';
import { MedicationReconciliationService } from '../dist/medications/medication-reconciliation.service.js';
test('schedule routes preserve session, CSRF, origin, no-store and private failures', async () =>
  documentSetup(async (f) => {
    const service = f.app.get(MedicationReconciliationService),
      calls = [],
      id = randomUUID(),
      path = `${f.path('medication-reconciliations')}/${id}/schedule`;
    service.schedule = async (...args) => {
      calls.push(args);
      return { saved: true, revision: 1 };
    };
    assert.equal((await f.request('GET', path)).status, 401);
    assert.equal((await f.request('PUT', path, undefined, {})).status, 401);
    assert.equal(calls.length, 0);
    const session = await f.login(),
      page = await f.request('GET', path + '?beforeRevision=2', session);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(calls.at(-1)[3], 'read');
    assert.equal(calls.at(-1)[4].beforeRevision, '2');
    assert.deepEqual(Object.keys(calls.at(-1)[4]), ['beforeRevision']);
    const before = calls.length;
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
          { Origin: 'https://unapproved.example.test' },
        )
      ).status,
      403,
    );
    assert.equal(calls.length, before);
    const body = {
      requestId: randomUUID(),
      expectedRevision: 0,
      medicationRevision: 1,
      confirmed: true,
      meaning: 'owner-recorded-informational-schedule',
      recordedState: 'recorded',
      definition: {
        timing: { kind: 'literal', text: 'SYNTHETIC uncertain timing' },
        startDate: null,
        endDate: null,
        instructions: null,
      },
    };
    assert.equal((await f.request('PUT', path, session, body)).status, 200);
    assert.equal(calls.at(-1)[2], id);
    assert.equal(calls.at(-1)[3], 'save');
    assert.deepEqual(calls.at(-1)[4], body);
    service.schedule = async () => {
      throw Error('private-schedule-sentinel');
    };
    const failed = await f.request('GET', path, session);
    assert.equal(failed.status, 500);
    assert.equal(
      (await failed.text()).includes('private-schedule-sentinel'),
      false,
    );
    assert.equal(
      JSON.stringify(f.logs).includes('private-schedule-sentinel'),
      false,
    );
  }));
