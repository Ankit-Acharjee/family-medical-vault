import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { test } from 'node:test';
import { createApplication } from '../dist/application.js';
import { fixture, config } from './support/auth-fixture.mjs';
import { PersonStore } from '../dist/identity/person.store.js';

class MemoryPeople extends PersonStore {
  rows = new Map();
  fail = false;
  async find(principal) {
    if (this.fail) throw new Error('synthetic sensitive failure');
    return this.rows.get(JSON.stringify(principal)) ?? null;
  }
  async create(principal, displayName) {
    const key = JSON.stringify(principal);
    const existing = await this.find(principal);
    if (existing) return existing;
    const value = { id: randomUUID(), displayName };
    this.rows.set(key, value);
    return value;
  }
}
async function setup(run) {
  const f = fixture();
  const people = new MemoryPeople();
  const events = [];
  const { app } = await createApplication({
    auth: f.auth,
    people,
    log: (event) => events.push(event),
    docs: false,
  });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const csrf = 'c'.repeat(43);
  const call = (method = 'GET', body, session, path = 'person', extra = {}) =>
    globalThis.fetch(`${base}/api/auth/${path}`, {
      method,
      redirect: 'manual',
      headers: {
        Cookie: `fmv_csrf=${csrf}${session ? `; fmv_session=${session}` : ''}`,
        Origin: config.origin,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    await run({ ...f, people, events, call });
  } finally {
    await app.close();
  }
}

test('own Person requires a verified account session and denies recovery, revoked and unknown sessions', async () =>
  setup(async ({ auth, provider, call }) => {
    assert.equal((await call()).status, 401);
    assert.equal((await call('POST', { displayName: 'Fixture' })).status, 401);
    assert.equal((await call('GET', undefined, 'a'.repeat(43))).status, 401);
    const session = await auth.login('fixture@example.test', 'synthetic');
    provider.tokens.clear();
    assert.equal((await call('GET', undefined, session)).status, 401);
    const flow = await auth.begin('recover', 'fixture@example.test');
    const sent = provider.sent.at(-1);
    const code = 'recovery-fixture';
    provider.codes.set(code, {
      challenge: sent.challenge,
      email: 'fixture@example.test',
    });
    const recovery = await auth.callback(
      flow.id,
      code,
      new URL(sent.redirect).searchParams.get('state'),
    );
    assert.equal((await call('GET', undefined, recovery.id)).status, 403);
  }));

test('onboarding is explicit, trims names, returns same ID on retry and never accepts identity selectors', async () =>
  setup(async ({ auth, call, people, events }) => {
    const session = await auth.login('fixture@example.test', 'synthetic');
    assert.deepEqual(await (await call('GET', undefined, session)).json(), {
      person: null,
    });
    assert.equal(people.rows.size, 0);
    for (const displayName of ['', '   ', 'x'.repeat(101), 7, null])
      assert.equal((await call('POST', { displayName }, session)).status, 400);
    const first = await call(
      'POST',
      { displayName: ' Fixture Person ' },
      session,
    );
    assert.equal(first.status, 200);
    const created = await first.json();
    assert.match(created.person.id, /^[a-f0-9-]{36}$/);
    assert.equal(created.person.displayName, 'Fixture Person');
    assert.deepEqual(
      await (
        await call('POST', { displayName: 'Different name' }, session)
      ).json(),
      created,
    );
    assert.deepEqual(
      await (await call('GET', undefined, session)).json(),
      created,
    );
    for (const field of ['personId', 'accountId', 'subject', 'issuer'])
      assert.equal(
        (
          await call(
            'POST',
            { displayName: 'Fixture', [field]: created.person.id },
            session,
          )
        ).status,
        400,
      );
    assert.equal(
      (
        await call('POST', { displayName: 'Fixture' }, session, 'person', {
          Origin: 'https://evil.test',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call('POST', { displayName: 'Fixture' }, session, 'person', {
          'X-CSRF-Token': '',
        })
      ).status,
      403,
    );
    assert.ok(!JSON.stringify(events).includes('Fixture Person'));
  }));

test('different accounts with the same name/email stay distinct; logout and fresh login preserve the self identity', async () =>
  setup(async ({ auth, provider, call }) => {
    let subject = 'account-a';
    provider.login = async (email) => provider.mint(email, subject);
    const first = await auth.login('same@example.test', 'synthetic');
    const a = await (
      await call('POST', { displayName: 'Same Person' }, first)
    ).json();
    subject = 'account-b';
    const second = await auth.login('same@example.test', 'synthetic');
    assert.deepEqual(await (await call('GET', undefined, second)).json(), {
      person: null,
    });
    const b = await (
      await call('POST', { displayName: 'Same Person' }, second)
    ).json();
    assert.notEqual(a.person.id, b.person.id);
    assert.equal(
      (await call('GET', undefined, second, `person/${a.person.id}`)).status,
      404,
    );
    await auth.logout(first);
    assert.equal((await call('GET', undefined, first)).status, 401);
    subject = 'account-a';
    const renewed = await auth.login('changed@example.test', 'synthetic');
    assert.deepEqual(await (await call('GET', undefined, renewed)).json(), a);
  }));

test('identity storage failures are sanitized and fail closed', async () =>
  setup(async ({ auth, call, people }) => {
    const session = await auth.login('fixture@example.test', 'synthetic');
    people.fail = true;
    for (const method of ['GET', 'POST']) {
      const response = await call(
        method,
        method === 'POST' ? { displayName: 'Fixture' } : undefined,
        session,
      );
      assert.equal(response.status, 503);
      assert.ok(!(await response.text()).includes('sensitive'));
    }
  }));
