import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
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
  let unavailable = false;
  f.metadata.readProcessingConsent = async (p, d, auth, before) => {
    if (p !== record().patientId || d !== upload.documentId) return null;
    await auth(source());
    const context = {
      sourceRevision: 1,
      sourceSha256: record().sha256,
      lifecycleVersion: 0,
      revision: 0,
    };
    return before === undefined
      ? {
          context,
          snapshot: null,
          policies: [],
          effective: false,
          externalProcessingEnabled: false,
        }
      : {
          context,
          snapshot: null,
          nextBefore: null,
          externalProcessingEnabled: false,
        };
  };
  f.metadata.writeProcessingConsent = async (p, d, input, action, auth) => {
    await auth(source());
    if (unavailable) return 'unavailable';
    if (action === 'grant' && input.sourceSha256 !== record().sha256)
      return 'conflict';
    return { saved: true, revision: action === 'grant' ? 1 : 2 };
  };
  return {
    session,
    upload,
    input: {
      requestId: randomUUID(),
      expectedRevision: 0,
      sourceRevision: 1,
      sourceSha256: record().sha256,
      lifecycleVersion: 0,
      providerId: 'synthetic-provider',
      policyVersion: 'synthetic-v1',
      purpose: 'document-extraction',
      dataCategories: ['saved-text'],
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      confirmed: true,
    },
    unavailable: () => {
      unavailable = true;
    },
    path: f.path(`documents/${upload.documentId}/processing-consent`),
  };
}

test('processing consent HTTP requires owner/current View, explicit source references and CSRF', async () =>
  documentSetup(async (f) => {
    const x = await setup(f);
    assert.equal((await f.request('GET', x.path)).status, 401);
    const r = await f.request('GET', x.path, x.session);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal((await r.json()).externalProcessingEnabled, false);
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
    for (const change of [
      { actorAccountId: randomUUID() },
      { approvedProvider: true },
      { consent: true },
      { confirmed: false },
      { purpose: 'prescribing' },
      { dataCategories: [] },
      { dataCategories: ['saved-text', 'saved-text'] },
      { dataCategories: ['all-records'] },
      { expiresAt: 'not-a-date' },
      { scope: 'all-patients' },
      { sourceRevision: -1 },
      { expectedRevision: 2147483648 },
    ])
      assert.equal(
        (await f.request('PUT', x.path, x.session, { ...x.input, ...change }))
          .status,
        400,
      );
    assert.equal(
      (
        await f.request('PUT', x.path, x.session, {
          ...x.input,
          sourceSha256: 'b'.repeat(64),
        })
      ).status,
      409,
    );
    const ownList = await f.request('GET', f.path('documents'), x.session);
    assert.equal(ownList.status, 200);
    assert.equal(
      (await ownList.json()).documents.find((d) => d.id === x.upload.documentId)
        .canManageConsent,
      true,
    );
    const reader = await f.login(principals.caregiver.subject);
    f.access.grant({
      actions: ['view', 'edit', 'manage', 'upload', 'export'],
      scope: { kind: 'document', documentId: x.upload.documentId },
    });
    const delegatedList = await f.request('GET', f.path('documents'), reader);
    assert.equal(delegatedList.status, 200);
    assert.equal(
      (await delegatedList.json()).documents.find(
        (d) => d.id === x.upload.documentId,
      ).canManageConsent,
      false,
    );
    for (const [method, path, body] of [
      ['GET', x.path],
      ['GET', `${x.path}/history?beforeRevision=2`],
      ['PUT', x.path, x.input],
      ['PUT', x.path, { approvedProvider: true }],
      [
        'POST',
        `${x.path}/withdraw`,
        { requestId: randomUUID(), expectedRevision: 1 },
      ],
    ])
      assert.equal((await f.request(method, path, reader, body)).status, 404);
    const withdraw = { requestId: randomUUID(), expectedRevision: 1 };
    assert.equal(
      (
        await f.request('POST', `${x.path}/withdraw`, x.session, withdraw, {
          'X-CSRF-Token': undefined,
        })
      ).status,
      403,
    );
    assert.equal(
      (await f.request('POST', `${x.path}/withdraw`, x.session, withdraw))
        .status,
      200,
    );
    assert.equal(
      (
        await f.request('POST', `${x.path}/withdraw`, x.session, {
          ...withdraw,
          providerId: 'forged',
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.request('GET', `${x.path}/history?beforeRevision=2`, x.session))
        .status,
      200,
    );
    for (const cursor of ['0', '01', '-1', '1.0', '2147483648', 'abc'])
      assert.equal(
        (
          await f.request(
            'GET',
            `${x.path}/history?beforeRevision=${cursor}`,
            x.session,
          )
        ).status,
        400,
      );
    x.unavailable();
    assert.equal(
      (await f.request('PUT', x.path, x.session, x.input)).status,
      503,
    );
    f.metadata.readProcessingConsent = async () => {
      throw Error('private synthetic policy failure');
    };
    const failed = await f.request('GET', x.path, x.session);
    assert.equal(failed.status, 503);
    assert.ok(!(await failed.text()).includes('private synthetic'));
    assert.ok(!JSON.stringify(f.logs).includes('synthetic-provider'));
  }));
