import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { documentSetup } from './support/document-fixture.mjs';
import { ManualReadingsService } from '../dist/measurements/manual-readings.service.js';
test('manual routes enforce session/CSRF, no-store and sanitized errors', async () =>
  documentSetup(async (f) => {
    const service = f.app.get(ManualReadingsService),
      calls = [],
      id = randomUUID(),
      base = f.path('manual-readings');
    service.list = async (principal, p, query) => {
      calls.push({ principal, p, query });
      return { patientId: p, canWrite: true, entries: [], nextCursor: null };
    };
    service.history = async (principal, p, readingId, query) => {
      calls.push({ principal, p, readingId, query });
      return {};
    };
    service.save = async (principal, p, readingId, body) => {
      calls.push({ principal, p, readingId, body });
      return { saved: true, revision: 1 };
    };
    service.withdraw = async (principal, p, readingId, body) => {
      calls.push({ principal, p, readingId, body });
      return { saved: true, revision: 2 };
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
          'POST',
          `${base}/${id}/withdraw`,
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
      reading: {
        kind: 'pulse',
        unit: 'beats/min',
        observedAt: '2026-11-17T00:00:00Z',
        values: { value: '60' },
      },
    };
    assert.equal(
      (await f.request('PUT', `${base}/${id}`, session, body)).status,
      200,
    );
    assert.deepEqual(calls.at(-1).body, body);
    assert.equal(calls.at(-1).readingId, id);
    assert.equal(
      (
        await f.request('POST', `${base}/${id}/withdraw`, session, {
          requestId: randomUUID(),
          expectedRevision: 1,
          confirmed: true,
        })
      ).status,
      200,
    );
    service.list = async () => {
      throw Error('private-manual-sentinel');
    };
    const failed = await f.request('GET', base, session);
    assert.equal(failed.status, 500);
    assert.equal(
      (await failed.text()).includes('private-manual-sentinel'),
      false,
    );
    assert.equal(
      JSON.stringify(f.logs).includes('private-manual-sentinel'),
      false,
    );
  }));
