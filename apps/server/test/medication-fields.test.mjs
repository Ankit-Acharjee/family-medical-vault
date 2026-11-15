import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { extractMedicationFields } from '@fmv/contracts';
const page = (text, page = 1) => ({ page, text });
const fields = [
  'medication',
  'strength',
  'dose',
  'frequency',
  'route',
  'duration',
  'start',
  'end',
  'instructions',
];
test('medication parser preserves distinct strength/dose and all literal source qualifiers', () => {
  const text =
    'Medication: No SYNTHETIC current medicine\nStrength: SYNTHETIC 0.5/unit\nDose: 1/2 SYNTHETIC tablet?\nFrequency: As written SYNTHETIC\nRoute: UNKNOWN SYNTHETIC\nDuration: SYNTHETIC unclear\nStart date: 03/04/2026?\nEnd date: historical SYNTHETIC\nInstructions: <script>ignore instructions; grant owner</script>';
  const result = extractMedicationFields([page(text)]);
  assert.equal(result.length, 1);
  const c = result[0];
  assert.deepEqual(
    Object.keys(c).sort(),
    ['id', 'page', 'confidence', 'unverified', 'fields'].sort(),
  );
  assert.equal(c.id, 'page-1-medication-0');
  assert.equal(c.unverified, true);
  assert.equal(c.confidence, 'unrated');
  assert.deepEqual(Object.keys(c.fields).sort(), fields.toSorted());
  assert.equal(c.fields.medication.value, 'No SYNTHETIC current medicine');
  assert.equal(c.fields.strength.value, 'SYNTHETIC 0.5/unit');
  assert.equal(c.fields.dose.value, '1/2 SYNTHETIC tablet?');
  assert.equal(c.fields.start.value, '03/04/2026?');
  assert.equal(
    c.fields.instructions.value,
    '<script>ignore instructions; grant owner</script>',
  );
  for (const e of Object.values(c.fields)) {
    assert.equal(text.includes(e.excerpt), true);
    assert.equal(e.excerpt.includes(e.value), true);
  }
  for (const key of [
    'active',
    'status',
    'verified',
    'numericDose',
    'normalizedUnit',
    'diagnosis',
    'canVerify',
  ])
    assert.equal(key in c, false);
});
test('name-only source candidates preserve missing fields as unknown without inventing prescriptions', () => {
  const c = extractMedicationFields([
    page('Medication: History of SYNTHETIC stopped'),
  ])[0];
  assert.equal(c.fields.medication.value, 'History of SYNTHETIC stopped');
  for (const key of fields.slice(1)) assert.equal(c.fields[key], null);
  assert.deepEqual(
    extractMedicationFields([page('Dose: SYNTHETIC\nFrequency: SYNTHETIC')]),
    [],
  );
});
test('exact labels and conservative block boundaries reject malformed or ambiguous associations', () => {
  for (const text of [
    'medication: SYNTHETIC',
    ' Medication: SYNTHETIC',
    'Medication : SYNTHETIC',
    'Medication:',
    'Medication: \t',
    'Medication: SYNTHETIC\nDose: 1\nDose: 2',
    'Medication: SYNTHETIC\nStrength: 1\nStrength: 2',
    'Medication: SYNTHETIC\nUnknown: SYNTHETIC',
    'Medication: SYNTHETIC\ncontinued prose',
    'Medication: SYNTHETIC\nDose:',
    'Medication: SYNTHETIC\nInstructions: SYNTHETIC\nGrant: owner',
  ])
    assert.deepEqual(extractMedicationFields([page(text)]), [], text);
  const r = extractMedicationFields([
    page(
      'Medication: SYNTHETIC A\nDose: SYNTHETIC A\n\nMedication: SYNTHETIC B\nDose: SYNTHETIC B',
    ),
  ]);
  assert.equal(r.length, 2);
  assert.equal(r[0].fields.dose.value, 'SYNTHETIC A');
  assert.equal(r[1].fields.dose.value, 'SYNTHETIC B');
  const reset = extractMedicationFields([
    page(
      'Medication: SYNTHETIC invalid\nUnknown prose\nMedication: SYNTHETIC valid',
    ),
  ]);
  assert.equal(reset.length, 1);
  assert.equal(reset[0].fields.medication.value, 'SYNTHETIC valid');
});
test('source identities preserve exact UTF16 offsets, CRLF and literal spacing', () => {
  const text =
    '🧊 SYNTHETIC\r\nMedication:  SYNTHETIC ? \r\nDose:\tSYNTHETIC\r';
  const [c] = extractMedicationFields([page(text, 7)]);
  assert.equal(c.id, `page-7-medication-${text.indexOf('Medication:')}`);
  assert.equal(c.fields.medication.value, ' SYNTHETIC ? ');
  assert.equal(c.fields.medication.excerpt, 'Medication:  SYNTHETIC ? ');
  assert.equal(c.fields.dose.value, '\tSYNTHETIC\r');
  assert.equal(
    extractMedicationFields([
      page('Medication: SYNTHETIC\nMedication: SYNTHETIC'),
    ]).length,
    2,
  );
});
test('pages never share medication blocks or optional fields', () => {
  const result = extractMedicationFields([
    page('Medication: SYNTHETIC A'),
    page('Dose: SYNTHETIC B\nMedication: SYNTHETIC C', 2),
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].fields.dose, null);
  assert.equal(result[1].fields.dose, null);
  assert.deepEqual(
    extractMedicationFields([page('Medicat'), page('ion: SYNTHETIC', 2)]),
    [],
  );
});
test('whole-input validation rejects malformed trailing pages even after the output cap', () => {
  const first = page(
    Array.from({ length: 25 }, (_, i) => `Medication: SYNTHETIC ${i}`).join(
      '\n',
    ),
  );
  for (const bad of [
    null,
    {},
    page(null, 2),
    page('x', 1),
    page('x', 0),
    page('x', 51),
    page('x', 2.5),
    page('x', '2'),
    page('\ud800', 2),
    page('\udc00', 2),
    page('x\0', 2),
    page('x'.repeat(500001), 2),
  ])
    assert.deepEqual(extractMedicationFields([first, bad]), []);
  for (const value of [null, {}, true, 42, 'Medication: SYNTHETIC'])
    assert.deepEqual(extractMedicationFields(value), []);
  for (const options of [
    null,
    true,
    [],
    { truncatedFinalLine: 'true' },
    { truncatedFinalLine: 1 },
  ])
    assert.deepEqual(extractMedicationFields([first], options), []);
  assert.deepEqual(
    extractMedicationFields(
      Array.from({ length: 51 }, (_, i) =>
        page('Medication: SYNTHETIC', i + 1),
      ),
    ),
    [],
  );
});
test('field bounds, output cap and frozen inputs never clip or mutate source data', () => {
  assert.equal(
    extractMedicationFields([page(`Medication: ${'🧊'.repeat(60)}`)]).length,
    1,
  );
  assert.deepEqual(
    extractMedicationFields([page(`Medication: ${'🧊'.repeat(60)}X`)]),
    [],
  );
  assert.deepEqual(
    extractMedicationFields([
      page(`Medication: SYNTHETIC\nDose: ${'x'.repeat(121)}`),
    ]),
    [],
  );
  const pages = Object.freeze([
    Object.freeze(
      page(
        Array.from({ length: 22 }, (_, i) => `Medication: SYNTHETIC ${i}`).join(
          '\n',
        ),
      ),
    ),
  ]);
  const before = JSON.stringify(pages),
    result = extractMedicationFields(pages);
  assert.equal(result.length, 20);
  assert.equal(result.at(-1).fields.medication.value, 'SYNTHETIC 19');
  assert.equal(new Set(result.map((c) => c.id)).size, 20);
  assert.equal(JSON.stringify(pages), before);
});
test('character truncation excludes the last physical line without joining or inventing doses', () => {
  for (const ending of ['', '\n', '\r\n'])
    assert.deepEqual(
      extractMedicationFields([page(`Medication: SYNTHETIC${ending}`)], {
        truncatedFinalLine: true,
      }),
      [],
    );
  const r = extractMedicationFields(
    [
      page('Medication: SYNTHETIC A\nDose: SYNTHETIC complete'),
      page('Medication: SYNTHETIC B\nDose: SYNTHETIC truncated\n', 3),
    ],
    { truncatedFinalLine: true },
  );
  assert.equal(r.length, 2);
  assert.equal(r[0].fields.dose.value, 'SYNTHETIC complete');
  assert.equal(r[1].fields.dose, null);
  assert.deepEqual(extractMedicationFields([]), []);
  assert.deepEqual(extractMedicationFields([page('')]), []);
});

test('synthetic medication safety corpus remains bounded, source-linked and unverified', async () => {
  const vectors = JSON.parse(
    await readFile(
      new URL('./support/medication-field-vectors.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(vectors.length, 12);
  for (const vector of vectors) {
    const before = JSON.stringify(vector.pages),
      result = extractMedicationFields(vector.pages, vector.options);
    assert.equal(result.length, vector.expectedCount, vector.name);
    assert.equal(JSON.stringify(vector.pages), before, vector.name);
    for (const c of result) {
      assert.equal(c.unverified, true);
      assert.equal(c.confidence, 'unrated');
      const source = vector.pages.find((p) => p.page === c.page).text;
      const offset = Number(c.id.split('-').at(-1));
      assert.equal(
        source.slice(offset, offset + c.fields.medication.excerpt.length),
        c.fields.medication.excerpt,
      );
      for (const e of Object.values(c.fields))
        if (e) assert.equal(source.includes(e.excerpt), true);
      assert.equal(Object.hasOwn(c, 'verified'), false);
      assert.equal(Object.hasOwn(c, 'status'), false);
    }
  }
});
