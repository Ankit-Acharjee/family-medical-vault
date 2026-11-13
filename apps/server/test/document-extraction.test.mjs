import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  documentSetup,
  ids,
  principals,
  pdf,
} from './support/document-fixture.mjs';
const copy = (value) => globalThis.structuredClone(value);
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && !Array.isArray(v) && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
// Synthetic adapter tests HTTP/policy contracts only. Native PostgreSQL tests
// independently exercise actual locks, constraints, privileges and rollback.
function install(f) {
  const snapshots = new Map(),
    life = new Map();
  const record = (p, d) =>
    [...f.metadata.rows.values()].find(
      (r) =>
        r.patientId === p &&
        r.documentId === d &&
        r.state === 'ready' &&
        !r.deletedAt,
    );
  const source = (r) => ({
    ...r,
    deletedAt: r.deletedAt ?? null,
    lifecycleVersion: life.get(r.documentId) ?? 0,
  });
  f.metadata.readExtraction = (p, d, authorize, include = true) =>
    f.metadata.asActor('').withLock(`extraction:${d}`, async () => {
      f.metadata.check('extraction');
      const r = record(p, d);
      if (!r) return null;
      const actor = await authorize(source(r));
      const row = snapshots.get(d);
      if (include && row)
        await f.metadata.audit(p, d, actor.accountId, 'document.viewed');
      const current = await authorize(source(r));
      return {
        context: {
          sourceSha256: r.sha256,
          lifecycleVersion: life.get(d) ?? 0,
          revision: row?.snapshot.revision ?? 0,
          canSave: current.canSave,
        },
        snapshot: include && row ? copy(row.snapshot) : null,
      };
    });
  f.metadata.saveExtraction = async (p, d, input, authorize) => {
    const prior = snapshots.get(d);
    try {
      return await f.metadata
        .asActor('')
        .withLock(`extraction:${d}`, async () => {
          const r = record(p, d);
          if (!r) return 'missing';
          const actor = await authorize(source(r));
          const old = snapshots.get(d);
          if (
            input.sourceSha256 !== r.sha256 ||
            input.lifecycleVersion !== (life.get(d) ?? 0)
          )
            return 'conflict';
          if (old?.requestId === input.requestId) {
            if (
              old.actor !== actor.accountId ||
              old.payload !== canonical(input)
            )
              return 'conflict';
            await authorize(source(r));
            return { saved: true, revision: old.snapshot.revision };
          }
          if (input.expectedRevision !== (old?.snapshot.revision ?? 0))
            return 'conflict';
          f.metadata.check('saveExtraction');
          const revision = input.expectedRevision + 1;
          snapshots.set(d, {
            requestId: input.requestId,
            actor: actor.accountId,
            payload: canonical(input),
            snapshot: {
              ...copy(input.result),
              revision,
              sourceSha256: r.sha256,
              savedAt: f.access.now.toISOString(),
              unverified: true,
            },
          });
          await f.metadata.audit(
            p,
            d,
            actor.accountId,
            'document.extraction_saved',
          );
          await authorize(source(r));
          return { saved: true, revision };
        });
    } catch (e) {
      if (prior) snapshots.set(d, prior);
      else snapshots.delete(d);
      throw e;
    }
  };
  const trash = f.metadata.changeTrash.bind(f.metadata);
  f.metadata.changeTrash = (...args) =>
    f.metadata.asActor('').withLock(`extraction:${args[1]}`, async () => {
      const result = await trash(...args);
      if (result === 'changed') life.set(args[1], (life.get(args[1]) ?? 0) + 1);
      return result;
    });
  return { snapshots, life };
}
async function expect(response, status) {
  assert.equal(response.status, status);
  return response;
}
async function setup(f) {
  install(f);
  const session = await f.login();
  const input = f.input();
  const upload = await (
    await expect(
      await f.request('POST', f.path('uploads'), session, input),
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
  const path = f.path(`documents/${upload.documentId}/extraction`);
  const context = async (s = session) =>
    (
      await (
        await expect(await f.request('GET', path + '/context', s), 200)
      ).json()
    ).context;
  const make = (ctx, text = 'Unverified synthetic text') => ({
    requestId: randomUUID(),
    expectedRevision: ctx.revision,
    lifecycleVersion: ctx.lifecycleVersion,
    sourceSha256: ctx.sourceSha256,
    result: {
      method: 'pdf-text',
      engineVersion: 'pdfjs-6.5.438',
      pages: [{ page: 1, text }],
      partial: false,
      partialReason: null,
      downsized: false,
    },
  });
  return { session, upload, path, context, make };
}
test('owner explicitly saves/reopens unverified source-bound text; retry is idempotent and audited without content', async () =>
  documentSetup(async (f) => {
    const x = await setup(f),
      ctx = await x.context(),
      body = x.make(ctx);
    const original = copy(f.metadata.rows.get(x.upload.uploadId));
    for (let i = 0; i < 2; i++)
      assert.deepEqual(
        await (
          await expect(await f.request('PUT', x.path, x.session, body), 200)
        ).json(),
        { saved: true, revision: 1 },
      );
    const response = await expect(
      await f.request('GET', x.path, x.session),
      200,
    );
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const saved = await response.json();
    assert.equal(saved.snapshot.unverified, true);
    assert.equal(saved.snapshot.pages[0].text, body.result.pages[0].text);
    assert.equal(saved.context.sourceSha256, ctx.sourceSha256);
    assert.equal(
      f.metadata.events.filter((e) => e.kind === 'document.extraction_saved')
        .length,
      1,
    );
    assert.deepEqual(f.metadata.rows.get(x.upload.uploadId), original);
    assert.ok(!JSON.stringify(f.logs).includes(body.result.pages[0].text));
    assert.ok(!JSON.stringify(f.logs).includes(ctx.sourceSha256));
  }));
test('view is independent from edit, export, upload, manage, scope and current revocation', async () =>
  documentSetup(async (f) => {
    const x = await setup(f);
    await expect(
      await f.request('PUT', x.path, x.session, x.make(await x.context())),
      200,
    );
    const session = await f.login(principals.caregiver.subject);
    const grant = f.access.grant({
      actions: ['view'],
      scope: { kind: 'document', documentId: x.upload.documentId },
    });
    assert.equal((await x.context(session)).canSave, false);
    await expect(await f.request('GET', x.path, session), 200);
    for (const actions of [
      ['view'],
      ['edit'],
      ['export'],
      ['upload'],
      ['manage'],
    ]) {
      grant.actions = actions;
      await expect(
        await f.request('PUT', x.path, session, x.make(await x.context())),
        404,
      );
      if (!actions.includes('view'))
        await expect(await f.request('GET', x.path, session), 404);
    }
    const independentView = f.access.grant({
      actions: ['view'],
      scope: { kind: 'document', documentId: x.upload.documentId },
    });
    grant.actions = ['edit'];
    grant.scope = { kind: 'category', categoryId: ids.otherCategory };
    assert.equal((await x.context(session)).canSave, false);
    await expect(
      await f.request('PUT', x.path, session, x.make(await x.context())),
      404,
    );
    independentView.revokedAt = new Date(f.access.now);
    grant.scope = { kind: 'document', documentId: x.upload.documentId };
    grant.actions = ['view', 'edit'];
    assert.equal((await x.context(session)).canSave, true);
    const ctx = await x.context(session);
    await expect(await f.request('PUT', x.path, session, x.make(ctx)), 200);
    grant.scope = { kind: 'category', categoryId: ids.otherCategory };
    await expect(await f.request('GET', x.path, session), 404);
    grant.scope = { kind: 'document', documentId: x.upload.documentId };
    grant.revokedAt = new Date(f.access.now);
    await expect(await f.request('GET', x.path, session), 404);
    grant.revokedAt = null;
    grant.expiresAt = new Date(f.access.now);
    await expect(await f.request('PUT', x.path, session, x.make(ctx)), 404);
  }));
test('authentication, cross-patient identity and CSRF deny before text validation', async () =>
  documentSetup(async (f) => {
    const x = await setup(f),
      body = x.make(await x.context());
    for (const path of [x.path, x.path + '/context']) {
      const response = await expect(await f.request('GET', path), 401);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.ok(!(await response.text()).includes(body.sourceSha256));
    }
    await expect(
      await f.request('PUT', x.path, x.session, body, {
        'X-CSRF-Token': undefined,
      }),
      403,
    );
    await expect(
      await f.request(
        'PUT',
        x.path.replace(ids.patient, ids.otherPatient),
        x.session,
        body,
      ),
      404,
    );
    await expect(
      await f.request(
        'PUT',
        x.path.replace(x.upload.documentId, randomUUID()),
        x.session,
        { bad: true },
      ),
      404,
    );
    await expect(
      await f.request('PUT', x.path, x.session, body, {
        'Content-Type': 'text/plain',
      }),
      400,
    );
  }));
test('strict input validation rejects malformed, unbounded or incompatible results without replacing prior success', async () =>
  documentSetup(async (f) => {
    const x = await setup(f),
      body = x.make(await x.context());
    await expect(await f.request('PUT', x.path, x.session, body), 200);
    const invalid = [
      null,
      [],
      { ...body, unknown: true },
      { ...body, requestId: 'bad' },
      { ...body, sourceSha256: 'x' },
      { ...body, expectedRevision: -1 },
      { ...body, result: { ...body.result, verified: true } },
      {
        ...body,
        result: { ...body.result, pages: [{ page: 1, text: '\u0000' }] },
      },
      {
        ...body,
        result: { ...body.result, pages: [{ page: 1, text: '\ud800' }] },
      },
      { ...body, result: { ...body.result, pages: [{ page: 1, text: '  ' }] } },
      {
        ...body,
        result: { ...body.result, pages: [{ page: 2, text: 'gap' }] },
      },
      {
        ...body,
        result: {
          ...body.result,
          pages: [
            { page: 1, text: 'a' },
            { page: 1, text: 'b' },
          ],
        },
      },
      {
        ...body,
        result: {
          ...body.result,
          pages: [{ page: 1, text: 'x'.repeat(500001) }],
        },
      },
      { ...body, result: { ...body.result, engineVersion: 'unknown' } },
      {
        ...body,
        result: {
          ...body.result,
          method: 'image-ocr',
          engineVersion: 'tesseract-7.0.0+eng-1.0.0',
        },
      },
    ];
    for (const value of invalid)
      await expect(await f.request('PUT', x.path, x.session, value), 400);
    assert.equal(
      (await (await f.request('GET', x.path, x.session)).json()).snapshot
        .revision,
      1,
    );
  }));
test('narrow raw JSON route accepts large escaped text but preserves the ordinary API body cap', async () =>
  documentSetup(async (f) => {
    const x = await setup(f),
      ctx = await x.context();
    const text = '漢😀\n'.repeat(100000); // 400k UTF16 units, well above 100KiB on wire.
    const body = x.make(ctx, text);
    await expect(await f.request('PUT', x.path, x.session, body), 200);
    assert.equal(
      (await (await f.request('GET', x.path, x.session)).json()).snapshot
        .pages[0].text,
      text,
    );
    await expect(
      await f.request('POST', f.path('uploads'), x.session, {
        padding: 'x'.repeat(110000),
      }),
      413,
    );
    await expect(
      await f.request('PUT', x.path, x.session, {
        ...body,
        padding: 'x'.repeat(4 * 1024 * 1024),
      }),
      413,
    );
  }));
test('stale bases, payload-changing replay and Trash/restore cannot overwrite saved text', async () =>
  documentSetup(async (f) => {
    const x = await setup(f),
      before = await x.context(),
      body = x.make(before);
    await expect(await f.request('PUT', x.path, x.session, body), 200);
    await expect(
      await f.request('PUT', x.path, x.session, x.make(before, 'stale')),
      409,
    );
    await expect(
      await f.request('PUT', x.path, x.session, {
        ...body,
        result: {
          ...body.result,
          pages: [{ page: 1, text: 'changed replay' }],
        },
      }),
      409,
    );
    await expect(
      await f.request('PUT', x.path, x.session, {
        ...x.make(await x.context()),
        sourceSha256: 'b'.repeat(64),
      }),
      409,
    );
    await expect(
      await f.request('PUT', x.path, x.session, {
        ...x.make(await x.context()),
        lifecycleVersion: 9,
      }),
      409,
    );
    const base = x.path.replace('/extraction', '');
    await expect(await f.request('POST', base + '/trash', x.session, {}), 200);
    await expect(await f.request('GET', x.path, x.session), 404);
    await expect(
      await f.request('POST', base + '/restore', x.session, {}),
      200,
    );
    assert.equal(
      (await (await f.request('GET', x.path, x.session)).json()).snapshot
        .pages[0].text,
      body.result.pages[0].text,
    );
    await expect(await f.request('PUT', x.path, x.session, body), 409);
    const next = await x.context();
    assert.equal(next.lifecycleVersion, 2);
    await expect(
      await f.request('PUT', x.path, x.session, x.make(next, 'fresh')),
      200,
    );
  }));
test('failed storage or audit leaves the original and previous successful saved result available', async () =>
  documentSetup(async (f) => {
    const x = await setup(f),
      body = x.make(await x.context());
    await expect(await f.request('PUT', x.path, x.session, body), 200);
    const current = await x.context();
    for (const failure of ['saveExtraction', 'audit']) {
      f.metadata.fail = failure;
      await expect(
        await f.request(
          'PUT',
          x.path,
          x.session,
          x.make(current, 'must not replace'),
        ),
        503,
      );
      f.metadata.fail = null;
      assert.equal(
        (await (await f.request('GET', x.path, x.session)).json()).snapshot
          .pages[0].text,
        body.result.pages[0].text,
      );
    }
    await expect(
      await f.request(
        'GET',
        x.path.replace('/extraction', '/preview'),
        x.session,
      ),
      200,
    );
  }));
