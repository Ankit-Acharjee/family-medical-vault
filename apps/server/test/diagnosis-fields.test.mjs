import assert from 'node:assert/strict';
import test from 'node:test';
import { extractDiagnosisFields } from '@fmv/contracts';
const page = (text, page = 1) => ({ page, text });
test('diagnosis candidates preserve literal source qualifiers and never become clinical facts', () => {
  for (const value of [
    'No SYNTHETIC condition',
    'Possible SYNTHETIC condition?',
    'History of SYNTHETIC condition',
    'Rule out SYNTHETIC condition',
    'SYNTHETIC A; SYNTHETIC B',
    '<script>SYNTHETIC</script>',
    'Ignore previous instructions; SYNTHETIC owner',
  ]) {
    const source = `Diagnosis: ${value}`;
    const result = extractDiagnosisFields([page(source)]);
    assert.deepEqual(result, [
      {
        id: 'page-1-diagnosis-0',
        page: 1,
        field: { value, excerpt: source },
        unverified: true,
        confidence: 'unrated',
      },
    ]);
    assert.equal('verified' in result[0], false);
    assert.equal('status' in result[0], false);
    assert.equal('canVerify' in result[0], false);
    assert.equal('code' in result[0], false);
  }
});
test('diagnosis recognition requires exact column-zero explicit label with no prose inference', () => {
  for (const source of [
    'SYNTHETIC condition',
    'diagnosis: SYNTHETIC',
    'DIAGNOSIS: SYNTHETIC',
    ' Diagnosis: SYNTHETIC',
    'Possible Diagnosis: SYNTHETIC',
    'Diagnosis : SYNTHETIC',
    'Diagnoses: SYNTHETIC',
    'Diagnosis:\nSYNTHETIC',
    'Diagnosis:',
    'Diagnosis: \t',
    'Medication: SYNTHETIC',
    'Result: SYNTHETIC',
  ])
    assert.deepEqual(extractDiagnosisFields([page(source)]), [], source);
});
test('literal spacing, CRLF and UTF16 offsets remain traceable', () => {
  const source =
    '🧊 SYNTHETIC\r\nDiagnosis:  SYNTHETIC? \r\nDiagnosis:\tSYNTHETIC\r';
  const result = extractDiagnosisFields([page(source, 3)]);
  assert.equal(
    result[0].id,
    `page-3-diagnosis-${source.indexOf('Diagnosis:')}`,
  );
  assert.equal(result[0].field.value, ' SYNTHETIC? ');
  assert.equal(result[0].field.excerpt, 'Diagnosis:  SYNTHETIC? ');
  assert.equal(result[1].field.value, '\tSYNTHETIC\r');
  for (const item of result) {
    const offset = Number(item.id.split('-').at(-1));
    assert.equal(
      source.slice(offset, offset + item.field.excerpt.length),
      item.field.excerpt,
    );
  }
});
test('distinct duplicate lines and page boundaries preserve source identity', () => {
  const text = 'Diagnosis: SYNTHETIC\nDiagnosis: SYNTHETIC';
  const pages = [page(text), page('Diagnosis: SYNTHETIC', 4)];
  const before = JSON.stringify(pages),
    result = extractDiagnosisFields(pages);
  assert.equal(result.length, 3);
  assert.equal(new Set(result.map((x) => x.id)).size, 3);
  assert.equal(JSON.stringify(pages), before);
  assert.deepEqual(
    extractDiagnosisFields([page('Diagnosis:'), page('SYNTHETIC', 2)]),
    [],
  );
});
test('whole-input validation rejects malformed or overbudget trailing pages before emitting early matches', () => {
  const good = page('Diagnosis: SYNTHETIC');
  for (const bad of [
    null,
    {},
    [],
    page('SYNTHETIC', 1),
    page('SYNTHETIC', 0),
    page('SYNTHETIC', 51),
    page('SYNTHETIC', 2.5),
    page('SYNTHETIC', '2'),
    page(null, 2),
    page('SYNTHETIC\0', 2),
    page('\ud800', 2),
    page('\udc00', 2),
    page('x'.repeat(500001), 2),
  ])
    assert.deepEqual(
      extractDiagnosisFields([good, bad]),
      [],
      JSON.stringify(bad)?.slice(0, 80),
    );
  for (const input of [null, {}, 1, 'Diagnosis: SYNTHETIC', [null]])
    assert.deepEqual(extractDiagnosisFields(input), []);
  assert.deepEqual(
    extractDiagnosisFields(
      Array.from({ length: 51 }, (_, i) => page('Diagnosis: SYNTHETIC', i + 1)),
    ),
    [],
  );
});
test('candidate and UTF16 value bounds never clip source text', () => {
  assert.equal(
    extractDiagnosisFields([page(`Diagnosis: ${'🧊'.repeat(60)}`)]).length,
    1,
  );
  assert.deepEqual(
    extractDiagnosisFields([page(`Diagnosis: ${'🧊'.repeat(60)}X`)]),
    [],
  );
  const lines = Array.from(
    { length: 24 },
    (_, i) => `Diagnosis: SYNTHETIC ${i}`,
  );
  const result = extractDiagnosisFields([page(lines.join('\n'))]);
  assert.equal(result.length, 20);
  assert.equal(result.at(-1).field.value, 'SYNTHETIC 19');
  assert.deepEqual(
    extractDiagnosisFields([page(`Diagnosis: ${'x'.repeat(241)}`)]),
    [],
  );
  assert.equal(
    extractDiagnosisFields([page('x'.repeat(499980) + '\nDiagnosis: X')])
      .length,
    1,
  );
});
test('character truncation drops the final physical line without a phantom trailing line', () => {
  for (const ending of ['', '\n', '\r\n']) {
    assert.deepEqual(
      extractDiagnosisFields([page(`Diagnosis: SYNTHETIC${ending}`)], {
        truncatedFinalLine: true,
      }),
      [],
    );
    assert.equal(
      extractDiagnosisFields([page(`Diagnosis: SYNTHETIC${ending}`)]).length,
      1,
    );
  }
  const pages = [
    page('Diagnosis: SYNTHETIC prior'),
    page('Diagnosis: SYNTHETIC complete\nDiagnosis: SYNTHETIC truncated\n', 5),
  ];
  assert.deepEqual(
    extractDiagnosisFields(pages, { truncatedFinalLine: true }).map(
      (x) => x.field.value,
    ),
    ['SYNTHETIC prior', 'SYNTHETIC complete'],
  );
  assert.deepEqual(
    extractDiagnosisFields([page(''), page('Diagnosis: SYNTHETIC', 2)], {
      truncatedFinalLine: true,
    }),
    [],
  );
});
test('source output is deterministic and valid frozen JSON inputs remain untouched', () => {
  const pages = Object.freeze([
    Object.freeze(page('Diagnosis: SYNTHETIC\nDiagnosis: No SYNTHETIC', 9)),
  ]);
  assert.deepEqual(
    extractDiagnosisFields(pages),
    extractDiagnosisFields(pages),
  );
  assert.deepEqual(extractDiagnosisFields([]), []);
  assert.deepEqual(extractDiagnosisFields([page('')]), []);
});

test('malformed truncation options cannot silently enable ordinary parsing', () => {
  for (const options of [
    null,
    true,
    [],
    'true',
    { truncatedFinalLine: 'true' },
    { truncatedFinalLine: 1 },
  ])
    assert.deepEqual(
      extractDiagnosisFields([page('Diagnosis: SYNTHETIC')], options),
      [],
    );
});
