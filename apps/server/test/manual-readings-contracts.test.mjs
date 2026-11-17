import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  isManualReading,
  isManualObservedAt,
  isSaveManualReading,
  isWithdrawManualReading,
  isManualReadingsPage,
  isManualReadingHistory,
} from '@fmv/contracts';
const patientId = randomUUID(),
  readingId = randomUUID();
const reading = {
  kind: 'weight',
  unit: 'kg',
  observedAt: '2026-11-17T10:30:00+05:30',
  values: { value: '72.000000000000000001' },
};
const entry = {
  patientId,
  readingId,
  revision: 1,
  action: 'record',
  reading,
  recordedAt: '2026-11-17T00:00:00.000Z',
  provenance: 'manual',
};
test('manual readings retain exact strings, explicit units and an unambiguous entered offset', () => {
  for (const observedAt of [
    '2026-11-17T10:30:00+05:30',
    '2024-02-29T00:00:00Z',
    '2026-11-17T23:59:59-14:00',
  ])
    assert.equal(isManualObservedAt(observedAt), true);
  for (const observedAt of [
    '2026-02-30T00:00:00Z',
    '2026-11-17T24:00:00Z',
    '2026-11-17T10:30:60Z',
    '2026-11-17T10:30:00',
    '2026-11-17T10:30:00-00:00',
    '2026-11-17T10:30:00+14:01',
    '2026-11-17T10:30:00+15:00',
    '2026-11-17T10:30:00Z\n',
  ])
    assert.equal(isManualObservedAt(observedAt), false);
  assert.equal(isManualReading(reading), true);
  for (const r of [
    {
      kind: 'blood-pressure',
      unit: 'mmHg',
      observedAt: reading.observedAt,
      values: { systolic: '120', diastolic: '80' },
    },
    {
      kind: 'pulse',
      unit: 'beats/min',
      observedAt: reading.observedAt,
      values: { value: '0' },
    },
    {
      kind: 'glucose',
      unit: 'mg/dL',
      observedAt: reading.observedAt,
      values: { value: '99.000' },
    },
  ])
    assert.equal(isManualReading(r), true);
  for (const value of [
    72,
    '01',
    '-1',
    '+1',
    '1e2',
    'NaN',
    '<5',
    '.1',
    '1.',
    '1\n',
    '1\u2028',
    '1'.repeat(33),
  ])
    assert.equal(isManualReading({ ...reading, values: { value } }), false);
  for (const patch of [
    { unit: 'KG' },
    { unit: 'kg\n' },
    { kind: '__proto__' },
    { values: { value: '1', other: '2' } },
    { extra: true },
  ])
    assert.equal(isManualReading({ ...reading, ...patch }), false);
});
test('manual write intent is exact and cannot forge provenance or actors', () => {
  const body = {
    requestId: randomUUID(),
    expectedRevision: 0,
    confirmed: true,
    reading,
  };
  assert.equal(isSaveManualReading(body), true);
  for (const patch of [
    { confirmed: false },
    { confirmed: 'true' },
    { expectedRevision: 2147483648 },
    { requestId: randomUUID() + '\n' },
    { actorAccountId: randomUUID() },
    { provenance: 'verified' },
  ])
    assert.equal(isSaveManualReading({ ...body, ...patch }), false);
  assert.equal(
    isWithdrawManualReading({
      requestId: randomUUID(),
      expectedRevision: 1,
      confirmed: true,
    }),
    true,
  );
  assert.equal(
    isWithdrawManualReading({
      requestId: randomUUID(),
      expectedRevision: 0,
      confirmed: true,
    }),
    false,
  );
});
test('manual response guards reject mixed patients, fabricated trust and malformed pagination', () => {
  const page = {
    patientId,
    canWrite: true,
    entries: [entry],
    nextCursor: null,
  };
  assert.equal(isManualReadingsPage(page), true);
  for (const patch of [
    { entries: [entry, entry] },
    { patientId: randomUUID() },
    { entries: [{ ...entry, provenance: 'lab' }] },
    { entries: [{ ...entry, action: 'correction' }] },
    { nextCursor: { recordedAt: entry.recordedAt, readingId } },
    { extra: true },
  ])
    assert.equal(isManualReadingsPage({ ...page, ...patch }), false);
  const history = {
    current: { ...entry, revision: 2, action: 'correction' },
    canWrite: true,
    history: [{ ...entry, revision: 2, action: 'correction' }, entry],
    nextBeforeRevision: null,
  };
  assert.equal(isManualReadingHistory(history), true);
  for (const patch of [
    { history: [] },
    { history: [entry, history.current] },
    { nextBeforeRevision: 1 },
    { history: [{ ...entry, patientId: randomUUID() }] },
  ])
    assert.equal(isManualReadingHistory({ ...history, ...patch }), false);
});
