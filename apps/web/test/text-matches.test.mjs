import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/features/documents/textMatches.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { textFindQueryLimit, textFindMatchLimit, findTextMatches } =
  await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
  );

test('empty and over-limit queries return no matches', () => {
  assert.equal(textFindQueryLimit, 200);
  assert.equal(textFindMatchLimit, 500);
  assert.deepEqual(findTextMatches([{ page: 1, text: 'medical record' }], ''), {
    matches: [],
    capped: false,
  });
  assert.deepEqual(
    findTextMatches([{ page: 1, text: 'a'.repeat(201) }], 'a'.repeat(201)),
    { matches: [], capped: false },
  );
});

test('query punctuation is literal and whitespace queries are supported', () => {
  assert.deepEqual(
    findTextMatches([{ page: 1, text: 'a+b (c) [d] aab' }], 'a+b'),
    { matches: [{ pageIndex: 0, start: 0, end: 3 }], capped: false },
  );
  assert.deepEqual(findTextMatches([{ page: 1, text: 'one  two' }], ' '), {
    matches: [
      { pageIndex: 0, start: 3, end: 4 },
      { pageIndex: 0, start: 4, end: 5 },
    ],
    capped: false,
  });
});

test('matching follows case-insensitive Unicode semantics and reports UTF-16 offsets', () => {
  const text = '😀Straße K';
  const snapshot = text;
  assert.deepEqual(findTextMatches([{ page: 8, text }], 'straße'), {
    matches: [{ pageIndex: 0, start: 2, end: 8 }],
    capped: false,
  });
  assert.deepEqual(findTextMatches([{ page: 8, text }], 'k'), {
    matches: [{ pageIndex: 0, start: 9, end: 10 }],
    capped: false,
  });
  assert.equal(text, snapshot);
});

test('matches stay within pages and do not overlap', () => {
  assert.deepEqual(
    findTextMatches(
      [
        { page: 4, text: 'ab' },
        { page: 9, text: 'aba' },
      ],
      'aba',
    ),
    { matches: [{ pageIndex: 1, start: 0, end: 3 }], capped: false },
  );
  assert.deepEqual(findTextMatches([{ page: 2, text: 'aaaaa' }], 'aa'), {
    matches: [
      { pageIndex: 0, start: 0, end: 2 },
      { pageIndex: 0, start: 2, end: 4 },
    ],
    capped: false,
  });
});

test('the match cap distinguishes exactly 500 results from more than 500', () => {
  const exactly500 = findTextMatches(
    [{ page: 1, text: 'x '.repeat(500) }],
    'x',
  );
  assert.equal(exactly500.matches.length, 500);
  assert.equal(exactly500.capped, false);

  const over500 = findTextMatches([{ page: 1, text: 'x '.repeat(501) }], 'x');
  assert.equal(over500.matches.length, 500);
  assert.equal(over500.capped, true);
});

test('large source text still returns a bounded result and source strings remain unchanged', () => {
  const text = 'needle '.repeat(71_429).slice(0, 500_000);
  const page = { page: 3, text };
  const before = page.text;
  const result = findTextMatches([page], 'needle');

  assert.equal(result.matches.length, 500);
  assert.equal(result.capped, true);
  assert.equal(page.text, before);
  assert.equal(text.length, before.length);
});

test('HTML-like source content is returned only as ordinary text offsets', () => {
  const text = '<script>alert(1)</script>';
  assert.deepEqual(findTextMatches([{ page: 1, text }], 'script'), {
    matches: [
      { pageIndex: 0, start: 1, end: 7 },
      { pageIndex: 0, start: 18, end: 24 },
    ],
    capped: false,
  });
});
