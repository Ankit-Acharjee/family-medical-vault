import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(
  new URL('../src/features/medications/draft.ts', import.meta.url),
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
const {
  emptyMedicationDraft,
  sourceMedicationDraft,
  recordedMedicationDraft,
  medicationDraftFields,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);
test('medication source drafts preserve literals and never infer current status', () => {
  const source = {
    fields: Object.fromEntries(
      [
        'medication',
        'strength',
        'dose',
        'frequency',
        'route',
        'duration',
        'start',
        'end',
        'instructions',
      ].map((k) => [
        k,
        k === 'medication'
          ? {
              value: 'SYNTHETIC stopped?',
              excerpt: 'Medication: SYNTHETIC stopped?',
            }
          : k === 'dose'
            ? {
                value: ' 0.000001 unknown units ',
                excerpt: 'Dose:  0.000001 unknown units ',
              }
            : null,
      ]),
    ),
  };
  const draft = sourceMedicationDraft(source);
  assert.equal(draft.status, '');
  assert.equal(draft.fields.dose, ' 0.000001 unknown units ');
  assert.equal(medicationDraftFields(draft), null);
  draft.status = 'historical';
  const fields = medicationDraftFields(draft);
  assert.equal(fields.dose, ' 0.000001 unknown units ');
  assert.equal(fields.frequency, null);
  assert.equal(fields.start, null);
  assert.equal(source.fields.frequency, null);
});
test('existing medication drafts preserve owner corrections and explicit status', () => {
  const entry = {
    recordedStatus: 'current',
    fields: {
      medication: 'SYNTHETIC',
      strength: null,
      dose: 'owner correction?',
      frequency: 'as written',
      route: null,
      duration: null,
      start: 'unknown date',
      end: null,
      instructions: null,
    },
  };
  const draft = recordedMedicationDraft(entry);
  assert.deepEqual(medicationDraftFields(draft), entry.fields);
  draft.fields.dose = 'changed';
  assert.equal(entry.fields.dose, 'owner correction?');
  assert.equal(draft.status, 'current');
});
test('medication drafts reject malformed literal fields without silently rewriting them', () => {
  const d = emptyMedicationDraft();
  assert.equal(medicationDraftFields(d), null);
  d.status = 'current';
  d.fields.medication = 'SYNTHETIC';
  assert.ok(medicationDraftFields(d));
  for (const v of ['   ', 'x'.repeat(121), 'a\nb', 'a\rb', '\ud800']) {
    d.fields.dose = v;
    assert.equal(medicationDraftFields(d), null);
    assert.equal(d.fields.dose, v);
  }
  d.fields.dose = '';
  assert.equal(medicationDraftFields(d).dose, null);
  d.fields.medication = '';
  assert.equal(medicationDraftFields(d), null);
});
