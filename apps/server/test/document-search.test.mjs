import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { documentSetup, ids, principals } from './support/document-fixture.mjs';

const query = 'private-synthetic-search-token';
const empty = { documentIds: [], truncated: false };
const source = (row) => ({
  documentId: row.documentId,
  patientId: row.patientId,
  categoryId: row.categoryId,
  state: row.state,
  deletedAt: row.deletedAt ?? null,
});

// This adapter only exercises HTTP/policy wiring. Real PostgreSQL matching,
// sentinel selection, document locks, source integrity and audit rollback have
// independent native database coverage; this is not proof of those properties.
function install(f) {
  const state = {
    snapshots: new Map(),
    calls: [],
    onRead: null,
    onAudit: null,
  };
  f.metadata.searchExtractions = async (
    patientId,
    input,
    eligibleIds,
    authorize,
  ) =>
    f.metadata.asActor('').withLock('synthetic-search', async () => {
      state.calls.push({
        patientId,
        input: globalThis.structuredClone(input),
        eligibleIds,
      });
      f.metadata.check('search');
      const eligible = new Set(eligibleIds);
      const matches = [...f.metadata.rows.values()]
        .filter((row) => {
          const saved = state.snapshots.get(row.documentId);
          return (
            row.patientId === patientId &&
            row.state === 'ready' &&
            !row.deletedAt &&
            eligible.has(row.documentId) &&
            saved?.sha256 === row.sha256 &&
            saved.text.includes(input.query) &&
            (!input.categoryId || row.categoryId === input.categoryId) &&
            (!input.uploadedFrom ||
              row.createdAt >= new Date(input.uploadedFrom)) &&
            (!input.uploadedBefore ||
              row.createdAt < new Date(input.uploadedBefore))
          );
        })
        .sort(
          (a, b) =>
            b.createdAt - a.createdAt ||
            a.documentId.localeCompare(b.documentId),
        )
        .slice(0, 201);
      await state.onRead?.(matches);
      const accountId = await authorize(matches.map(source));
      for (const row of matches.slice(0, 200))
        await f.metadata.audit(
          patientId,
          row.documentId,
          accountId,
          'document.viewed',
        );
      await state.onAudit?.(matches);
      await authorize(matches.map(source));
      return {
        documentIds: matches.slice(0, 200).map((row) => row.documentId),
        truncated: matches.length > 200,
      };
    });
  const seed = (overrides = {}, text = query) => {
    const row = {
      uploadId: randomUUID(),
      documentId: randomUUID(),
      patientId: ids.patient,
      categoryId: ids.category,
      title: 'Synthetic original.pdf',
      mimeType: 'application/pdf',
      bytes: 42,
      sha256: 'a'.repeat(64),
      idempotencyKey: randomUUID(),
      objectKey: `synthetic/${randomUUID()}`,
      state: 'ready',
      createdAt: new Date('2026-11-13T12:00:00.000Z'),
      deletedAt: null,
      ...overrides,
    };
    f.metadata.rows.set(row.uploadId, row);
    f.metadata.committedRows.set(row.uploadId, globalThis.structuredClone(row));
    f.metadata.sync(row);
    if (text !== null)
      state.snapshots.set(row.documentId, { sha256: row.sha256, text });
    return row;
  };
  return { state, seed };
}

async function expect(response, status) {
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response;
}
const search = (f, session, input = { query }, headers, patientId) =>
  f.request(
    'POST',
    f.path('documents/search', patientId),
    session,
    input,
    headers,
  );
const result = async (f, session, input, status = 200) =>
  (await expect(await search(f, session, input), status)).json();

test('owner POST searches saved text with a trimmed private body and an ID-only no-store result', async () =>
  documentSetup(async (f) => {
    const { state, seed } = install(f);
    const hit = seed();
    seed({ title: `${query}.pdf` }, null);
    seed({}, 'Other synthetic saved text');
    const session = await f.login();
    assert.deepEqual(await result(f, session, { query: ` \n${query}\t ` }), {
      documentIds: [hit.documentId],
      truncated: false,
    });
    assert.equal(state.calls.length, 1);
    assert.deepEqual(state.calls[0].input, { query });
    assert.equal(state.calls[0].patientId, ids.patient);
    assert.equal(state.calls[0].eligibleIds.length, 3);
    assert.deepEqual(f.metadata.events, [
      {
        patientId: ids.patient,
        documentId: hit.documentId,
        accountId: ids.owner,
        kind: 'document.viewed',
      },
    ]);
    assert.ok(!JSON.stringify(f.logs).includes(query));
    assert.ok(!JSON.stringify(f.metadata.events).includes(query));
    assert.equal(f.objects.gets.length, 0);
  }));

test('category and canonical upload bounds pass unchanged; start is inclusive and end exclusive', async () =>
  documentSetup(async (f) => {
    const { state, seed } = install(f);
    const start = '2026-11-01T00:00:00.000Z';
    const end = '2026-11-02T00:00:00.000Z';
    const first = seed({ createdAt: new Date(start) });
    const last = seed({ createdAt: new Date('2026-11-01T23:59:59.999Z') });
    seed({ createdAt: new Date(end) });
    seed({ createdAt: new Date('2026-10-31T23:59:59.999Z') });
    seed({ createdAt: new Date(start), categoryId: ids.otherCategory });
    const input = {
      query,
      categoryId: ids.category,
      uploadedFrom: start,
      uploadedBefore: end,
    };
    assert.deepEqual(await result(f, await f.login(), input), {
      documentIds: [last.documentId, first.documentId],
      truncated: false,
    });
    assert.deepEqual(state.calls[0].input, input);
  }));

test('current view grants restrict text membership to exact document/category/patient scope', async () =>
  documentSetup(async (f) => {
    const { state, seed } = install(f);
    const first = seed();
    const second = seed();
    const other = seed({ categoryId: ids.otherCategory });
    seed({ patientId: ids.otherPatient });
    const session = await f.login(principals.caregiver.subject);
    const grant = f.access.grant({
      scope: { kind: 'document', documentId: first.documentId },
    });
    assert.deepEqual(await result(f, session), {
      documentIds: [first.documentId],
      truncated: false,
    });
    assert.deepEqual(state.calls.at(-1).eligibleIds, [first.documentId]);
    grant.scope = { kind: 'category', categoryId: ids.category };
    const category = await result(f, session);
    assert.deepEqual(
      new Set(category.documentIds),
      new Set([first.documentId, second.documentId]),
    );
    assert.equal(category.truncated, false);
    grant.scope = { kind: 'patient' };
    assert.deepEqual(
      new Set((await result(f, session)).documentIds),
      new Set([first.documentId, second.documentId, other.documentId]),
    );
    grant.revokedAt = new Date(f.access.now);
    await result(f, session, { query }, 404);
    grant.revokedAt = null;
    grant.expiresAt = new Date(f.access.now);
    await result(f, session, { query }, 404);
    grant.expiresAt = null;
    grant.patientId = ids.otherPatient;
    await result(f, session, { query }, 404);
  }));

test('export, edit, upload and manage never imply saved-text view; export retains title listing', async () =>
  documentSetup(async (f) => {
    const { state, seed } = install(f);
    const row = seed({ title: `${query}.pdf` });
    const session = await f.login(principals.caregiver.subject);
    const grant = f.access.grant({
      actions: ['export'],
      scope: { kind: 'document', documentId: row.documentId },
    });
    const listed = await (
      await expect(await f.request('GET', f.path('documents'), session), 200)
    ).json();
    assert.equal(listed.documents[0].title, row.title);
    assert.equal(listed.documents[0].canView, false);
    assert.equal(listed.documents[0].canExport, true);
    for (const actions of [
      ['export'],
      ['edit'],
      ['upload'],
      ['manage'],
      ['edit', 'export', 'upload', 'manage'],
    ]) {
      grant.actions = actions;
      assert.deepEqual(await result(f, session), empty);
    }
    assert.equal(state.calls.length, 0);
    assert.equal(f.metadata.events.length, 0);
  }));

test('authentication, current patient authority, CSRF and JSON content type protect search', async () =>
  documentSetup(async (f) => {
    const { state, seed } = install(f);
    seed();
    await expect(await search(f, undefined, { malformed: true }), 401);
    const session = await f.login();
    for (const headers of [
      { 'X-CSRF-Token': undefined },
      { 'X-CSRF-Token': 'incorrect' },
      { Origin: 'https://other.example.test' },
    ])
      await expect(await search(f, session, { query }, headers), 403);
    await expect(
      await search(f, session, { query }, { 'Content-Type': 'text/plain' }),
      400,
    );
    for (const patientId of [ids.otherPatient, ids.unknownPatient, 'invalid'])
      await expect(
        await search(f, session, { malformed: true }, {}, patientId),
        404,
      );
    const stranger = await f.login(principals.stranger.subject);
    await expect(await search(f, stranger, { malformed: true }), 404);
    assert.equal(state.calls.length, 0);
    assert.equal(f.metadata.events.length, 0);
  }));

test('HTTP rejects invalid strict inputs, Unicode, UTF-16 bounds and noncanonical or reversed instants', async () =>
  documentSetup(async (f) => {
    const { state, seed } = install(f);
    seed();
    const session = await f.login();
    for (const input of [
      null,
      [],
      {},
      { query: '' },
      { query: ' \n\t ' },
      { query: 42 },
      { query: 'x'.repeat(201) },
      { query: '😀'.repeat(100) + 'x' },
      { query: 'x\u0000y' },
      { query: '\ud800' },
      { query: '\udc00' },
      { query, unknown: true },
      { query, categoryId: 'invalid' },
      { query, categoryId: null },
      { query, uploadedFrom: '2026-11-01' },
      { query, uploadedFrom: '2026-11-01T00:00:00Z' },
      { query, uploadedBefore: '2026-11-01T00:00:00.000+00:00' },
      { query, uploadedBefore: '2026-02-30T00:00:00.000Z' },
      {
        query,
        uploadedFrom: '2026-11-02T00:00:00.000Z',
        uploadedBefore: '2026-11-01T00:00:00.000Z',
      },
      {
        query,
        uploadedFrom: '2026-11-01T00:00:00.000Z',
        uploadedBefore: '2026-11-01T00:00:00.000Z',
      },
    ])
      await result(f, session, input, 400);
    assert.equal(state.calls.length, 0);
    for (const validQuery of ['x'.repeat(200), '😀'.repeat(100), '!!!'])
      assert.deepEqual(await result(f, session, { query: validQuery }), empty);
    assert.equal(state.calls.length, 3);
    assert.ok(!JSON.stringify(f.logs).includes(query));
  }));

test('trashed, non-ready, other-patient and replaced-source saved text cannot become eligible', async () =>
  documentSetup(async (f) => {
    const { state, seed } = install(f);
    const hit = seed();
    seed({ deletedAt: new Date(f.access.now) });
    seed({ state: 'pending' });
    seed({ state: 'failed' });
    seed({ patientId: ids.otherPatient });
    const replaced = seed();
    state.snapshots.get(replaced.documentId).sha256 = 'b'.repeat(64);
    assert.deepEqual(await result(f, await f.login()), {
      documentIds: [hit.documentId],
      truncated: false,
    });
    assert.deepEqual(
      new Set(state.calls[0].eligibleIds),
      new Set([hit.documentId, replaced.documentId]),
    );
  }));

test('HTTP preserves the bounded ordered result and only authorized matches can trigger truncation', async () =>
  documentSetup(async (f) => {
    const { seed } = install(f);
    const documentIds = Array.from(
      { length: 200 },
      (_, index) =>
        seed({
          documentId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        }).documentId,
    );
    const sentinel = seed({ categoryId: ids.otherCategory });
    const session = await f.login(principals.caregiver.subject);
    f.access.grant({ scope: { kind: 'category', categoryId: ids.category } });
    assert.deepEqual(await result(f, session), {
      documentIds,
      truncated: false,
    });
    assert.equal(f.metadata.events.length, 200);
    f.metadata.events.length = 0;
    f.access.grant({
      scope: { kind: 'document', documentId: sentinel.documentId },
    });
    assert.deepEqual(await result(f, session), {
      documentIds,
      truncated: true,
    });
    assert.deepEqual(
      f.metadata.events.map((event) => event.documentId),
      documentIds,
    );
    assert.ok(
      !f.metadata.events.some(
        (event) => event.documentId === sentinel.documentId,
      ),
    );
  }));

test('revocation or expiry after metadata IO and after audit prevents releasing match IDs', async () =>
  documentSetup(async (f) => {
    const { state, seed } = install(f);
    seed();
    const session = await f.login(principals.caregiver.subject);
    const grant = f.access.grant();
    for (const hook of ['onRead', 'onAudit']) {
      for (const field of ['revokedAt', 'expiresAt']) {
        grant.revokedAt = null;
        grant.expiresAt = null;
        state[hook] = () => {
          grant[field] = new Date(f.access.now);
        };
        const denied = await expect(await search(f, session), 404);
        assert.ok(!(await denied.text()).includes(query));
        assert.equal(f.metadata.events.length, 0);
        state[hook] = null;
      }
    }
    grant.revokedAt = null;
    grant.expiresAt = null;
    assert.equal((await result(f, session)).documentIds.length, 1);
    assert.equal(f.metadata.events.length, 1);
  }));

test('the final authorization callback rejects changed source patient, scope, state and Trash', async () =>
  documentSetup(async (f) => {
    const { state, seed } = install(f);
    const row = seed();
    const session = await f.login(principals.caregiver.subject);
    f.access.grant({ scope: { kind: 'category', categoryId: ids.category } });
    for (const change of [
      { patientId: ids.otherPatient },
      { categoryId: ids.otherCategory },
      { state: 'failed' },
      { deletedAt: new Date(f.access.now) },
    ]) {
      state.onRead = (rows) => {
        Object.assign(rows[0], change);
      };
      await result(f, session, { query }, 404);
      assert.equal(f.metadata.events.length, 0);
      // The synthetic transaction rolls metadata back after denial.
      assert.equal(f.metadata.rows.get(row.uploadId).patientId, ids.patient);
    }
  }));

test('search, metadata, permission and audit failures are generic, private and retryable', async () =>
  documentSetup(async (f) => {
    install(f).seed();
    const session = await f.login();
    for (const failure of [
      'search',
      'list',
      'categories',
      'audit',
      'permission',
    ]) {
      if (failure === 'permission') f.access.fail = 'load';
      else f.metadata.fail = failure;
      const failed = await expect(await search(f, session), 503);
      const body = await failed.text();
      assert.ok(!body.includes(query));
      assert.ok(!body.includes('sensitive'));
      assert.ok(!body.includes('Synthetic original'));
      assert.ok(!body.includes('documentIds'));
      assert.equal(f.metadata.events.length, 0);
      f.metadata.fail = null;
      f.access.fail = null;
    }
    assert.equal((await result(f, session)).documentIds.length, 1);
    assert.ok(!JSON.stringify(f.logs).includes(query));
    assert.ok(!JSON.stringify(f.logs).includes('sensitive'));
  }));
