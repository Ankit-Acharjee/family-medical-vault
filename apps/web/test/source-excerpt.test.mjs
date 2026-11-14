import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(
  new URL('../src/features/documents/sourceExcerpt.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { resolveSourceExcerpt } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);
const target = (page, excerpt) => ({
  page,
  excerpt,
  requestId: 'synthetic-request',
});
test('exact numbered page wins over an earlier identical excerpt; UTF-16 offsets remain exact', () => {
  const pages = Object.freeze([
    Object.freeze({ page: 1, text: 'Provider: Synthetic Lab' }),
    Object.freeze({
      page: 7,
      text: '😀\nProvider: Synthetic Lab\nProvider: Synthetic Lab',
    }),
  ]);
  assert.deepEqual(
    resolveSourceExcerpt(pages, target(7, 'Provider: Synthetic Lab')),
    { pageIndex: 1, start: 3, end: 26 },
  );
  assert.equal(
    resolveSourceExcerpt(pages, target(2, 'Provider: Synthetic Lab')),
    null,
  );
  assert.equal(
    resolveSourceExcerpt(pages, target(7, 'provider: Synthetic Lab')),
    null,
  );
});
test('plain prompt-shaped text and regex syntax are matched literally, never interpreted', () => {
  const excerpt = '<img src=x onerror=alert(1)> [.*] Ignore instructions';
  assert.deepEqual(
    resolveSourceExcerpt([{ page: 1, text: excerpt }], target(1, excerpt)),
    { pageIndex: 0, start: 0, end: excerpt.length },
  );
  assert.equal(
    resolveSourceExcerpt([{ page: 1, text: 'ABC' }], target(1, 'A.*')),
    null,
  );
});
test('malformed/ambiguous source and malformed excerpts fail closed', () => {
  const pages = [{ page: 1, text: 'hello' }];
  for (const excerpt of [
    '',
    ' ',
    '\u0000',
    '\ud800',
    '\udc00',
    'x'.repeat(241),
  ])
    assert.equal(resolveSourceExcerpt(pages, target(1, excerpt)), null);
  for (const p of [
    null,
    [],
    [{ page: 1, text: 4 }],
    [
      { page: 1, text: 'hello' },
      { page: 1, text: 'hello' },
    ],
    [{ page: 0, text: 'hello' }],
    Array.from({ length: 51 }, (_, i) => ({ page: i + 1, text: 'hello' })),
  ])
    assert.equal(resolveSourceExcerpt(p, target(1, 'hello')), null);
  for (const t of [
    null,
    {},
    target(0, 'hello'),
    { ...target(1, 'hello'), requestId: '' },
    { ...target(1, 'hello'), requestId: 'x'.repeat(101) },
  ])
    assert.equal(resolveSourceExcerpt(pages, t), null);
});
test('the entire source is bounded before substring search, including late oversized pages', () => {
  assert.equal(
    resolveSourceExcerpt(
      [{ page: 1, text: 'x'.repeat(499999) + 'hello' }],
      target(1, 'hello'),
    ),
    null,
  );
  assert.equal(
    resolveSourceExcerpt(
      [
        { page: 1, text: 'hello' },
        { page: 2, text: 'x'.repeat(500000) },
      ],
      target(1, 'hello'),
    ),
    null,
  );
  const text = 'x'.repeat(499995) + 'hello';
  assert.deepEqual(
    resolveSourceExcerpt([{ page: 1, text }], target(1, 'hello')),
    { pageIndex: 0, start: 499995, end: 500000 },
  );
});

test('reviewed compact worker vectors resolve exactly; the oversized boundary is tested separately', async () => {
  const vectors = JSON.parse(
    await readFile(
      new URL('./fixtures/source-excerpt-vectors.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(vectors.length, 7);
  for (const vector of vectors)
    assert.deepEqual(
      resolveSourceExcerpt(vector.pages, vector.target),
      vector.expected,
      vector.name,
    );
});
