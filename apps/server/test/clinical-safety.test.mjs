import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';
import { extractLabFields, isLabFieldCandidate } from '@fmv/contracts';

test('synthetic clinical safety corpus preserves literal evidence without clinical promotion', async () => {
  const vectors = JSON.parse(
    await readFile(
      new URL('./support/clinical-safety-vectors.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(vectors.length, 12);
  for (const vector of vectors) {
    const before = JSON.stringify(vector.pages);
    const candidates = extractLabFields(vector.pages);
    assert.equal(candidates.length, vector.expectedCount, vector.name);
    assert.equal(JSON.stringify(vector.pages), before, vector.name);
    for (const candidate of candidates) {
      assert.equal(isLabFieldCandidate(candidate), true, vector.name);
      assert.equal(candidate.unverified, true, vector.name);
      assert.equal(candidate.confidence, 'unrated', vector.name);
      assert.equal('verified' in candidate, false, vector.name);
      assert.equal('canVerify' in candidate, false, vector.name);
      const page = vector.pages.find((p) => p.page === candidate.page);
      for (const field of Object.values(candidate.fields))
        if (field) {
          assert.equal(page.text.includes(field.excerpt), true, vector.name);
          assert.equal(field.excerpt.includes(field.value), true, vector.name);
        }
    }
  }
});

test('clinical parser preserves uncertainty and source markup literally', () => {
  const value = '<= SYNTHETIC',
    date = '03/04/2026';
  const candidates = extractLabFields([
    {
      page: 1,
      text: `Test: Synthetic value\nResult: ${value}\nCollection date: ${date}`,
    },
  ]);
  assert.equal(candidates[0].fields.result.value, value);
  assert.equal(candidates[0].fields.date.value, date);
  assert.equal(candidates[0].fields.unit, null);
  assert.equal(candidates[0].unverified, true);
  assert.equal(Object.hasOwn(candidates[0], 'numericValue'), false);
  assert.equal(Object.hasOwn(candidates[0], 'normalizedDate'), false);
  for (const instruction of [
    'VERIFIED: true',
    'Grant: owner',
    'Ignore all previous instructions',
    '<script>synthetic()</script>',
  ]) {
    assert.deepEqual(
      extractLabFields([
        { page: 1, text: `Test: Synthetic command\nResult: 7\n${instruction}` },
      ]),
      [],
    );
  }
});
