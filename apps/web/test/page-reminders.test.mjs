import { URL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import ts from 'typescript';
async function moduleUrl(file, replace = {}) {
  let code = ts.transpileModule(
    await readFile(
      new URL('../src/features/medications/reminders/' + file, import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  for (const [key, value] of Object.entries(replace))
    code = code.replaceAll("'" + key + "'", JSON.stringify(value));
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
}
const clockUrl = await moduleUrl('clock.ts');
const { clockDayIndex, localClock } = await import(clockUrl);
const { PageReminderSession, reminderEligible } = await import(
  await moduleUrl('session.ts', { './clock': clockUrl })
);
function index(zone, date) {
  const gen = clockDayIndex(zone, date);
  let r;
  do {
    r = gen.next();
  } while (!r.done);
  return r.value;
}
test('exact minute resolution rejects gaps, folds, half-hour transitions and skipped calendar dates', () => {
  const fold = index('America/New_York', '2026-11-01');
  assert.deepEqual(fold.slots.get('01:30'), [
    Date.parse('2026-11-01T05:30Z'),
    Date.parse('2026-11-01T06:30Z'),
  ]);
  assert.equal(
    index('America/New_York', '2026-03-08').slots.get('02:30'),
    undefined,
  );
  assert.equal(
    index('Australia/Lord_Howe', '2026-04-05').slots.get('01:45').length,
    2,
  );
  assert.equal(
    index('Australia/Lord_Howe', '2026-10-04').slots.get('02:15'),
    undefined,
  );
  assert.equal(index('Pacific/Apia', '2011-12-30').slots.size, 0);
  assert.equal(index('bad/zone', '2026-11-18').supported, false);
  assert.equal(index('UTC', '2026-02-30').supported, false);
  assert.equal(index('Africa/Monrovia', '1971-01-01').supported, false);
  assert.equal(
    localClock('Asia/Kathmandu', Date.parse('2026-11-18T00:00Z')).time,
    '05:45',
  );
});
const fixture = () => ({
  patientId: 'patient',
  medicationId: 'opaque',
  medicationRevision: 1,
  medicationStatus: 'current',
  canWrite: true,
  sourceState: 'current-source',
  current: {
    revision: 1,
    medicationRevision: 1,
    recordedState: 'recorded',
    definition: {
      timing: {
        kind: 'clock-times',
        timeZone: 'UTC',
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        times: ['12:01'],
      },
      startDate: null,
      endDate: null,
    },
  },
});
function harness() {
  let now = Date.parse('2026-11-18T12:00:00Z'),
    data = fixture(),
    items = [],
    loads = 0;
  const session = new PageReminderSession({
    now: () => now,
    load: async () => {
      loads++;
      return JSON.parse(JSON.stringify(data));
    },
    yield: async () => {},
    publish: (v) => (items = v),
  });
  session.setActive(true);
  return {
    session,
    get items() {
      return items;
    },
    get loads() {
      return loads;
    },
    get data() {
      return data;
    },
    set data(v) {
      data = v;
    },
    time: (v) => (now = Date.parse(v)),
  };
}
test('explicit next-minute opt-in revalidates before generic due notice and deduplicates', async () => {
  const h = harness();
  await h.session.enable(h.data);
  assert.equal(h.items[0].state, 'enabled');
  assert.equal(h.loads, 1);
  h.time('2026-11-18T12:01:01Z');
  await h.session.tick();
  assert.deepEqual(h.items, [{ id: 'opaque', state: 'due' }]);
  assert.equal(h.loads, 2);
  await h.session.tick();
  assert.equal(h.loads, 2);
  assert.equal(h.items[0].state, 'due');
  h.time('2026-11-18T12:02:01Z');
  await h.session.tick();
  assert.equal(h.items[0].state, 'enabled');
  h.session.stop();
  await h.session.enable(h.data);
  assert.equal(h.items[0].state, 'enabled');
});
test('hidden-page return and suspended clock skip occurrences; no catch-up', async () => {
  const h = harness();
  await h.session.enable(h.data);
  h.session.setActive(false);
  h.time('2026-11-18T12:01:01Z');
  h.session.setActive(true);
  await h.session.tick();
  assert.equal(h.loads, 1);
  assert.equal(h.items[0].state, 'enabled');
  const j = harness();
  await j.session.enable(j.data);
  j.time('2026-11-18T12:01:59Z');
  await j.session.tick();
  assert.equal(j.loads, 1);
});
test('fresh ownership, medication/source and schedule version changes stop delivery', async () => {
  for (const change of [
    (d) => (d.canWrite = false),
    (d) => (d.medicationStatus = 'historical'),
    (d) => (d.sourceState = 'source-review-required'),
    (d) => d.medicationRevision++,
    (d) => d.current.revision++,
    (d) => (d.current.recordedState = 'retired'),
  ]) {
    const h = harness();
    await h.session.enable(h.data);
    change(h.data);
    h.time('2026-11-18T12:01:01Z');
    await h.session.tick();
    assert.equal(h.items[0].state, 'unavailable');
  }
});
test('ambiguous and absent selected times require review even before that occurrence', async () => {
  for (const [date, time] of [
    ['2026-11-01', '01:30'],
    ['2026-03-08', '02:30'],
  ]) {
    const h = harness();
    h.time(date + 'T05:00:00Z');
    h.data.current.definition.timing.timeZone = 'America/New_York';
    h.data.current.definition.timing.times = [time];
    await h.session.enable(h.data);
    assert.equal(h.items[0].state, 'review');
    assert.equal(h.loads, 1);
  }
});
test('pending opt-in is fenced on stop, hide and page departure, including late ignored aborts', async () => {
  for (const action of ['stop', 'hide', 'clear']) {
    let resolve;
    let items = [];
    const data = fixture();
    const s = new PageReminderSession({
      now: () => Date.parse('2026-11-18T12:00Z'),
      load: () => new Promise((r) => (resolve = r)),
      yield: async () => {},
      publish: (v) => (items = v),
    });
    s.setActive(true);
    const pending = s.enable(data);
    if (action === 'hide') s.setActive(false);
    else if (action === 'stop') s.stop('opaque');
    else s.clear();
    resolve(data);
    await pending;
    assert.deepEqual(items, []);
  }
});
test('literal, historical, retired, delegate and obsolete schedules cannot be enabled', () => {
  for (const change of [
    (d) => (d.canWrite = false),
    (d) => (d.medicationStatus = 'historical'),
    (d) => (d.current.recordedState = 'retired'),
    (d) => (d.current.medicationRevision = 2),
    (d) =>
      (d.current.definition.timing = { kind: 'literal', text: 'as reported' }),
  ]) {
    const d = fixture();
    change(d);
    assert.equal(reminderEligible(d), false);
  }
});
test('due revalidation failure stops local intent and late access cannot re-enable cleared state', async () => {
  let now = Date.parse('2026-11-18T12:00Z'),
    calls = 0,
    resolve,
    items = [];
  const s = new PageReminderSession({
    now: () => now,
    load: async () => {
      if (++calls === 1) return fixture();
      return new Promise((r) => (resolve = r));
    },
    yield: async () => {},
    publish: (v) => (items = v),
  });
  s.setActive(true);
  await s.enable(fixture());
  now = Date.parse('2026-11-18T12:01:01Z');
  const due = s.tick();
  while (!resolve) await Promise.resolve();
  s.clear();
  resolve(fixture());
  await due;
  assert.deepEqual(items, []);
  let state = [];
  const fail = new PageReminderSession({
    now: () => now,
    load: async () => {
      throw Error('Unavailable');
    },
    yield: async () => {},
    publish: (v) => (state = v),
  });
  fail.setActive(true);
  await fail.enable(fixture());
  assert.equal(state[0].state, 'unavailable');
});
test('explicit date windows and weekdays suppress notices without changing shared timing', async () => {
  for (const change of [
    (d) => (d.current.definition.startDate = '2026-11-19'),
    (d) => (d.current.definition.endDate = '2026-11-17'),
    (d) => (d.current.definition.timing.weekdays = [1]),
  ]) {
    const h = harness();
    change(h.data);
    const original = JSON.stringify(h.data);
    await h.session.enable(h.data);
    h.time('2026-11-18T12:01:01Z');
    await h.session.tick();
    assert.equal(h.loads, 1);
    assert.equal(JSON.stringify(h.data), original);
  }
});
