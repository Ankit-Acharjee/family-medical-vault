import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  isMedicationScheduleDate,
  isMedicationScheduleTiming,
  isMedicationScheduleDefinition,
  isSaveMedicationSchedule,
} from '@fmv/contracts';
const clock = {
  kind: 'clock-times',
  timeZone: 'Asia/Kolkata',
  weekdays: [1, 3, 5],
  times: ['08:00', '20:30'],
};
const definition = {
  timing: clock,
  startDate: null,
  endDate: null,
  instructions: null,
};
const request = {
  requestId: randomUUID(),
  expectedRevision: 0,
  medicationRevision: 1,
  confirmed: true,
  meaning: 'owner-recorded-informational-schedule',
  recordedState: 'recorded',
  definition,
};
test('schedule literals preserve uncertainty and never parse frequency or dose into clock times', () => {
  for (const text of [
    'As needed? uncertain source wording',
    'After breakfast as reported',
    'Alternate days; confirm details',
    '  wording preserved  ',
  ]) {
    const timing = { kind: 'literal', text };
    assert.equal(isMedicationScheduleTiming(timing), true);
    assert.equal(timing.text, text);
    assert.equal(Object.hasOwn(timing, 'times'), false);
  }
  for (const text of ['', ' ', 'x'.repeat(121), 'text\ncontrol', '\ud800'])
    assert.equal(isMedicationScheduleTiming({ kind: 'literal', text }), false);
  assert.equal(
    isMedicationScheduleTiming({
      kind: 'literal',
      text: 'as needed',
      times: ['08:00'],
    }),
    false,
  );
});
test('clock schedules require bounded unique explicitly ordered weekdays and exact times', () => {
  assert.equal(isMedicationScheduleTiming(clock), true);
  for (const weekdays of [
    [],
    [0],
    [8],
    [1, 1],
    [5, 1],
    [1, 2, 3, 4, 5, 6, 7, 7],
    ['1'],
  ])
    assert.equal(isMedicationScheduleTiming({ ...clock, weekdays }), false);
  for (const times of [
    [],
    ['8:00'],
    ['24:00'],
    ['12:60'],
    ['08:00Z'],
    ['08:00', '08:00'],
    ['20:00', '08:00'],
    Array.from({ length: 9 }, (_, i) => `${i + 10}:00`),
  ])
    assert.equal(isMedicationScheduleTiming({ ...clock, times }), false);
  assert.equal(
    isMedicationScheduleTiming({
      ...clock,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      times: ['00:00', '23:59'],
    }),
    true,
  );
});
test('schedule timezones are explicit named zones; wall-clock labels are not resolved to DST instants', () => {
  for (const timeZone of [
    'Asia/Kolkata',
    'America/New_York',
    'UTC',
    'Pacific/Chatham',
  ])
    assert.equal(isMedicationScheduleTiming({ ...clock, timeZone }), true);
  for (const timeZone of [
    '',
    null,
    '+05:30',
    'Not/AZone',
    ' America/New_York',
    'x'.repeat(65),
  ])
    assert.equal(isMedicationScheduleTiming({ ...clock, timeZone }), false);
  const gap = { ...clock, timeZone: 'America/New_York', times: ['02:30'] },
    fold = { ...clock, timeZone: 'America/New_York', times: ['01:30'] };
  assert.equal(isMedicationScheduleTiming(gap), true);
  assert.equal(isMedicationScheduleTiming(fold), true);
  assert.deepEqual(gap.times, ['02:30']);
  assert.deepEqual(fold.times, ['01:30']);
});
test('schedule calendar labels preserve exact dates without coercing partial or impossible dates', () => {
  for (const date of [
    '2028-02-29',
    '2000-02-29',
    '2026-11-17',
    '0001-01-01',
    '9999-12-31',
  ])
    assert.equal(isMedicationScheduleDate(date), true);
  for (const date of [
    '2027-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-00-01',
    '2026-13-01',
    '2026-01-00',
    '2026-11',
    '17/11/2026',
    '2026-11-17T00:00:00Z',
    '0000-01-01',
    null,
  ])
    assert.equal(isMedicationScheduleDate(date), false);
  assert.equal(
    isMedicationScheduleDefinition({
      ...definition,
      startDate: '2026-11-17',
      endDate: '2026-11-16',
    }),
    false,
  );
  assert.equal(
    isMedicationScheduleDefinition({
      ...definition,
      startDate: '2026-11-17',
      endDate: '2026-11-17',
    }),
    true,
  );
  assert.equal(
    isMedicationScheduleDefinition({
      ...definition,
      startDate: null,
      endDate: '2026-11-17',
    }),
    true,
  );
  assert.equal(
    isMedicationScheduleDefinition({
      ...definition,
      instructions: 'Owner wording; no inferred dose',
    }),
    true,
  );
  assert.equal(
    isMedicationScheduleDefinition({ ...definition, extra: true }),
    false,
  );
});
test('schedule writes require explicit informational meaning, current medication revision and bounded CAS', () => {
  assert.equal(isSaveMedicationSchedule(request), true);
  assert.equal(
    isSaveMedicationSchedule({
      ...request,
      recordedState: 'retired',
      expectedRevision: 1,
    }),
    true,
  );
  for (const invalid of [
    { ...request, confirmed: false },
    { ...request, meaning: 'active-prescription' },
    { ...request, recordedState: 'stopped-treatment' },
    { ...request, expectedRevision: 2147483647 },
    { ...request, medicationRevision: 0 },
    { ...request, definition: { ...definition, dose: 'injected' } },
    { ...request, patientId: randomUUID() },
    { ...request, notificationEnabled: true },
  ])
    assert.equal(isSaveMedicationSchedule(invalid), false);
});

test('schedule history keeps current state authoritative and source changes never silently reactivate it', async () => {
  const {
    isMedicationScheduleEntry,
    isMedicationScheduleHistory,
    medicationScheduleMatchesCurrent,
    medicationScheduleDefinitionValue,
  } = await import('@fmv/contracts');
  const entry = {
    patientId: randomUUID(),
    medicationId: randomUUID(),
    medicationRevision: 1,
    revision: 1,
    action: 'recording',
    recordedAt: '2026-11-17T00:00:00.000Z',
    meaning: 'owner-recorded-informational-schedule',
    recordedState: 'recorded',
    definition,
  };
  const result = {
    patientId: entry.patientId,
    medicationId: entry.medicationId,
    medicationRevision: 1,
    medicationName: 'SYNTHETIC current medication',
    canWrite: true,
    sourceState: 'current-source',
    current: entry,
    history: [entry],
    nextBeforeRevision: null,
  };
  assert.equal(isMedicationScheduleEntry(entry), true);
  assert.equal(isMedicationScheduleHistory(result), true);
  assert.equal(
    medicationScheduleMatchesCurrent(entry, 1, 'current-source'),
    true,
  );
  assert.equal(
    medicationScheduleMatchesCurrent(entry, 2, 'current-source'),
    false,
  );
  assert.equal(
    medicationScheduleMatchesCurrent(entry, 1, 'source-review-required'),
    false,
  );
  const retired = {
    ...entry,
    revision: 2,
    action: 'retirement',
    recordedState: 'retired',
  };
  assert.equal(isMedicationScheduleEntry(retired), true);
  assert.equal(
    medicationScheduleMatchesCurrent(retired, 1, 'current-source'),
    false,
  );
  assert.equal(retired.recordedState, 'retired');
  for (const v of [
    { ...result, patientId: randomUUID() },
    { ...result, history: [] },
    { ...result, current: { ...entry, medicationRevision: 2 } },
    { ...result, history: [{ ...entry, recordedState: 'retired' }] },
    { ...result, history: [entry, entry] },
    { ...result, nextBeforeRevision: 0 },
  ])
    assert.equal(isMedicationScheduleHistory(v), false);
  assert.equal(
    isMedicationScheduleHistory({ ...result, current: null, history: [] }),
    true,
  );
  assert.equal(
    isMedicationScheduleEntry({
      ...entry,
      revision: 1,
      recordedState: 'retired',
    }),
    false,
  );
  const copy = medicationScheduleDefinitionValue(definition);
  assert.deepEqual(copy, definition);
  copy.timing.times.push('23:00');
  assert.deepEqual(definition.timing.times, ['08:00', '20:30']);
});
