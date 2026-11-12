import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createObjectKey, isObjectKey } from '../dist/documents/object-key.js';

test('object keys group private scope and document while allocating fresh attempt names', () => {
  const scope = randomUUID().replaceAll('-', '');
  const documentId = randomUUID();
  const keys = Array.from({ length: 10 }, () =>
    createObjectKey(scope, documentId),
  );
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) {
    assert.equal(
      key.split('/').slice(0, 4).join('/'),
      `originals/v1/${scope}/${documentId.replaceAll('-', '')}`,
    );
    assert.match(key.split('/')[4], /^[a-f0-9]{32}$/);
    assert.equal(isObjectKey(key), true);
  }
});

test('object key validation retains legacy keys and rejects malformed or traversing layouts', () => {
  const key = createObjectKey('a'.repeat(32), randomUUID());
  assert.equal(isObjectKey('b'.repeat(32)), true);
  for (const invalid of [
    '',
    'b'.repeat(31),
    'B'.repeat(32),
    key.toUpperCase(),
    `${key}/extra`,
    `${key}\n`,
    `${'b'.repeat(32)}\n`,
    `/${key}`,
    `${key}/`,
    key.replace('originals/v1/', 'originals/v2/'),
    key.replace('/v1/', '/../'),
    key.replace('a'.repeat(32), randomUUID()),
    `${key}?filename=report.pdf`,
  ])
    assert.equal(isObjectKey(invalid), false, invalid);
});

test('object key construction rejects public IDs and malformed storage identities', () => {
  const scope = 'a'.repeat(32);
  const documentId = randomUUID();
  for (const invalidScope of [
    documentId,
    '../private',
    '',
    'A'.repeat(32),
    'a'.repeat(31),
    `${scope}\n`,
  ])
    assert.throws(() => createObjectKey(invalidScope, documentId));
  for (const invalidDocument of [
    '',
    '../report.pdf',
    documentId.replaceAll('-', ''),
    documentId.toUpperCase(),
    `${documentId}\n`,
  ])
    assert.throws(() => createObjectKey(scope, invalidDocument));
});
