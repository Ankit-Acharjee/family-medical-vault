import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { documentSetup, ids } from './support/document-fixture.mjs';
import {
  GroundedSummaryService,
  summaryRequest,
} from '../dist/summaries/grounded-summary.service.js';
test('summary query parsing admits only explicit scope and paired exact calendar dates', () => {
  assert.deepEqual(summaryRequest({}), { scope: 'patient', period: null });
  assert.deepEqual(
    summaryRequest({
      scope: 'manual',
      fromDate: '2024-02-29',
      toDate: '2024-03-01',
    }),
    {
      scope: 'manual',
      period: { fromDate: '2024-02-29', toDate: '2024-03-01' },
    },
  );
  for (const q of [
    null,
    [],
    { scope: null },
    { scope: ['patient', 'medication'] },
    { fromDate: '2024-02-29' },
    { fromDate: '2024-02-30', toDate: '2024-03-01' },
    { scope: 'diagnosis' },
    { includeUnverified: 'true' },
    { patientId: 'ignored' },
  ])
    assert.throws(
      () => summaryRequest(q),
      (e) => e.getStatus?.() === 400,
    );
});
test('summary endpoint requires current session, uses no-store and sanitizes all failures', async () =>
  documentSetup(async (f) => {
    const service = f.app.get(GroundedSummaryService),
      calls = [],
      base = f.path('summary');
    service.read = async (principal, p, query) => {
      calls.push({ principal, p, query });
      return { meaning: 'synthetic-summary-fixture' };
    };
    assert.equal((await f.request('GET', base)).status, 401);
    assert.equal(calls.length, 0);
    const session = await f.login();
    const response = await f.request(
      'GET',
      base + '?scope=laboratory&fromDate=2024-02-29&toDate=2024-03-01',
      session,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(calls[0].principal.subject);
    assert.equal(calls[0].p, ids.patient);
    assert.deepEqual(
      { ...calls[0].query },
      {
        scope: 'laboratory',
        fromDate: '2024-02-29',
        toDate: '2024-03-01',
      },
    );
    for (const error of [
      new NotFoundException(),
      new ServiceUnavailableException(),
      new Error('SYNTHETIC private source details'),
    ]) {
      service.read = async () => {
        throw error;
      };
      const r = await f.request('GET', base, session);
      assert.equal(
        r.status,
        error instanceof NotFoundException
          ? 404
          : error instanceof ServiceUnavailableException
            ? 503
            : 500,
      );
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.ok(!(await r.text()).includes('private source details'));
    }
    assert.equal((await f.request('POST', base, session, {})).status, 404);
  }));

test('summary export requires session and CSRF and delivers private attachment only after authorization', async () =>
  documentSetup(async (f) => {
    const service = f.app.get(GroundedSummaryService),
      base = f.path('summary/export'),
      calls = [];
    service.export = async (...args) => {
      calls.push(args);
      return { bytes: Buffer.from('PK synthetic fixture') };
    };
    assert.equal((await f.request('POST', base, undefined, {})).status, 401);
    const session = await f.login();
    assert.equal(
      (
        await f.request(
          'POST',
          base,
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
          base,
          session,
          {},
          { Origin: 'https://unapproved.example.test' },
        )
      ).status,
      403,
    );
    assert.equal(calls.length, 0);
    const r = await f.request('POST', base, session, {});
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('content-type'), 'application/zip');
    assert.ok(
      r.headers
        .get('content-disposition')
        .includes('family-medical-vault-summary.zip'),
    );
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await r.text(), 'PK synthetic fixture');
    assert.equal(calls[0][1], ids.patient);
    assert.ok(calls[0][3] instanceof globalThis.AbortSignal);
    for (const error of [
      new NotFoundException(),
      new ServiceUnavailableException(),
      new Error('private export content'),
    ]) {
      service.export = async () => {
        throw error;
      };
      const denied = await f.request('POST', base, session, {});
      assert.equal(denied.status, error.getStatus?.() ?? 500);
      assert.ok(!(await denied.text()).includes('private export content'));
    }
  }));
