import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(
  new URL('../src/features/manual-readings/draft.ts', import.meta.url),
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
const { emptyDraft, draftReading, readingDraft, changeKind } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);
test('manual draft keeps exact values and explicit offset without local Date conversion', () => {
  assert.equal(draftReading(emptyDraft()), null);
  const input = {
    kind: 'weight',
    unit: 'lb',
    observedAt: '2024-02-29T23:45:12-05:00',
    values: { value: '123.000000000000000001' },
  };
  assert.deepEqual(draftReading(readingDraft(input)), input);
  const utc = {
    kind: 'blood-pressure',
    unit: 'mmHg',
    observedAt: '2026-11-17T12:30:00Z',
    values: { systolic: '120', diastolic: '80' },
  };
  assert.deepEqual(draftReading(readingDraft(utc)), utc);
  const d = { ...readingDraft(utc), localTime: '2026-11-17T12:30' };
  assert.deepEqual(draftReading(d), utc);
  assert.equal(draftReading({ ...d, offset: '' }), null);
  assert.equal(draftReading({ ...d, offset: '-00:00' }), null);
});
test('changing type clears incompatible value slots and chooses only its supported unit', () => {
  const original = {
    ...emptyDraft(),
    value: '12',
    systolic: '120',
    diastolic: '80',
    offset: '+05:30',
    localTime: '2026-11-17T12:30',
  };
  const next = changeKind(original, 'glucose');
  assert.equal(next.unit, 'mg/dL');
  assert.equal(next.value, '');
  assert.equal(next.systolic, '');
  assert.equal(next.diastolic, '');
  assert.equal(original.systolic, '120');
  assert.equal(draftReading({ ...next, value: '1e2' }), null);
  assert.equal(draftReading({ ...next, value: '1.23' }).values.value, '1.23');
});
