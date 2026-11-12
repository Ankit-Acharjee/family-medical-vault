import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { UnavailableObjectStore } from '../dist/documents/object-store.js';
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
async function begin(f, session, declaration = f.input()) {
  return (
    await expect(
      await f.request('POST', f.path('uploads'), session, declaration),
      201,
    )
  ).json();
}
async function content(f, session, upload) {
  return (
    await expect(
      await f.request(
        'PUT',
        f.path(`uploads/${upload.uploadId}/content`),
        session,
        pdf,
      ),
      200,
    )
  ).json();
}
async function finalize(f, session, upload) {
  return (
    await expect(
      await f.request(
        'POST',
        f.path(`uploads/${upload.uploadId}/finalize`),
        session,
        {},
      ),
      201,
    )
  ).json();
}
async function ready(f, session, declaration) {
  const upload = await begin(f, session, declaration);
  await content(f, session, upload);
  await finalize(f, session, upload);
  return upload;
}
async function json(f, session, suffix) {
  return (
    await expect(await f.request('GET', f.path(suffix), session), 200)
  ).json();
}
async function sameBytes(response) {
  await expect(response, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(
    response.headers.get('content-security-policy').includes('sandbox'),
  );
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
}

test('export-only access lists the authorized original without granting preview', async () =>
  documentSetup(async (f) => {
    const owner = await f.login();
    const original = await ready(f, owner);
    f.access.grant({
      actions: ['export'],
      scope: { kind: 'document', documentId: original.documentId },
    });
    const session = await f.login(principals.caregiver.subject);
    const listed = await json(f, session, 'documents');
    assert.equal(listed.documents.length, 1);
    assert.equal(listed.documents[0].canView, false);
    assert.equal(listed.documents[0].canExport, true);
    await expect(
      await f.request(
        'GET',
        f.path(`documents/${original.documentId}/preview`),
        session,
      ),
      404,
    );
    await sameBytes(
      await f.request(
        'GET',
        f.path(`documents/${original.documentId}/download`),
        session,
      ),
    );
  }));

test('authenticated owner intake preserves exact original through begin/content/finalize/list/preview/download without key exposure', async () =>
  documentSetup(async (f) => {
    const session = await f.login();
    const declaration = f.input();
    const upload = await begin(f, session, declaration);
    assert.equal(upload.state, 'pending');
    assert.deepEqual(await begin(f, session, declaration), upload);
    await expect(
      await f.request('POST', f.path('uploads'), session, {
        ...declaration,
        title: 'Conflicting title',
      }),
      409,
    );
    assert.deepEqual(await json(f, session, 'documents'), {
      documents: [],
      storageReady: true,
    });
    await expect(
      await f.request(
        'GET',
        f.path(`documents/${upload.documentId}/preview`),
        session,
      ),
      404,
    );
    assert.equal((await content(f, session, upload)).state, 'pending');
    assert.equal((await finalize(f, session, upload)).state, 'ready');
    const listed = await json(f, session, 'documents');
    assert.equal(listed.documents.length, 1);
    const record = listed.documents[0];
    assert.equal(record.id, upload.documentId);
    assert.equal(record.title, declaration.title);
    assert.equal(record.patientId, ids.patient);
    assert.equal(record.canExport, true);
    assert.deepEqual(Object.keys(record).sort(), [
      'bytes',
      'canEdit',
      'canExport',
      'canView',
      'categoryId',
      'categoryName',
      'createdAt',
      'id',
      'mimeType',
      'originalTitle',
      'patientId',
      'title',
    ]);
    const preview = await f.request(
      'GET',
      f.path(`documents/${upload.documentId}/preview`),
      session,
    );
    assert.equal(
      preview.headers.get('content-disposition'),
      'inline; filename="medical-document"',
    );
    await sameBytes(preview);
    const download = await f.request(
      'GET',
      f.path(`documents/${upload.documentId}/download`),
      session,
    );
    assert.equal(
      download.headers.get('content-disposition'),
      'attachment; filename="medical-document"',
    );
    await sameBytes(download);
    assert.deepEqual(
      f.metadata.events.map(({ kind }) => kind),
      ['document.uploaded', 'document.viewed', 'document.exported'],
    );
    assert.ok(
      f.metadata.events.every(({ accountId }) => accountId === ids.owner),
    );
    const objectKey = f.metadata.rows.get(upload.uploadId).objectKey;
    const exposed = JSON.stringify({ upload, listed, logs: f.logs });
    for (const value of [
      objectKey,
      declaration.sha256,
      declaration.idempotencyKey,
      session,
      'owner-subject',
    ])
      assert.ok(!exposed.includes(value));
    const logs = JSON.stringify(f.logs);
    for (const value of [
      declaration.title,
      ids.patient,
      upload.documentId,
      objectKey,
      'synthetic-documents@example.test',
    ])
      assert.ok(!logs.includes(value));
  }));

test('every document transport operation requires an authenticated account session', async () =>
  documentSetup(async (f) => {
    const session = await f.login();
    const upload = await ready(f, session);
    for (const [method, suffix, body] of [
      ['GET', 'documents'],
      ['GET', 'categories'],
      ['PATCH', `documents/${upload.documentId}/title`, { title: 'Changed' }],
      ['GET', `documents/${upload.documentId}/preview`],
      ['GET', `documents/${upload.documentId}/download`],
      ['POST', 'uploads', f.input()],
      ['PUT', `uploads/${upload.uploadId}/content`, pdf],
      ['POST', `uploads/${upload.uploadId}/finalize`, {}],
    ])
      await expect(
        await f.request(method, f.path(suffix), undefined, body),
        401,
      );
    await f.auth.logout(session);
    await expect(await f.request('GET', f.path('documents'), session), 401);
  }));

test('cross-patient selectors and foreign upload/document IDs deny without revealing existence or reading objects', async () =>
  documentSetup(async (f) => {
    const owner = await f.login();
    const upload = await ready(f, owner);
    const stranger = await f.login(principals.stranger.subject);
    const gets = f.objects.gets.length;
    const puts = f.objects.puts.length;
    const errors = [];
    for (const patientId of [ids.otherPatient, ids.unknownPatient]) {
      const response = await expect(
        await f.request('GET', f.path('documents', patientId), owner),
        404,
      );
      const body = await response.json();
      delete body.requestId;
      errors.push(body);
    }
    assert.deepEqual(errors[0], errors[1]);
    for (const [method, suffix, body] of [
      ['GET', `documents/${upload.documentId}/preview`],
      ['GET', `documents/${upload.documentId}/download`],
      ['PUT', `uploads/${upload.uploadId}/content`, pdf],
      ['POST', `uploads/${upload.uploadId}/finalize`, {}],
    ]) {
      await expect(
        await f.request(method, f.path(suffix), stranger, body),
        404,
      );
      await expect(
        await f.request(
          method,
          f.path(suffix, ids.otherPatient),
          stranger,
          body,
        ),
        404,
      );
    }
    assert.equal(f.objects.gets.length, gets);
    assert.equal(f.objects.puts.length, puts);
  }));

test('binary PUT enforces Origin, CSRF and octet-stream content type before any object write', async () =>
  documentSetup(async (f) => {
    const session = await f.login();
    const upload = await begin(f, session);
    for (const [headers, status] of [
      [{ 'X-CSRF-Token': undefined }, 403],
      [{ 'X-CSRF-Token': 'x'.repeat(43) }, 403],
      [{ Origin: undefined }, 403],
      [{ Origin: 'https://evil.example.test' }, 403],
      [{ 'Content-Type': 'application/json' }, 400],
      [{ 'Content-Type': 'text/plain' }, 400],
    ])
      await expect(
        await f.request(
          'PUT',
          f.path(`uploads/${upload.uploadId}/content`),
          session,
          pdf,
          headers,
        ),
        status,
      );
    assert.equal(f.objects.puts.length, 0);
    assert.equal(f.metadata.rows.get(upload.uploadId).state, 'pending');
    await content(f, session, upload);
    assert.equal(f.objects.puts.length, 1);
  }));

test('revocation invalidates reads, list and finalize with an unchanged authenticated session', async () =>
  documentSetup(async (f) => {
    const owner = await f.login();
    const original = await ready(f, owner);
    const pending = await begin(f, owner);
    await content(f, owner, pending);
    const grant = f.access.grant({ actions: ['view', 'export', 'upload'] });
    const session = await f.login(principals.caregiver.subject);
    await sameBytes(
      await f.request(
        'GET',
        f.path(`documents/${original.documentId}/preview`),
        session,
      ),
    );
    grant.revokedAt = new Date(f.access.now);
    for (const suffix of [
      'documents',
      `documents/${original.documentId}/preview`,
      `documents/${original.documentId}/download`,
    ])
      await expect(await f.request('GET', f.path(suffix), session), 404);
    await expect(
      await f.request(
        'POST',
        f.path(`uploads/${pending.uploadId}/finalize`),
        session,
        {},
      ),
      404,
    );
    assert.equal(f.metadata.rows.get(pending.uploadId).state, 'pending');
    grant.revokedAt = null;
    grant.expiresAt = new Date(f.access.now);
    await expect(
      await f.request(
        'GET',
        f.path(`documents/${original.documentId}/preview`),
        session,
      ),
      404,
    );
  }));

test('category-scoped upload-only caregiver receives no document metadata and uploads only to allowed categories', async () =>
  documentSetup(async (f) => {
    const owner = await f.login();
    const original = await ready(f, owner);
    f.access.grant({
      actions: ['upload'],
      scope: { kind: 'category', categoryId: ids.category },
    });
    const session = await f.login(principals.caregiver.subject);
    assert.deepEqual(await json(f, session, 'documents'), {
      documents: [],
      storageReady: true,
    });
    assert.deepEqual(await json(f, session, 'categories'), {
      categories: [{ id: ids.category, name: 'Unclassified' }],
    });
    await expect(
      await f.request(
        'POST',
        f.path('uploads'),
        session,
        f.input({ categoryId: ids.otherCategory }),
      ),
      404,
    );
    const upload = await begin(f, session);
    await content(f, session, upload);
    await finalize(f, session, upload);
    assert.deepEqual(await json(f, session, 'documents'), {
      documents: [],
      storageReady: true,
    });
    for (const suffix of ['preview', 'download'])
      await expect(
        await f.request(
          'GET',
          f.path(`documents/${original.documentId}/${suffix}`),
          session,
        ),
        404,
      );
  }));

test('document-scoped view permits only that preview and never download, upload or other document metadata', async () =>
  documentSetup(async (f) => {
    const owner = await f.login();
    const original = await ready(f, owner);
    const hidden = await ready(
      f,
      owner,
      f.input({
        categoryId: ids.otherCategory,
        title: 'Hidden synthetic document',
      }),
    );
    f.access.grant({
      actions: ['view'],
      scope: { kind: 'document', documentId: original.documentId },
    });
    const session = await f.login(principals.caregiver.subject);
    const listed = await json(f, session, 'documents');
    assert.equal(listed.documents.length, 1);
    assert.equal(listed.documents[0].id, original.documentId);
    assert.equal(listed.documents[0].canExport, false);
    assert.ok(!JSON.stringify(listed).includes('Hidden synthetic document'));
    await sameBytes(
      await f.request(
        'GET',
        f.path(`documents/${original.documentId}/preview`),
        session,
      ),
    );
    await expect(
      await f.request(
        'GET',
        f.path(`documents/${original.documentId}/download`),
        session,
      ),
      404,
    );
    await expect(
      await f.request(
        'GET',
        f.path(`documents/${hidden.documentId}/preview`),
        session,
      ),
      404,
    );
    await expect(await f.request('GET', f.path('categories'), session), 404);
    await expect(
      await f.request('POST', f.path('uploads'), session, f.input()),
      404,
    );
  }));

test('unconfigured object storage fails closed without creating a phantom upload or ready document', async () =>
  documentSetup(async (f) => {
    const session = await f.login();
    await expect(
      await f.request('POST', f.path('uploads'), session, f.input()),
      503,
    );
    assert.equal(f.metadata.rows.size, 0);
    assert.deepEqual(await json(f, session, 'documents'), {
      documents: [],
      storageReady: false,
    });
  }, new UnavailableObjectStore()));

test('storage failure after begin leaves pending/failed records unavailable and retry preserves upload identity', async () =>
  documentSetup(async (f) => {
    const session = await f.login();
    const declaration = f.input();
    const upload = await begin(f, session, declaration);
    f.objects.failPut = true;
    await expect(
      await f.request(
        'PUT',
        f.path(`uploads/${upload.uploadId}/content`),
        session,
        pdf,
      ),
      503,
    );
    assert.equal(f.metadata.rows.get(upload.uploadId).state, 'failed');
    assert.deepEqual(await json(f, session, 'documents'), {
      documents: [],
      storageReady: true,
    });
    await expect(
      await f.request(
        'GET',
        f.path(`documents/${upload.documentId}/preview`),
        session,
      ),
      404,
    );
    assert.equal(
      (await begin(f, session, declaration)).uploadId,
      upload.uploadId,
    );
    f.objects.failPut = false;
    await content(f, session, upload);
    await finalize(f, session, upload);
    assert.equal(f.metadata.rows.size, 1);
    await sameBytes(
      await f.request(
        'GET',
        f.path(`documents/${upload.documentId}/preview`),
        session,
      ),
    );
  }));

test('metadata and audit storage errors return sanitized failures and never release unaudited bytes', async () =>
  documentSetup(async (f) => {
    const session = await f.login();
    const upload = await ready(f, session);
    for (const [failure, suffix] of [
      ['list', 'documents'],
      ['audit', `documents/${upload.documentId}/preview`],
    ]) {
      f.metadata.fail = failure;
      const response = await expect(
        await f.request('GET', f.path(suffix), session),
        503,
      );
      const body = await response.text();
      for (const value of [
        'sensitive',
        'Private synthetic',
        f.metadata.rows.get(upload.uploadId).objectKey,
      ])
        assert.ok(!body.includes(value));
    }
    assert.equal(
      f.metadata.events.filter(({ kind }) => kind === 'document.viewed').length,
      0,
    );
  }));

test('revocation during object IO blocks HTTP preview and finalization before releasing bytes or READY', async () =>
  documentSetup(async (f) => {
    const owner = await f.login();
    const original = await ready(f, owner);
    const pending = await begin(f, owner);
    await content(f, owner, pending);
    const grant = f.access.grant({ actions: ['view', 'export', 'upload'] });
    const session = await f.login(principals.caregiver.subject);
    f.objects.onGet = async () => {
      grant.revokedAt = new Date(f.access.now);
    };
    await expect(
      await f.request(
        'GET',
        f.path(`documents/${original.documentId}/preview`),
        session,
      ),
      404,
    );
    grant.revokedAt = null;
    await expect(
      await f.request(
        'POST',
        f.path(`uploads/${pending.uploadId}/finalize`),
        session,
        {},
      ),
      404,
    );
    assert.equal(f.metadata.rows.get(pending.uploadId).state, 'pending');
    assert.equal(
      f.metadata.events.filter(({ kind }) => kind === 'document.viewed').length,
      0,
    );
  }));

const rename = (f, session, documentId, body, headers, patientId) =>
  f.request(
    'PATCH',
    f.path(`documents/${documentId}/title`, patientId),
    session,
    body,
    headers,
  );

test('owner display-title edit preserves original declaration, object and upload identity', async () =>
  documentSetup(async (f) => {
    const session = await f.login();
    const declaration = f.input();
    const upload = await ready(f, session, declaration);
    const original = globalThis.structuredClone(
      f.metadata.rows.get(upload.uploadId),
    );
    assert.deepEqual(
      await (
        await expect(
          await rename(f, session, upload.documentId, {
            title: '  Renamed synthetic report  ',
          }),
          200,
        )
      ).json(),
      { saved: true },
    );
    assert.deepEqual(f.metadata.rows.get(upload.uploadId), {
      ...original,
      displayTitle: 'Renamed synthetic report',
    });
    assert.equal(
      (await begin(f, session, declaration)).uploadId,
      upload.uploadId,
    );
    const [listed] = (await json(f, session, 'documents')).documents;
    assert.equal(listed.title, 'Renamed synthetic report');
    assert.equal(listed.originalTitle, declaration.title);
    assert.equal(listed.categoryName, 'Unclassified');
    assert.equal(listed.canEdit, true);
    await sameBytes(
      await f.request(
        'GET',
        f.path(`documents/${upload.documentId}/download`),
        session,
      ),
    );
    assert.deepEqual(
      f.metadata.events.filter(({ kind }) => kind === 'document.renamed'),
      [
        {
          patientId: ids.patient,
          documentId: upload.documentId,
          accountId: ids.owner,
          kind: 'document.renamed',
        },
      ],
    );
    const logs = JSON.stringify(f.logs);
    for (const value of [
      declaration.title,
      'Renamed synthetic report',
      original.objectKey,
      upload.documentId,
    ])
      assert.ok(!logs.includes(value));
  }));

test('independent edit permission never grants listing or original-byte access and is rechecked after revocation and expiry', async () =>
  documentSetup(async (f) => {
    const owner = await f.login();
    const upload = await ready(f, owner);
    const grant = f.access.grant({
      actions: ['edit'],
      scope: { kind: 'document', documentId: upload.documentId },
    });
    const session = await f.login(principals.caregiver.subject);
    assert.deepEqual((await json(f, session, 'documents')).documents, []);
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
      await rename(f, session, upload.documentId, { title: 'Edit permitted' }),
      200,
    );
    grant.revokedAt = new Date(f.access.now);
    await expect(
      await rename(f, session, upload.documentId, { title: 'Denied revoked' }),
      404,
    );
    grant.revokedAt = null;
    grant.expiresAt = new Date(f.access.now);
    await expect(
      await rename(f, session, upload.documentId, { title: 'Denied expired' }),
      404,
    );
    assert.equal(
      f.metadata.rows.get(upload.uploadId).displayTitle,
      'Edit permitted',
    );
    grant.expiresAt = null;
    grant.actions = ['view'];
    assert.equal(
      (await json(f, session, 'documents')).documents[0].canEdit,
      false,
    );
    await expect(
      await rename(f, session, upload.documentId, { title: 'Denied view' }),
      404,
    );
  }));

test('title edit rejects malformed bodies and unsafe titles while accepting trimmed JavaScript length boundaries', async () =>
  documentSetup(async (f) => {
    const session = await f.login();
    const upload = await ready(f, session);
    for (const body of [
      null,
      [],
      {},
      { title: 7 },
      { title: '' },
      { title: ' \t ' },
      { title: 'a'.repeat(201) },
      { title: 'a\u0000b' },
      { title: 'a\nb' },
      { title: 'a\u007fb' },
      { title: 'Valid', categoryId: ids.category },
      { title: 'Valid', patientId: ids.patient },
    ]) {
      await expect(await rename(f, session, upload.documentId, body), 400);
    }
    assert.equal(f.metadata.rows.get(upload.uploadId).displayTitle, undefined);
    await expect(
      await rename(f, session, upload.documentId, { title: '😀'.repeat(100) }),
      200,
    );
    await expect(
      await rename(f, session, upload.documentId, { title: '😀'.repeat(101) }),
      400,
    );
    await expect(
      await rename(f, session, upload.documentId, { title: ' x ' }),
      200,
    );
    assert.equal(f.metadata.rows.get(upload.uploadId).displayTitle, 'x');
  }));

test('title edit denies cross-patient, missing and non-ready documents without object IO', async () =>
  documentSetup(async (f) => {
    const session = await f.login();
    const original = await ready(f, session);
    const pending = await begin(f, session);
    const gets = f.objects.gets.length;
    const puts = f.objects.puts.length;
    for (const [documentId, patientId] of [
      [original.documentId, ids.otherPatient],
      [original.documentId, ids.unknownPatient],
      [ids.unknownDocument, ids.patient],
      [pending.documentId, ids.patient],
    ]) {
      await expect(
        await rename(
          f,
          session,
          documentId,
          { title: 'Denied' },
          {},
          patientId,
        ),
        404,
      );
    }
    assert.equal(f.objects.gets.length, gets);
    assert.equal(f.objects.puts.length, puts);
    assert.ok(
      [...f.metadata.rows.values()].every(
        (row) => row.displayTitle === undefined,
      ),
    );
  }));

test('title edit requires matching CSRF and trusted Origin', async () =>
  documentSetup(async (f) => {
    const session = await f.login();
    const upload = await ready(f, session);
    for (const headers of [
      { 'X-CSRF-Token': undefined },
      { 'X-CSRF-Token': 'x'.repeat(43) },
      { Origin: undefined },
      { Origin: 'https://evil.example.test' },
    ]) {
      await expect(
        await rename(
          f,
          session,
          upload.documentId,
          { title: 'Denied' },
          headers,
        ),
        403,
      );
    }
    assert.equal(f.metadata.rows.get(upload.uploadId).displayTitle, undefined);
  }));

test('rename and audit failures roll back title and audit together and permit retry', async () =>
  documentSetup(async (f) => {
    const session = await f.login();
    const upload = await ready(f, session);
    const original = globalThis.structuredClone(
      f.metadata.rows.get(upload.uploadId),
    );
    const events = globalThis.structuredClone(f.metadata.events);
    for (const failure of ['rename', 'audit']) {
      f.metadata.fail = failure;
      const response = await expect(
        await rename(f, session, upload.documentId, {
          title: 'Private changed title',
        }),
        503,
      );
      assert.ok(!(await response.text()).includes('sensitive'));
      assert.deepEqual(f.metadata.rows.get(upload.uploadId), original);
      assert.deepEqual(f.metadata.events, events);
    }
    f.metadata.fail = null;
    f.metadata.failCommit = true;
    await expect(
      await rename(f, session, upload.documentId, {
        title: 'Private changed title',
      }),
      503,
    );
    assert.deepEqual(f.metadata.rows.get(upload.uploadId), original);
    assert.deepEqual(f.metadata.events, events);
    await expect(
      await rename(f, session, upload.documentId, { title: 'Retry succeeded' }),
      200,
    );
    assert.equal(
      f.metadata.events.filter(({ kind }) => kind === 'document.renamed')
        .length,
      1,
    );
  }));

test('permission loss at either transactional rename authorization check rolls back metadata and audit', async () =>
  documentSetup(async (f) => {
    const owner = await f.login();
    const upload = await ready(f, owner);
    const grant = f.access.grant({ actions: ['edit'] });
    const session = await f.login(principals.caregiver.subject);
    const originalRename = f.metadata.rename.bind(f.metadata);
    for (const revokeAt of [1, 2]) {
      grant.revokedAt = null;
      let checks = 0;
      f.metadata.rename = (
        patientId,
        documentId,
        title,
        accountId,
        authorize,
      ) =>
        originalRename(patientId, documentId, title, accountId, async () => {
          if (++checks === revokeAt) grant.revokedAt = new Date(f.access.now);
          await authorize();
        });
      await expect(
        await rename(f, session, upload.documentId, {
          title: 'Denied during save',
        }),
        404,
      );
      assert.equal(checks, revokeAt);
      assert.equal(
        f.metadata.rows.get(upload.uploadId).displayTitle,
        undefined,
      );
      assert.equal(
        f.metadata.events.filter(({ kind }) => kind === 'document.renamed')
          .length,
        0,
      );
    }
  }));
