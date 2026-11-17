import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { documentSetup } from './support/document-fixture.mjs';
import { MedicationReconciliationService } from '../dist/medications/medication-reconciliation.service.js';
test('medication reconciliation routes preserve session, CSRF, no-store and private errors', async () =>
  documentSetup(async (f) => {
    const service = f.app.get(MedicationReconciliationService),
      calls = [],
      id = randomUUID(),
      base = f.path('medication-reconciliations');
    service.list = async (principal, p, query) => {
      calls.push({ principal, p, query });
      return { patientId: p, canWrite: true, entries: [], nextCursor: null };
    };
    service.sourceOptions = async (principal, p, query) => {
      calls.push({ principal, p, query, sourceOptions: true });
      return { patientId: p, canWrite: true, options: [], limited: false };
    };
    service.history = async (principal, p, medicationId, query) => {
      calls.push({ principal, p, medicationId, query });
      return {};
    };
    service.save = async (principal, p, medicationId, body) => {
      calls.push({ principal, p, medicationId, body });
      return { saved: true, revision: 1 };
    };
    assert.equal((await f.request('GET', base)).status, 401);
    assert.equal(
      (await f.request('PUT', `${base}/${id}`, undefined, {})).status,
      401,
    );
    assert.equal(calls.length, 0);
    const session = await f.login(),
      page = await f.request('GET', base, session);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.ok(calls[0].principal.subject);
    assert.equal(
      (await f.request('GET', `${base}/source-options`, session)).status,
      200,
    );
    assert.equal(calls.at(-1).sourceOptions, true);
    assert.equal(
      (await f.request('GET', `${base}/${id}?beforeRevision=2`, session))
        .status,
      200,
    );
    assert.equal(calls.at(-1).query.beforeRevision, '2');
    const before = calls.length;
    assert.equal(
      (
        await f.request(
          'PUT',
          `${base}/${id}`,
          session,
          {},
          { 'X-CSRF-Token': undefined },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          'PUT',
          `${base}/${id}`,
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
      confirmed: true,
    };
    assert.equal(
      (await f.request('PUT', `${base}/${id}`, session, body)).status,
      200,
    );
    assert.deepEqual(calls.at(-1).body, body);
    assert.equal(calls.at(-1).medicationId, id);
    service.list = async () => {
      throw Error('private-medication-sentinel');
    };
    const failed = await f.request('GET', base, session);
    assert.equal(failed.status, 500);
    assert.equal(
      (await failed.text()).includes('private-medication-sentinel'),
      false,
    );
    assert.equal(
      JSON.stringify(f.logs).includes('private-medication-sentinel'),
      false,
    );
  }));
