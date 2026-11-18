import assert from 'node:assert/strict';
import test from 'node:test';
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
