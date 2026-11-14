import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { extractLabFields } from '@fmv/contracts';
import { documentSetup, principals, pdf } from './support/document-fixture.mjs';
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
    canVerify: true,
  };
  const candidates = extractLabFields([
    {
      page: 1,
      text: 'Test: Synthetic analyte\nResult: 1.2\nUnit: synthetic/unit',
    },
  ]);
  f.metadata.readClinicalReview = async (p, d, auth) => {
    if (p !== record().patientId || d !== upload.documentId) return null;
    const actor = await auth(source());
    return {
      context: { ...context, canVerify: actor.canVerify },
      candidates,
      snapshot: null,
    };
  };
  f.metadata.saveClinicalReview = async (p, d, input, auth) => {
    await auth(source());
    return input.sourceRevision === 1
      ? { saved: true, revision: 1 }
      : 'conflict';
  };
  const path = f.path(`documents/${upload.documentId}/clinical-review`);
  const input = {
    requestId: randomUUID(),
    expectedRevision: 0,
    sourceRevision: 1,
    sourceSha256: context.sourceSha256,
    lifecycleVersion: 0,
    confirmed: true,
    selections: candidates.map((c) => ({
      candidateId: c.id,
      fields: Object.fromEntries(
        Object.entries(c.fields).map(([k, v]) => [k, v?.value ?? null]),
      ),
    })),
  };
  return { session, upload, path, input, context };
}

test('clinical HTTP requires session, CSRF and explicit owner confirmation without logging values', async () =>
  documentSetup(async (f) => {
    const x = await setup(f);
    assert.equal((await f.request('GET', x.path)).status, 401);
    const read = await f.request('GET', x.path, x.session);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.equal((await read.json()).context.canVerify, true);
    assert.equal(
      (
        await f.request('PUT', x.path, x.session, x.input, {
          'X-CSRF-Token': undefined,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request('PUT', x.path, x.session, {
          ...x.input,
          confirmed: false,
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.request('PUT', x.path, x.session, x.input)).status,
      200,
    );
    assert.ok(!JSON.stringify(f.logs).includes('Synthetic analyte'));
    assert.ok(!JSON.stringify(f.logs).includes(x.input.sourceSha256));
  }));
test('clinical HTTP delegates cannot verify even with all five grants; View read remains scoped and revocable', async () =>
  documentSetup(async (f) => {
    const x = await setup(f),
      reader = await f.login(principals.caregiver.subject);
    const grant = f.access.grant({
      actions: ['view', 'edit', 'manage', 'export', 'upload'],
      scope: { kind: 'document', documentId: x.upload.documentId },
    });
    const read = await f.request('GET', x.path, reader);
    assert.equal(read.status, 200);
    assert.equal((await read.json()).context.canVerify, false);
    assert.equal((await f.request('PUT', x.path, reader, x.input)).status, 404);
    assert.equal(
      (await f.request('PUT', x.path, reader, { ...x.input, confirmed: false }))
        .status,
      404,
    );
    grant.actions = ['edit'];
    assert.equal((await f.request('GET', x.path, reader)).status, 404);
    grant.actions = ['view'];
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
test('clinical HTTP rejects forged evidence, stale source, oversized and unsafe failures', async () =>
  documentSetup(async (f) => {
    const x = await setup(f);
    assert.equal(
      (
        await f.request('PUT', x.path, x.session, {
          ...x.input,
          canVerify: true,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request('PUT', x.path, x.session, {
          ...x.input,
          selections: [{ ...x.input.selections[0], source: { forged: true } }],
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
    f.metadata.readClinicalReview = async () => {
      throw Error('private synthetic diagnostic');
    };
    const error = await f.request('GET', x.path, x.session);
    assert.equal(error.status, 503);
    assert.ok(!(await error.text()).includes('private synthetic'));
  }));
