import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  documentSetup,
  ids,
  principals,
  pdf,
} from './support/document-fixture.mjs';

async function result(f, session, method, suffix, body, patientId) {
  const response = await f.request(
    method,
    f.path(suffix, patientId),
    session,
    body,
  );
  assert.equal(
    response.status,
    method === 'POST' ? 201 : 200,
    await response.clone().text(),
  );
  return response.json();
}
const begin = (f, session, declaration = f.input(), patientId) =>
  result(f, session, 'POST', 'uploads', declaration, patientId);
const finish = (f, session, upload, patientId) =>
  result(
    f,
    session,
    'POST',
    `uploads/${upload.uploadId}/finalize`,
    {},
    patientId,
  );
async function upload(
  f,
  session,
  declaration = f.input(),
  bytes = pdf,
  patientId,
) {
  const pending = await begin(f, session, declaration, patientId);
  assert.equal(Object.hasOwn(pending, 'potentialDuplicate'), false);
  const content = await result(
    f,
    session,
    'PUT',
    `uploads/${pending.uploadId}/content`,
    bytes,
    patientId,
  );
  assert.equal(Object.hasOwn(content, 'potentialDuplicate'), false);
  return finish(f, session, pending, patientId);
}
function shape(value, duplicate = false) {
  assert.deepEqual(
    Object.keys(value).sort(),
    [
      'documentId',
      'state',
      'uploadId',
      ...(duplicate ? ['potentialDuplicate'] : []),
    ].sort(),
  );
  assert.equal(value.state, 'ready');
  if (duplicate) assert.equal(value.potentialDuplicate, true);
}

test('exact bytes warn without merging originals, object IO, identity changes or sensitive disclosure', async () =>
  documentSetup(async (f) => {
    const session = await f.login();
    const first = await upload(f, session);
    shape(first);
    const declaration = f.input({ title: 'Different synthetic title.pdf' });
    const second = await upload(f, session, declaration);
    shape(second, true);
    assert.notEqual(second.documentId, first.documentId);
    assert.notEqual(second.uploadId, first.uploadId);
    const before = globalThis.structuredClone([...f.metadata.rows.values()]);
    const events = globalThis.structuredClone(f.metadata.events);
    const io = [
      f.objects.gets.length,
      f.objects.puts.length,
      f.objects.removes.length,
    ];
    assert.deepEqual(await finish(f, session, second), second);
    assert.deepEqual(await begin(f, session, declaration), second);
    assert.deepEqual([...f.metadata.rows.values()], before);
    assert.deepEqual(f.metadata.events, events);
    assert.deepEqual(
      [f.objects.gets.length, f.objects.puts.length, f.objects.removes.length],
      [io[0] + 1, io[1], io[2]],
    );
    assert.equal(f.metadata.rows.size, 2);
    assert.equal(f.objects.puts.length, 2);
    assert.equal(f.objects.gets.length, 3);
    assert.equal(new Set(before.map((row) => row.objectKey)).size, 2);
    assert.deepEqual(
      events.map((event) => event.kind),
      ['document.uploaded', 'document.uploaded'],
    );
    const payload = JSON.stringify(second);
    for (const value of [
      first.documentId,
      first.uploadId,
      declaration.sha256,
      declaration.title,
      ...before.map((row) => row.objectKey),
    ])
      assert.ok(!payload.includes(value));
    const logs = JSON.stringify(f.logs);
    for (const value of [
      declaration.sha256,
      declaration.title,
      first.documentId,
      second.documentId,
      ...before.map((row) => row.objectKey),
    ])
      assert.ok(!logs.includes(value));
  }));

test('same filename with different bytes does not warn; renamed originals still match', async () =>
  documentSetup(async (f) => {
    const session = await f.login();
    const first = await upload(f, session);
    const different = Buffer.from(
      '%PDF-1.7\nOther synthetic original\n%%EOF\n',
    );
    shape(
      await upload(
        f,
        session,
        f.input({
          bytes: different.length,
          sha256: createHash('sha256').update(different).digest('hex'),
        }),
        different,
      ),
    );
    await result(f, session, 'PATCH', `documents/${first.documentId}/title`, {
      title: 'Changed display title',
    });
    shape(await upload(f, session), true);
  }));

for (const action of ['view', 'export']) {
  for (const scopeKind of ['document', 'category']) {
    test(`${action} on the candidate independently permits warning with separate upload grant (${scopeKind})`, async () =>
      documentSetup(async (f) => {
        const owner = await f.login();
        const candidate = await upload(f, owner);
        f.access.grant({
          actions: ['upload'],
          scope: { kind: 'category', categoryId: ids.otherCategory },
        });
        f.access.grant({
          actions: [action],
          scope:
            scopeKind === 'document'
              ? { kind: 'document', documentId: candidate.documentId }
              : { kind: 'category', categoryId: ids.category },
        });
        const session = await f.login(principals.caregiver.subject);
        shape(
          await upload(f, session, f.input({ categoryId: ids.otherCategory })),
          true,
        );
      }));
  }
}

for (const actions of [['upload'], ['upload', 'edit'], ['upload', 'manage']]) {
  test(`${actions.join('/')} does not disclose unreadable exact matches`, async () =>
    documentSetup(async (f) => {
      const owner = await f.login();
      await upload(f, owner);
      f.access.grant({ actions });
      const session = await f.login(principals.caregiver.subject);
      const declaration = f.input();
      const stored = await upload(f, session, declaration);
      shape(stored);
      shape(await finish(f, session, stored));
      shape(await begin(f, session, declaration));
    }));
}

for (const state of [
  'expired',
  'revoked',
  'wrong-category',
  'wrong-document',
]) {
  test(`${state} candidate read access does not warn on finalize or ready replay`, async () =>
    documentSetup(async (f) => {
      const owner = await f.login();
      const candidate = await upload(f, owner);
      f.access.grant({ actions: ['upload'] });
      const read = f.access.grant({
        actions: ['view', 'export'],
        scope: { kind: 'document', documentId: candidate.documentId },
      });
      if (state === 'expired') read.expiresAt = new Date(f.access.now);
      if (state === 'revoked') read.revokedAt = new Date(f.access.now);
      if (state === 'wrong-category')
        read.scope = { kind: 'category', categoryId: ids.otherCategory };
      if (state === 'wrong-document')
        read.scope.documentId = ids.unknownDocument;
      const session = await f.login(principals.caregiver.subject);
      const declaration = f.input();
      const stored = await upload(f, session, declaration);
      shape(stored);
      shape(await begin(f, session, declaration));
      shape(await finish(f, session, stored));
    }));
}

test('foreign patient exact bytes never contribute a duplicate warning', async () =>
  documentSetup(async (f) => {
    const stranger = await f.login(principals.stranger.subject);
    await upload(f, stranger, f.input(), pdf, ids.otherPatient);
    const owner = await f.login();
    shape(await upload(f, owner));
  }));

for (const mismatch of ['pending', 'failed', 'bytes', 'sha256']) {
  test(`${mismatch} candidate is excluded; matching requires ready state, size and hash`, async () =>
    documentSetup(async (f) => {
      const session = await f.login();
      const candidate = await upload(f, session);
      const row = f.metadata.rows.get(candidate.uploadId);
      if (mismatch === 'pending' || mismatch === 'failed') row.state = mismatch;
      if (mismatch === 'bytes') row.bytes += 1;
      if (mismatch === 'sha256') row.sha256 = '0'.repeat(64);
      f.metadata.sync(row);
      shape(await upload(f, session));
    }));
}

test('advisory metadata failure keeps newly stored ready success and replays available', async () =>
  documentSetup(async (f) => {
    const session = await f.login();
    await upload(f, session);
    const original = f.metadata.list;
    f.metadata.list = async () => {
      throw new Error('synthetic sensitive advisory failure');
    };
    try {
      const declaration = f.input();
      const stored = await upload(f, session, declaration);
      shape(stored);
      assert.equal(f.metadata.rows.get(stored.uploadId).state, 'ready');
      shape(await finish(f, session, stored));
      shape(await begin(f, session, declaration));
      assert.equal(f.metadata.rows.size, 2);
      assert.equal(f.metadata.events.length, 2);
      assert.ok(
        !JSON.stringify(f.logs).includes(
          'synthetic sensitive advisory failure',
        ),
      );
    } finally {
      f.metadata.list = original;
    }
  }));

test('ready replay recomputes warning after candidate read grant revocation', async () =>
  documentSetup(async (f) => {
    const owner = await f.login();
    const candidate = await upload(f, owner);
    f.access.grant({ actions: ['upload'] });
    const read = f.access.grant({
      actions: ['view'],
      scope: { kind: 'document', documentId: candidate.documentId },
    });
    const session = await f.login(principals.caregiver.subject);
    const declaration = f.input();
    const stored = await upload(f, session, declaration);
    shape(stored, true);
    read.revokedAt = new Date(f.access.now);
    shape(await begin(f, session, declaration));
    shape(await finish(f, session, stored));
  }));

test('upload authorization loss during advisory lookup denies response while preserving committed ready original', async () =>
  documentSetup(async (f) => {
    const owner = await f.login();
    await upload(f, owner);
    const grant = f.access.grant({ actions: ['upload', 'view'] });
    const session = await f.login(principals.caregiver.subject);
    const pending = await begin(f, session);
    await result(f, session, 'PUT', `uploads/${pending.uploadId}/content`, pdf);
    const original = f.metadata.list;
    f.metadata.list = async function (...args) {
      const rows = await original.apply(this, args);
      grant.revokedAt = new Date(f.access.now);
      return rows;
    };
    try {
      const response = await f.request(
        'POST',
        f.path(`uploads/${pending.uploadId}/finalize`),
        session,
        {},
      );
      assert.equal(response.status, 404, await response.clone().text());
      assert.ok(!(await response.text()).includes('potentialDuplicate'));
      assert.equal(f.metadata.rows.get(pending.uploadId).state, 'ready');
    } finally {
      f.metadata.list = original;
    }
  }));

test('candidate read revocation during advisory lookup suppresses warning with upload permission retained', async () =>
  documentSetup(async (f) => {
    const owner = await f.login();
    const candidate = await upload(f, owner);
    f.access.grant({ actions: ['upload'] });
    const read = f.access.grant({
      actions: ['export'],
      scope: { kind: 'document', documentId: candidate.documentId },
    });
    const session = await f.login(principals.caregiver.subject);
    const original = f.metadata.list;
    f.metadata.list = async function (...args) {
      const rows = await original.apply(this, args);
      read.revokedAt = new Date(f.access.now);
      return rows;
    };
    try {
      shape(await upload(f, session));
    } finally {
      f.metadata.list = original;
    }
  }));
