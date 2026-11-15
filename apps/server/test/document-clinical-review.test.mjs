import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { extractLabFields } from '@fmv/contracts';
import { documentSetup, principals, pdf } from './support/document-fixture.mjs';
async function setup(f, confirmed = false) {
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
  f.metadata.readClinicalHistory = async (p, d, before, auth) => {
    if (p !== record().patientId || d !== upload.documentId) return null;
    const actor = await auth(source());
    return {
      context: { ...context, canVerify: actor.canVerify },
      snapshot: null,
      nextBefore: null,
    };
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
  if (confirmed) {
    context.revision = 1;
    const snapshot = {
      action: 'confirmation',
      withdrawnItems: [],
      revision: 1,
      sourceRevision: 1,
      sourceSha256: context.sourceSha256,
      verifiedAt: '2026-11-15T00:00:00.000Z',
      ruleVersion: 'labeled-lab-blocks-v1',
      verified: true,
      extraction: {
        method: 'pdf-text',
        engineVersion: 'pdfjs-6.5.438',
        partial: false,
        partialReason: null,
        downsized: false,
      },
      items: candidates.map((source, i) => ({
        source,
        fields: input.selections[i].fields,
      })),
    };
    f.metadata.readClinicalReview = async (p, d, auth) => {
      if (p !== record().patientId || d !== upload.documentId) return null;
      const actor = await auth(source());
      return {
        context: { ...context, canVerify: actor.canVerify },
        candidates,
        snapshot,
      };
    };
    f.metadata.withdrawClinicalReview = async (p, d, value, auth) => {
      if (p !== record().patientId || d !== upload.documentId) return 'missing';
      await auth(source());
      return value.expectedRevision === 1 &&
        value.lifecycleVersion === 0 &&
        value.sourceSha256 === context.sourceSha256 &&
        value.candidateIds.every((id) => candidates.some((c) => c.id === id))
        ? { saved: true, revision: 2 }
        : 'conflict';
    };
  }
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

test('clinical history HTTP is scoped, no-store and strictly bounded without writes or sensitive errors', async () =>
  documentSetup(async (f) => {
    const x = await setup(f),
      path = `${x.path}/history?beforeRevision=1`;
    assert.equal((await f.request('GET', path)).status, 401);
    const response = await f.request('GET', path, x.session);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).snapshot, null);
    const reader = await f.login(principals.caregiver.subject);
    assert.equal((await f.request('GET', path, reader)).status, 404);
    const grant = f.access.grant({
      actions: ['view'],
      scope: { kind: 'document', documentId: x.upload.documentId },
    });
    assert.equal((await f.request('GET', path, reader)).status, 200);
    grant.revokedAt = f.access.now;
    assert.equal((await f.request('GET', path, reader)).status, 404);
    for (const cursor of ['', '0', '01', '-1', '1.5', '2147483648', '2%0A'])
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
    f.metadata.readClinicalHistory = async () => {
      throw Error('Synthetic private failure');
    };
    const failure = await f.request('GET', path, x.session);
    assert.equal(failure.status, 503);
    assert.ok(!(await failure.text()).includes('Synthetic private failure'));
    assert.ok(!JSON.stringify(f.logs).includes(x.input.sourceSha256));
  }));

test('withdrawal HTTP requires owner, CSRF and exact intent with sanitized failure and scoped denial', async () =>
  documentSetup(async (f) => {
    const x = await setup(f, true),
      path = `${x.path}/withdraw`,
      body = {
        requestId: randomUUID(),
        expectedRevision: 1,
        sourceSha256: x.context.sourceSha256,
        lifecycleVersion: 0,
        confirmed: true,
        candidateIds: x.input.selections.map((s) => s.candidateId),
      };
    assert.equal((await f.request('POST', path, undefined, body)).status, 401);
    assert.equal(
      (
        await f.request('POST', path, x.session, body, {
          'X-CSRF-Token': undefined,
        })
      ).status,
      403,
    );
    for (const patch of [
      { confirmed: false },
      { actorAccountId: randomUUID() },
      { fields: { result: 'forged' } },
      { candidateIds: [] },
      { candidateIds: [body.candidateIds[0], body.candidateIds[0]] },
    ])
      assert.equal(
        (await f.request('POST', path, x.session, { ...body, ...patch }))
          .status,
        400,
      );
    assert.equal(
      (
        await f.request('POST', path, x.session, {
          ...body,
          expectedRevision: 2,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.request('POST', path, x.session, {
          ...body,
          lifecycleVersion: 1,
        })
      ).status,
      409,
    );
    const ok = await f.request('POST', path, x.session, body);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await ok.json(), { saved: true, revision: 2 });
    const delegate = await f.login(principals.caregiver.subject);
    f.access.grant({
      actions: ['view', 'edit', 'manage', 'export', 'upload'],
      scope: { kind: 'document', documentId: x.upload.documentId },
    });
    assert.equal((await f.request('POST', path, delegate, body)).status, 404);
    assert.equal(
      (await f.request('POST', path, delegate, { confirmed: false })).status,
      404,
    );
    f.metadata.withdrawClinicalReview = async () => {
      throw Error('Synthetic private withdrawal source');
    };
    const failed = await f.request('POST', path, x.session, body);
    assert.equal(failed.status, 503);
    assert.ok(
      !(await failed.text()).includes('Synthetic private withdrawal source'),
    );
    assert.ok(!JSON.stringify(f.logs).includes('Synthetic analyte'));
    assert.ok(!JSON.stringify(f.logs).includes(body.sourceSha256));
  }));
