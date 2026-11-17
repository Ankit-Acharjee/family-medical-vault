import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  isMedicationInventoryFields,
  isSaveMedicationInventory,
  isMedicationInventoryEntry,
  isMedicationInventoryHistory,
} from '@fmv/contracts';
import { documentSetup } from './support/document-fixture.mjs';
import { MedicationReconciliationService } from '../dist/medications/medication-reconciliation.service.js';
const fields = {
  quantity: ' 2 strips + uncertain remainder ',
  expiry: 'Nov 2027 (month only)',
  refill: 'Ask pharmacy; not scheduled',
};
const request = {
  requestId: randomUUID(),
  expectedRevision: 0,
  medicationRevision: 1,
  confirmed: true,
  meaning: 'owner-reported-inventory',
  fields,
};
test('inventory preserves literal uncertainty, partial dates and optional unknowns without arithmetic', () => {
  assert.equal(isMedicationInventoryFields(fields), true);
  assert.equal(fields.quantity, ' 2 strips + uncertain remainder ');
  assert.equal(
    isMedicationInventoryFields({ quantity: null, expiry: null, refill: null }),
    true,
  );
  for (const value of [
    '',
    ' ',
    '\u00a0',
    'x\nvalue',
    '\ud800',
    'x'.repeat(121),
    27,
  ])
    assert.equal(
      isMedicationInventoryFields({ ...fields, quantity: value }),
      false,
    );
  assert.equal(
    isMedicationInventoryFields({ ...fields, dose: 'extra' }),
    false,
  );
  assert.equal(
    isMedicationInventoryFields({ ...fields, quantity: '😀'.repeat(60) }),
    true,
  );
  assert.equal(
    isMedicationInventoryFields({ ...fields, quantity: '😀'.repeat(61) }),
    false,
  );
  for (const body of [
    { ...request, confirmed: false },
    { ...request, expectedRevision: 2147483647 },
    { ...request, medicationRevision: 0 },
    { ...request, patientId: randomUUID() },
    { ...request, fields: { ...fields, refill: undefined } },
  ])
    assert.equal(isSaveMedicationInventory(body), false);
  assert.equal(isSaveMedicationInventory(request), true);
});
test('inventory history rejects cross-patient, future bindings, contradictory versions and malformed pagination', () => {
  const entry = {
    patientId: randomUUID(),
    medicationId: randomUUID(),
    medicationRevision: 1,
    revision: 1,
    recordedAt: '2026-11-17T00:00:00.000Z',
    meaning: 'owner-reported-inventory',
    fields,
  };
  const result = {
    patientId: entry.patientId,
    medicationId: entry.medicationId,
    medicationRevision: 2,
    canWrite: true,
    sourceState: 'current-source',
    current: entry,
    history: [entry],
    nextBeforeRevision: null,
  };
  assert.equal(isMedicationInventoryEntry(entry), true);
  assert.equal(isMedicationInventoryHistory(result), true);
  for (const altered of [
    { ...result, patientId: randomUUID() },
    { ...result, medicationRevision: 0 },
    { ...result, history: [] },
    {
      ...result,
      history: [{ ...entry, fields: { ...fields, quantity: null } }],
    },
    { ...result, history: [{ ...entry, medicationRevision: 3 }] },
    { ...result, nextBeforeRevision: 0 },
    { ...result, sourceState: 'verified' },
  ])
    assert.equal(isMedicationInventoryHistory(altered), false);
  assert.equal(
    isMedicationInventoryHistory({ ...result, current: null, history: [] }),
    true,
  );
  assert.equal(
    isMedicationInventoryEntry({
      ...entry,
      recordedAt: '2026-02-30T00:00:00.000Z',
    }),
    false,
  );
});
test('inventory routes enforce session, CSRF, origin and private failures', async () =>
  documentSetup(async (f) => {
    const service = f.app.get(MedicationReconciliationService),
      calls = [],
      id = randomUUID(),
      base = `${f.path('medication-reconciliations')}/${id}/inventory`;
    service.inventory = async (...args) => {
      calls.push(args);
      return { saved: true, revision: 1 };
    };
    assert.equal((await f.request('GET', base)).status, 401);
    assert.equal(
      (await f.request('PUT', base, undefined, request)).status,
      401,
    );
    assert.equal(calls.length, 0);
    const session = await f.login();
    const read = await f.request('GET', base + '?beforeRevision=2', session);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.equal(calls.at(-1)[3], 'read');
    assert.equal(calls.at(-1)[4].beforeRevision, '2');
    assert.deepEqual(Object.keys(calls.at(-1)[4]), ['beforeRevision']);
    const before = calls.length;
    assert.equal(
      (
        await f.request('PUT', base, session, request, {
          'X-CSRF-Token': undefined,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request('PUT', base, session, request, {
          Origin: 'https://unapproved.example.test',
        })
      ).status,
      403,
    );
    assert.equal(calls.length, before);
    assert.equal((await f.request('PUT', base, session, request)).status, 200);
    assert.equal(calls.at(-1)[2], id);
    assert.equal(calls.at(-1)[3], 'save');
    assert.deepEqual(calls.at(-1)[4], request);
    service.inventory = async () => {
      throw Error('inventory-private-sentinel');
    };
    const fail = await f.request('GET', base, session);
    assert.equal(fail.status, 500);
    assert.equal(
      (await fail.text()).includes('inventory-private-sentinel'),
      false,
    );
    assert.equal(
      JSON.stringify(f.logs).includes('inventory-private-sentinel'),
      false,
    );
  }));
