import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { extractDiagnosisFields } from '@fmv/contracts';
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
  const candidates = extractDiagnosisFields([
    { page: 1, text: 'Diagnosis: No SYNTHETIC current condition' },
  ]);
  f.metadata.readDiagnosisReview = async (p, d, auth, before) => {
    if (p !== record().patientId || d !== upload.documentId) return null;
    const actor = await auth(source());
    const context = {
      sourceRevision: 1,
      sourceSha256: record().sha256,
      lifecycleVersion: 0,
      revision: 0,
      canVerify: actor.canVerify,
    };
    return before === undefined
      ? { context, candidates, snapshot: null }
      : { context, snapshot: null, nextBefore: null };
  };
  f.metadata.writeDiagnosisReview = async (p, d, input, action, auth) => {
    await auth(source());
    return input.sourceSha256 === record().sha256
      ? { saved: true, revision: 1 }
      : 'conflict';
  };
  const input = {
    requestId: randomUUID(),
    expectedRevision: 0,
    sourceRevision: 1,
    sourceSha256: record().sha256,
    lifecycleVersion: 0,
    confirmed: true,
    meaning: 'source-statement-only',
    candidateIds: [candidates[0].id],
  };
  return {
    session,
    upload,
    input,
    path: f.path(`documents/${upload.documentId}/diagnosis-review`),
  };
}
test('diagnosis HTTP enforces owner-only source attestation, scoped reads and sanitizes failures', async () =>
  documentSetup(async (f) => {
    const x = await setup(f);
    assert.equal((await f.request('GET', x.path)).status, 401);
    const result = await f.request('GET', x.path, x.session);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal((await result.json()).candidates[0].unverified, true);
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
      { meaning: 'current-diagnosis' },
      { statement: 'SYNTHETIC forged' },
      { canVerify: true },
      { confirmed: false },
      { candidateIds: [] },
      { candidateIds: [x.input.candidateIds[0], x.input.candidateIds[0]] },
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
    const reader = await f.login(principals.caregiver.subject);
    const grant = f.access.grant({
      actions: ['view', 'edit', 'manage', 'upload', 'export'],
      scope: { kind: 'document', documentId: x.upload.documentId },
    });
    assert.equal((await f.request('GET', x.path, reader)).status, 200);
    assert.equal((await f.request('PUT', x.path, reader, x.input)).status, 404);
    assert.equal(
      (await f.request('PUT', x.path, reader, { meaning: 'current-diagnosis' }))
        .status,
      404,
    );
    const { sourceRevision, ...withdraw } = x.input;
    void sourceRevision;
    withdraw.expectedRevision = 1;
    assert.equal(
      (await f.request('POST', `${x.path}/withdraw`, reader, withdraw)).status,
      404,
    );
    assert.equal(
      (await f.request('POST', `${x.path}/withdraw`, x.session, withdraw))
        .status,
      200,
    );
    grant.actions = ['export'];
    assert.equal((await f.request('GET', x.path, reader)).status, 404);
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
    f.metadata.readDiagnosisReview = async () => {
      throw Error('private synthetic statement');
    };
    const failed = await f.request('GET', x.path, x.session);
    assert.equal(failed.status, 503);
    assert.ok(!(await failed.text()).includes('private synthetic'));
    assert.ok(
      !JSON.stringify(f.logs).includes('No SYNTHETIC current condition'),
    );
  }));
