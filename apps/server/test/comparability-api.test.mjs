import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { documentSetup } from './support/document-fixture.mjs';
import { MeasurementComparisonsService } from '../dist/measurements/measurement-comparisons.service.js';

// Real HTTP/auth/CSRF/controller wiring; actual SQL authority and source checks
// are exercised independently by the disposable PostgreSQL suite.
test('comparison routes require sessions and CSRF and sanitize failures', async () =>
  documentSetup(async (f) => {
    const service = f.app.get(MeasurementComparisonsService);
    const calls = [];
    const setId = randomUUID();
    const path = f.path(`measurement-comparisons/${setId}`);
    const receipt = { saved: true, revision: 1 };
    service.read = async (principal, p, id) => {
      calls.push({ principal, p, id });
      return {
        setId: id,
        revision: 0,
        status: 'missing',
        canConfirm: true,
        members: [],
        measurements: [],
      };
    };
    service.confirm = async (principal, p, id, body) => {
      calls.push({ principal, p, id, body });
      return receipt;
    };
    service.withdraw = async (principal, p, id, body) => {
      calls.push({ principal, p, id, body });
      return receipt;
    };
    assert.equal((await f.request('GET', path)).status, 401);
    assert.equal((await f.request('PUT', path, undefined, {})).status, 401);
    assert.equal(calls.length, 0);
    const session = await f.login();
    const read = await f.request('GET', path, session);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.equal((await read.json()).status, 'missing');
    const before = calls.length;
    assert.equal(
      (await f.request('PUT', path, session, {}, { 'X-CSRF-Token': undefined }))
        .status,
      403,
    );
    assert.equal(
      (
        await f.request(
          'POST',
          `${path}/withdraw`,
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
      members: [],
    };
    const written = await f.request('PUT', path, session, body);
    assert.equal(written.status, 200);
    assert.deepEqual(await written.json(), receipt);
    assert.deepEqual(calls.at(-1).body, body);
    assert.equal(calls.at(-1).id, setId);
    assert.ok(calls.at(-1).principal.subject);
    assert.equal(
      (
        await f.request('POST', `${path}/withdraw`, session, {
          requestId: randomUUID(),
          expectedRevision: 1,
          confirmed: true,
        })
      ).status,
      200,
    );
    service.read = async () => {
      throw new Error('private-comparison-sentinel');
    };
    const failed = await f.request('GET', path, session);
    assert.equal(failed.status, 500);
    assert.equal(
      (await failed.text()).includes('private-comparison-sentinel'),
      false,
    );
    assert.equal(
      JSON.stringify(f.logs).includes('private-comparison-sentinel'),
      false,
    );
  }));

test('measurement workspace requires authenticated session, no-store and safe errors', async () =>
  documentSetup(async (f) => {
    const service = f.app.get(MeasurementComparisonsService),
      calls = [];
    service.workspace = async (principal, p) => {
      calls.push({ principal, p });
      return {
        patientId: p,
        canConfirm: true,
        measurements: [],
        comparisons: [],
        sources: [],
        measurementsLimited: false,
        comparisonsLimited: false,
      };
    };
    const path = f.path('measurement-workspace');
    assert.equal((await f.request('GET', path)).status, 401);
    assert.equal(calls.length, 0);
    const session = await f.login(),
      response = await f.request('GET', path, session);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(calls[0].principal.subject);
    service.workspace = async () => {
      throw Error('private-workspace-sentinel');
    };
    const failure = await f.request('GET', path, session);
    assert.equal(failure.status, 500);
    assert.equal(
      (await failure.text()).includes('private-workspace-sentinel'),
      false,
    );
    assert.equal(
      JSON.stringify(f.logs).includes('private-workspace-sentinel'),
      false,
    );
  }));
