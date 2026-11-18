import { URL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import ts from 'typescript';
const source = await readFile(
  new URL('../src/features/medications/schedule-draft.ts', import.meta.url),
  'utf8',
);
const compiled = ts
  .transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  .outputText.replaceAll(
    "'@fmv/contracts'",
    JSON.stringify(import.meta.resolve('@fmv/contracts')),
  );
const { emptyScheduleDraft, recordedScheduleDraft, scheduleDraftDefinition } =
  await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
  );
test('schedule drafts start blank and preserve literal uncertainty without creating clock times', () => {
  const empty = emptyScheduleDraft();
  assert.equal(empty.kind, 'literal');
  assert.equal(empty.literal, '');
  assert.equal(scheduleDraftDefinition(empty), null);
  const d = {
    timing: { kind: 'literal', text: '  SYNTHETIC as needed? uncertain  ' },
    startDate: null,
    endDate: null,
    instructions: null,
  };
  assert.deepEqual(scheduleDraftDefinition(recordedScheduleDraft(d)), d);
  assert.equal(d.timing.text, '  SYNTHETIC as needed? uncertain  ');
});
test('explicit clock selections are canonically ordered without mutating drafts or removing duplicates', () => {
  const draft = {
    ...emptyScheduleDraft(),
    kind: 'clock-times',
    timeZone: 'Asia/Kolkata',
    weekdays: [5, 1, 3],
    times: ['20:00', '08:30'],
    startDate: '2028-02-29',
  };
  assert.deepEqual(scheduleDraftDefinition(draft), {
    timing: {
      kind: 'clock-times',
      timeZone: 'Asia/Kolkata',
      weekdays: [1, 3, 5],
      times: ['08:30', '20:00'],
    },
    startDate: '2028-02-29',
    endDate: null,
    instructions: null,
  });
  assert.deepEqual(draft.times, ['20:00', '08:30']);
  assert.deepEqual(draft.weekdays, [5, 1, 3]);
  for (const changed of [
    { ...draft, times: ['08:30', '08:30'] },
    { ...draft, times: [''] },
    { ...draft, weekdays: [] },
    { ...draft, timeZone: 'Not/AZone' },
    { ...draft, startDate: '2027-02-29' },
    { ...draft, startDate: '2028-03-01', endDate: '2028-02-29' },
  ])
    assert.equal(scheduleDraftDefinition(changed), null);
});
test('editing recorded clock definitions copies arrays and preserves unknown dates/instructions', () => {
  const d = {
    timing: {
      kind: 'clock-times',
      timeZone: 'America/New_York',
      weekdays: [1, 7],
      times: ['01:30', '02:30'],
    },
    startDate: null,
    endDate: null,
    instructions: 'literal source wording',
  };
  const draft = recordedScheduleDraft(d);
  draft.weekdays.push(2);
  draft.times[0] = '03:30';
  assert.deepEqual(d.timing.weekdays, [1, 7]);
  assert.deepEqual(d.timing.times, ['01:30', '02:30']);
  assert.equal(draft.startDate, '');
  assert.equal(draft.instructions, 'literal source wording');
});
