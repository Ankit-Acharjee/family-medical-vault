import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { documentSetup, principals, pdf } from './support/document-fixture.mjs';
// HTTP/permission adapter tests; native suite separately verifies SQL/locks.
async function setup(f) {
  const session = await f.login();
  const reserved = await f.request(
    'POST',
    f.path('uploads'),
    session,
    f.input(),
  );
  assert.equal(reserved.status, 201);
  const upload = await reserved.json();
  assert.equal(
    (
      await f.request(
        'PUT',
        f.path(`uploads/${upload.uploadId}/content`),
        session,
        pdf,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await f.request(
        'POST',
        f.path(`uploads/${upload.uploadId}/finalize`),
        session,
        {},
      )
    ).status,
    201,
  );
  const record = () =>
    [...f.metadata.rows.values()].find(
      (r) => r.documentId === upload.documentId,
    );
  const source = () => ({
    ...record(),
    deletedAt: record().deletedAt ?? null,
    lifecycleVersion: 0,
  });
  const context = {
    sourceRevision: 1,
    sourceSha256: record().sha256,
    lifecycleVersion: 0,
    revision: 0,
    canSave: true,
  };
  f.metadata.readExtraction = async (p, d, auth) => {
    if (p !== record().patientId || d !== upload.documentId) return null;
    const actor = await auth(source());
    return {
      context: {
        sourceSha256: context.sourceSha256,
        lifecycleVersion: 0,
        revision: 1,
        canSave: actor.canSave,
      },
      snapshot: null,
    };
  };
  f.metadata.readMetadata = async (p, d, auth) => {
    if (p !== record().patientId || d !== upload.documentId) return null;
    const actor = await auth(source());
    return { context: { ...context, canSave: actor.canSave }, snapshot: null };
  };
  f.metadata.saveMetadata = async (p, d, input, auth) => {
    await auth(source());
    if (input.sourceRevision !== 1) return 'conflict';
    return { saved: true, revision: 1 };
  };
  const path = f.path(`documents/${upload.documentId}/metadata-suggestions`);
  const input = {
    requestId: randomUUID(),
    expectedRevision: 0,
    sourceRevision: 1,
    sourceSha256: context.sourceSha256,
    lifecycleVersion: 0,
    ruleVersion: 'explicit-lines-v1',
  };
  return { session, upload, path, input, context };
}
test('metadata GET/PUT routes require session/CSRF and avoid caching or content logs', async () =>
  documentSetup(async (f) => {
    const x = await setup(f);
    assert.equal((await f.request('GET', x.path)).status, 401);
    const read = await f.request('GET', x.path, x.session);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await read.json(), { context: x.context, snapshot: null });
    assert.equal(
      (
        await f.request('PUT', x.path, x.session, x.input, {
          'X-CSRF-Token': undefined,
        })
      ).status,
      403,
    );
    assert.equal(
      (await f.request('PUT', x.path, x.session, x.input)).status,
      200,
    );
    assert.ok(!JSON.stringify(f.logs).includes(x.input.sourceSha256));
  }));
test('metadata policy checks current View and Edit together, wrong patient and revocation', async () =>
  documentSetup(async (f) => {
    const x = await setup(f),
      reader = await f.login(principals.caregiver.subject);
    const grant = f.access.grant({
      actions: ['view'],
      scope: { kind: 'document', documentId: x.upload.documentId },
    });
    const view = await f.request('GET', x.path, reader);
    assert.equal(view.status, 200);
    assert.equal((await view.json()).context.canSave, false);
    assert.equal((await f.request('PUT', x.path, reader, x.input)).status, 404);
    grant.actions = ['edit'];
    assert.equal((await f.request('GET', x.path, reader)).status, 404);
    grant.actions = ['export'];
    assert.equal((await f.request('GET', x.path, reader)).status, 404);
    grant.actions = ['edit', 'view'];
    assert.equal((await f.request('PUT', x.path, reader, x.input)).status, 200);
    grant.revokedAt = f.access.now;
    assert.equal((await f.request('GET', x.path, reader)).status, 404);
    assert.equal(
      (
        await f.request(
          'GET',
          x.path.replace(x.upload.documentId, randomUUID()),
          x.session,
        )
      ).status,
      404,
    );
  }));
test('metadata strict payload rejects client candidates and source conflicts safely', async () =>
  documentSetup(async (f) => {
    const x = await setup(f);
    assert.equal(
      (
        await f.request('PUT', x.path, x.session, {
          ...x.input,
          suggestions: [{ value: 'invented' }],
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request('PUT', x.path, x.session, {
          ...x.input,
          ruleVersion: 'unapproved',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request('PUT', x.path, x.session, {
          ...x.input,
          sourceRevision: 2,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.request('PUT', x.path, x.session, {
          ...x.input,
          extra: 'x'.repeat(110000),
        })
      ).status,
      413,
    );
    f.metadata.readMetadata = async () => {
      throw Error('sensitive synthetic diagnostic');
    };
    const unavailable = await f.request('GET', x.path, x.session);
    assert.equal(unavailable.status, 503);
    assert.ok(!(await unavailable.text()).includes('sensitive synthetic'));
  }));
