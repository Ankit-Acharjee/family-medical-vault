import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import {
  isTemporaryLinkCreated,
  isTemporaryLinkActivity,
} from '@fmv/contracts';
const code = ts
  .transpileModule(
    await readFile(
      new URL('../src/features/sharing/incoming-share.ts', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  )
  .outputText.replaceAll(
    "'@fmv/contracts'",
    JSON.stringify(import.meta.resolve('@fmv/contracts')),
  );
const { parseIncomingShare, temporaryShareUrl } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);
const token = 'a'.repeat(43),
  id = '11111111-1111-4111-8111-111111111111';
test('incoming secret stays a strict fragment capability; private routes remain private', () => {
  assert.deepEqual(parseIncomingShare('#shared=' + token), {
    active: true,
    token,
  });
  for (const hash of [
    '#shared',
    '#shared=short',
    '#shared=' + token + '&extra=x',
    '#shared=' + token + '%20',
  ])
    assert.deepEqual(parseIncomingShare(hash), { active: true, token: null });
  assert.deepEqual(parseIncomingShare('#auth-login'), {
    active: false,
    token: null,
  });
  const url = new URL(
    temporaryShareUrl('https://example.test/app?private=value#old', token),
  );
  assert.equal(url.search, '');
  assert.equal(url.hash, '#shared=' + token);
  assert.equal(url.pathname, '/app');
  for (const base of ['javascript:alert(1)', 'https://user:pass@example.test'])
    assert.throws(() => temporaryShareUrl(base, token));
  assert.throws(() => temporaryShareUrl('https://example.test', 'short'));
});
test('creation response cannot recover a replay secret and audit responses reject forged shapes', () => {
  const link = {
    id,
    createdAt: '2026-11-18T00:00:00.000Z',
    expiresAt: '2026-11-19T00:00:00.000Z',
    revokedAt: null,
    state: 'active',
    documentIds: [id],
  };
  assert.ok(isTemporaryLinkCreated({ link, token, created: true }));
  assert.ok(isTemporaryLinkCreated({ link, token: null, created: false }));
  assert.equal(isTemporaryLinkCreated({ link, token, created: false }), false);
  assert.equal(
    isTemporaryLinkCreated({ link, token: null, created: true }),
    false,
  );
  const event = {
    id,
    documentId: null,
    kind: 'link.opened',
    recordedAt: link.createdAt,
  };
  const activity = {
    patientId: id,
    linkId: id,
    events: [event],
    limited: false,
  };
  assert.ok(isTemporaryLinkActivity(activity));
  for (const events of [
    [{ ...event, token }],
    [event, event],
    [{ ...event, kind: 'original.accessed' }],
    [{ ...event, recordedAt: 'invalid' }],
  ])
    assert.equal(isTemporaryLinkActivity({ ...activity, events }), false);
});
