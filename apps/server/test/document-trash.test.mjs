import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import {
  documentSetup,
  ids,
  principals,
  pdf,
} from './support/document-fixture.mjs';

async function expect(response, status) {
  assert.equal(
    response.status,
    status,
    response.status === status ? undefined : await response.text(),
  );
  return response;
}
async function ready(f, session, declaration = f.input()) {
  const upload = await (
    await expect(
      await f.request('POST', f.path('uploads'), session, declaration),
      201,
    )
  ).json();
  await expect(
    await f.request(
      'PUT',
      f.path(`uploads/${upload.uploadId}/content`),
      session,
      pdf,
    ),
    200,
  );
  await expect(
    await f.request(
      'POST',
      f.path(`uploads/${upload.uploadId}/finalize`),
      session,
      {},
    ),
    201,
  );
  return upload;
}
const change = (
  f,
  session,
  upload,
  action = 'trash',
  body = {},
  headers = {},
  patient = ids.patient,
) =>
  f.request(
    'POST',
    f.path(`documents/${upload.documentId}/${action}`, patient),
    session,
    body,
    headers,
  );
async function trashList(f, session) {
  return (
    await expect(await f.request('GET', f.path('trash'), session), 200)
  ).json();
}

test('Trash lifecycle hides all ordinary operations, preserves original objects and replay identity, and restores once', async () =>
  documentSetup(async (f) => {
    const session = await f.login(),
      declaration = f.input(),
      upload = await ready(f, session, declaration);
    const before = globalThis.structuredClone(
      f.metadata.rows.get(upload.uploadId),
    );
    const io = [f.objects.puts.length, f.objects.removes.length];
    assert.deepEqual(
      await (await expect(await change(f, session, upload), 200)).json(),
      { saved: true },
    );
    const deletedAt = new Date(f.access.now);
    f.access.now = new Date(deletedAt.getTime() + 86400000);
    await expect(await change(f, session, upload), 200);
    assert.deepEqual(f.metadata.rows.get(upload.uploadId), {
      ...before,
      deletedAt,
    });
    const {
      documents: [entry],
    } = await trashList(f, session);
    assert.equal(entry.id, upload.documentId);
    assert.equal(entry.deletedAt, deletedAt.toISOString());
    assert.equal(
      entry.restoreUntil,
      new Date(deletedAt.getTime() + 30 * 86400000).toISOString(),
    );
    assert.equal(entry.canRestore, true);
    for (const action of ['canView', 'canExport', 'canEdit'])
      assert.equal(entry[action], false);
    const ordinary = await (
      await expect(await f.request('GET', f.path('documents'), session), 200)
    ).json();
    assert.deepEqual(ordinary.documents, []);
    for (const suffix of ['preview', 'download'])
      await expect(
        await f.request(
          'GET',
          f.path(`documents/${upload.documentId}/${suffix}`),
          session,
        ),
        404,
      );
    await expect(
      await f.request(
        'PATCH',
        f.path(`documents/${upload.documentId}/title`),
        session,
        { title: 'Denied' },
      ),
      404,
    );
    await expect(
      await f.request('POST', f.path('uploads'), session, declaration),
      404,
    );
    await expect(
      await f.request(
        'PUT',
        f.path(`uploads/${upload.uploadId}/content`),
        session,
        pdf,
      ),
      404,
    );
    await expect(
      await f.request(
        'POST',
        f.path(`uploads/${upload.uploadId}/finalize`),
        session,
        {},
      ),
      404,
    );
    assert.deepEqual([f.objects.puts.length, f.objects.removes.length], io);
    await expect(await change(f, session, upload, 'restore'), 200);
    await expect(await change(f, session, upload, 'restore'), 200);
    assert.equal(f.metadata.rows.get(upload.uploadId).deletedAt, null);
    assert.deepEqual((await trashList(f, session)).documents, []);
    const download = await expect(
      await f.request(
        'GET',
        f.path(`documents/${upload.documentId}/download`),
        session,
      ),
      200,
    );
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
    assert.deepEqual(
      f.metadata.events.filter(({ kind }) =>
        ['document.trashed', 'document.restored'].includes(kind),
      ),
      [
        {
          patientId: ids.patient,
          documentId: upload.documentId,
          accountId: ids.owner,
          kind: 'document.trashed',
        },
        {
          patientId: ids.patient,
          documentId: upload.documentId,
          accountId: ids.owner,
          kind: 'document.restored',
        },
      ],
    );
  }));

test('restore uses the exact server 30-day boundary and retrying Trash cannot extend it', async () =>
  documentSetup(async (f) => {
    const session = await f.login(),
      upload = await ready(f, session);
    await expect(await change(f, session, upload), 200);
    const deadline = f.access.now.getTime() + 30 * 86400000;
    f.access.now = new Date(deadline - 1);
    assert.equal((await trashList(f, session)).documents[0].canRestore, true);
    await expect(await change(f, session, upload, 'restore'), 200);
    await expect(await change(f, session, upload), 200);
    const secondDeadline = f.access.now.getTime() + 30 * 86400000;
    for (const now of [secondDeadline, secondDeadline + 1]) {
      f.access.now = new Date(now);
      await expect(await change(f, session, upload), 200);
      assert.equal(
        (await trashList(f, session)).documents[0].canRestore,
        false,
      );
      await expect(await change(f, session, upload, 'restore'), 409);
    }
    assert.equal(
      f.metadata.events.filter(({ kind }) => kind === 'document.restored')
        .length,
      1,
    );
  }));

test('edit is independent from metadata disclosure, scope, manage/upload, revoked and expired authority', async () =>
  documentSetup(async (f) => {
    const owner = await f.login(),
      upload = await ready(f, owner);
    const other = await ready(
      f,
      owner,
      f.input({ categoryId: ids.otherCategory }),
    );
    const grant = f.access.grant({
      actions: ['edit'],
      scope: { kind: 'document', documentId: upload.documentId },
    });
    const session = await f.login(principals.caregiver.subject);
    await expect(await change(f, session, upload), 200);
    assert.deepEqual((await trashList(f, session)).documents, []);
    await expect(await change(f, session, other), 404);
    const view = f.access.grant({
      actions: ['export'],
      scope: { kind: 'category', categoryId: ids.category },
    });
    assert.equal(
      (await trashList(f, session)).documents[0].id,
      upload.documentId,
    );
    view.scope = { kind: 'category', categoryId: ids.otherCategory };
    assert.deepEqual((await trashList(f, session)).documents, []);
    for (const actions of [['view'], ['export'], ['manage'], ['upload']]) {
      grant.actions = actions;
      await expect(await change(f, session, upload, 'restore'), 404);
    }
    grant.actions = ['edit'];
    for (const field of ['revokedAt', 'expiresAt']) {
      grant[field] = new Date(f.access.now);
      await expect(await change(f, session, upload, 'restore'), 404);
      grant[field] = null;
    }
    for (const patient of [ids.otherPatient, ids.unknownPatient])
      await expect(
        await change(f, session, upload, 'restore', {}, {}, patient),
        404,
      );
    await expect(await change(f, session, upload, 'restore'), 200);
  }));

test('Trash mutations require authentication, exact empty bodies and CSRF without changing records', async () =>
  documentSetup(async (f) => {
    const session = await f.login(),
      upload = await ready(f, session);
    for (const action of ['trash', 'restore']) {
      await expect(await change(f, undefined, upload, action), 401);
      for (const body of [
        null,
        [],
        { deletedAt: '2030-01-01' },
        { patientId: ids.patient },
        { title: 'x' },
      ])
        await expect(await change(f, session, upload, action, body), 400);
      for (const headers of [
        { 'X-CSRF-Token': undefined },
        { 'X-CSRF-Token': 'x'.repeat(43) },
        { Origin: undefined },
        { Origin: 'https://evil.example.test' },
      ])
        await expect(
          await change(f, session, upload, action, {}, headers),
          403,
        );
    }
    assert.ok(!f.metadata.rows.get(upload.uploadId).deletedAt);
  }));

test('Trash and restore roll back metadata, authority visibility and audit on storage or final authorization failure', async () =>
  documentSetup(async (f) => {
    const owner = await f.login(),
      upload = await ready(f, owner);
    const grant = f.access.grant({ actions: ['edit'] });
    const session = await f.login(principals.caregiver.subject);
    const implementation = f.metadata.changeTrash.bind(f.metadata);
    for (const action of ['trash', 'restore']) {
      if (action === 'restore')
        await expect(await change(f, owner, upload), 200);
      const snapshot = globalThis.structuredClone(
          f.metadata.rows.get(upload.uploadId),
        ),
        events = globalThis.structuredClone(f.metadata.events);
      for (const failure of [
        'trash',
        'audit',
        'commit',
        'revoke1',
        'revoke2',
      ]) {
        grant.revokedAt = null;
        f.metadata.fail = ['trash', 'audit'].includes(failure) ? failure : null;
        f.metadata.failCommit = failure === 'commit';
        let checks = 0;
        f.metadata.changeTrash = (
          patient,
          document,
          operation,
          account,
          authorize,
        ) =>
          implementation(patient, document, operation, account, async () => {
            if (`revoke${++checks}` === failure)
              grant.revokedAt = new Date(f.access.now);
            await authorize();
          });
        const response = await expect(
          await change(f, session, upload, action),
          failure.startsWith('revoke') ? 404 : 503,
        );
        assert.ok(!(await response.text()).includes('sensitive'));
        assert.deepEqual(f.metadata.rows.get(upload.uploadId), snapshot);
        assert.deepEqual(f.metadata.events, events);
        assert.deepEqual(
          f.access.documents.get(upload.documentId).deletedAt,
          snapshot.deletedAt,
        );
      }
      grant.revokedAt = null;
      f.metadata.fail = null;
      f.metadata.changeTrash = implementation;
    }
    await expect(await change(f, session, upload, 'restore'), 200);
  }));

test('Trash denies pending and unknown records and removes duplicate warnings without retiring originals', async () =>
  documentSetup(async (f) => {
    const session = await f.login(),
      first = await ready(f, session);
    const pending = await (
      await expect(
        await f.request('POST', f.path('uploads'), session, f.input()),
        201,
      )
    ).json();
    for (const upload of [pending, { documentId: ids.unknownDocument }]) {
      for (const action of ['trash', 'restore'])
        await expect(await change(f, session, upload, action), 404);
    }
    await expect(await change(f, session, first), 200);
    await expect(
      await f.request(
        'PUT',
        f.path(`uploads/${pending.uploadId}/content`),
        session,
        pdf,
      ),
      200,
    );
    const finalized = await (
      await expect(
        await f.request(
          'POST',
          f.path(`uploads/${pending.uploadId}/finalize`),
          session,
          {},
        ),
        201,
      )
    ).json();
    assert.equal(Object.hasOwn(finalized, 'potentialDuplicate'), false);
    assert.equal(
      f.objects.removes.includes(f.metadata.rows.get(first.uploadId).objectKey),
      false,
    );
    assert.equal(
      f.metadata.manifests.get(f.metadata.rows.get(first.uploadId).objectKey)
        .retiredAt,
      null,
    );
  }));

test('Trash during original-byte retrieval blocks delivery and concurrent retries emit a single audit event', async () =>
  documentSetup(async (f) => {
    const session = await f.login(),
      upload = await ready(f, session);
    f.objects.onGet = async () => {
      await expect(await change(f, session, upload), 200);
    };
    await expect(
      await f.request(
        'GET',
        f.path(`documents/${upload.documentId}/preview`),
        session,
      ),
      404,
    );
    f.objects.onGet = undefined;
    await expect(await change(f, session, upload, 'restore'), 200);
    for (const response of await Promise.all(
      Array.from({ length: 4 }, () => change(f, session, upload)),
    ))
      await expect(response, 200);
    assert.equal(
      f.metadata.events.filter(({ kind }) => kind === 'document.trashed')
        .length,
      2,
    );
    assert.equal(
      f.metadata.events.filter(({ kind }) => kind === 'document.viewed').length,
      0,
    );
  }));
