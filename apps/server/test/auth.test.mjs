import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createApplication } from '../dist/application.js';
import { authConfig } from '../dist/auth/auth.config.js';
import { SupabaseProvider } from '../dist/auth/supabase.provider.js';
import { digest, opaque, seal, unseal } from '../dist/auth/auth.crypto.js';
import { config, fixture } from './support/auth-fixture.mjs';

async function server(run) {
  const f = fixture();
  const events = [];
  const { app } = await createApplication({
    auth: f.auth,
    docs: false,
    log: (e) => events.push(e),
  });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const jar = new Map();
  const call = async (path, body, extra = {}) => {
    const headers = {
      Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      ...(body === undefined
        ? {}
        : {
            'Content-Type': 'application/json',
            Origin: config.origin,
            'X-CSRF-Token': jar.get('fmv_csrf') ?? '',
          }),
      ...extra,
    };
    const res = await globalThis.fetch(`${base}/api/auth/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    });
    for (const header of res.headers.getSetCookie()) {
      const pair = header.split(';')[0];
      const i = pair.indexOf('=');
      const k = pair.slice(0, i),
        v = pair.slice(i + 1);
      if (v) jar.set(k, v);
      else jar.delete(k);
    }
    return res;
  };
  try {
    await call('bootstrap');
    await run({ ...f, events, call, jar, base });
  } finally {
    await app.close();
  }
}

test('auth config fails closed and requires dedicated server-only secrets and HTTPS', () => {
  assert.equal(authConfig({}), null);
  const good = {
    AUTH_ENABLED: 'true',
    AUTH_ORIGIN: config.origin,
    SUPABASE_URL: config.providerUrl,
    SUPABASE_PUBLISHABLE_KEY: config.publicKey,
    AUTH_SESSION_KEY: config.encryptionKey.toString('hex'),
    DATABASE_URL: 'postgresql://fmv_app:fixture@127.0.0.1:5432/fmv_dev',
    NODE_ENV: 'development',
  };
  assert.equal(authConfig(good).secure, false);
  for (const changes of [
    { NODE_ENV: 'production' },
    { AUTH_ORIGIN: 'https://safe.test/evil' },
    { SUPABASE_URL: 'https://evil.test' },
    { SUPABASE_PUBLISHABLE_KEY: 'service_role' },
    { AUTH_SESSION_KEY: 'bad' },
    { DATABASE_URL: 'postgresql://postgres:fixture@127.0.0.1:5432/fmv_dev' },
    {
      DATABASE_URL: 'postgresql://fmv_app:fixture@remote.example:5432/postgres',
    },
  ])
    assert.throws(() => authConfig({ ...good, ...changes }));
});

test('session encryption authenticates ciphertext and row binding; no tokens or raw cookie IDs at rest', async () => {
  const f = fixture();
  const id = await f.auth.login('fixture@example.test', 'synthetic-password');
  const row = [...f.store.rows.values()][0];
  assert.equal(row.idHash, digest(id));
  assert.ok(!JSON.stringify(row).includes('synthetic-access'));
  assert.ok(!JSON.stringify(row).includes(id));
  assert.throws(() => unseal(row.payload, config.encryptionKey, 'wrong-row'));
  assert.throws(() =>
    unseal(
      row.payload.slice(0, -8) + 'tampered',
      config.encryptionKey,
      row.idHash,
    ),
  );
});

test('concurrent protected requests serialize refresh, then provider revocation denies an unexpired application session', async () => {
  const f = fixture();
  const id = await f.auth.login('fixture@example.test', 'synthetic-password');
  const values = await Promise.all(
    Array.from({ length: 5 }, () => f.auth.account(id)),
  );
  assert.ok(values.every((v) => v.email === 'fixture@example.test'));
  f.provider.tokens.clear();
  await assert.rejects(f.auth.account(id), UnauthorizedException);
  assert.equal(f.store.rows.size, 0);
});

test('expired, idle, malformed, disabled and uncertain refresh sessions fail closed', async () => {
  for (const mode of ['expiry', 'idle', 'corrupt', 'banned', 'timeout']) {
    const f = fixture();
    const id = await f.auth.login('fixture@example.test', 'synthetic-password');
    const row = f.store.rows.get(digest(id));
    const data = f.decode(row);
    if (mode === 'expiry') row.expiresAt = new Date(0);
    if (mode === 'idle') {
      data.idleUntil = 0;
      row.payload = seal(data, config.encryptionKey, row.idHash);
    }
    if (mode === 'corrupt') row.payload = 'invalid';
    if (mode === 'banned') f.provider.failure = new UnauthorizedException();
    if (mode === 'timeout')
      f.provider.failure = new ServiceUnavailableException();
    await assert.rejects(f.auth.account(id));
    assert.equal(f.store.rows.size, 0);
  }
  await assert.rejects(
    fixture().auth.account('malformed'),
    UnauthorizedException,
  );
});

test('callbacks require same-browser flow, state and PKCE; valid exchange rotates identity and is single-use', async () => {
  const f = fixture();
  const old = await f.auth.login('fixture@example.test', 'synthetic-password');
  const flow = await f.auth.begin('google');
  const row = f.store.rows.get(digest(flow.id));
  const data = f.decode(row);
  const code = f.provider.issue(data);
  await assert.rejects(f.auth.callback(undefined, code, data.state));
  await assert.rejects(f.auth.callback(flow.id, code, opaque()));
  const next = await f.auth.callback(flow.id, code, data.state, old);
  assert.notEqual(next.id, flow.id);
  assert.notEqual(next.id, old);
  assert.equal(next.recovery, false);
  await assert.rejects(f.auth.account(old));
  await assert.rejects(f.auth.callback(flow.id, code, data.state));
  assert.deepEqual(await f.auth.account(next.id), {
    email: 'fixture@example.test',
  });
});

test('recovery grants no account access; reset is single-use and invalidates all application sessions', async () => {
  const f = fixture();
  const login = await f.auth.login(
    'fixture@example.test',
    'synthetic-password',
  );
  const flow = await f.auth.begin('recover', 'fixture@example.test');
  const data = f.decode(f.store.rows.get(digest(flow.id)));
  const recovery = await f.auth.callback(
    flow.id,
    f.provider.issue(data),
    data.state,
  );
  assert.equal(recovery.recovery, true);
  await assert.rejects(f.auth.account(recovery.id));
  await assert.rejects(f.auth.reset(login, 'new-synthetic-password'));
  await f.auth.reset(recovery.id, 'new-synthetic-password');
  assert.equal(f.store.rows.size, 0);
  await assert.rejects(f.auth.account(login));
  await assert.rejects(f.auth.reset(recovery.id, 'new-synthetic-password'));
  assert.equal(f.provider.passwordCalls, 1);
});

test('an uncertain password update still consumes recovery and revokes existing application sessions', async () => {
  const f = fixture();
  await f.auth.login('fixture@example.test', 'synthetic-password');
  const flow = await f.auth.begin('recover', 'fixture@example.test');
  const data = f.decode(f.store.rows.get(digest(flow.id)));
  const recovery = await f.auth.callback(
    flow.id,
    f.provider.issue(data),
    data.state,
  );
  f.provider.passwordFailure = new ServiceUnavailableException();
  await assert.rejects(f.auth.reset(recovery.id, 'new-synthetic-password'));
  assert.equal(f.store.rows.size, 0);
});

test('HTTP rejects CSRF, hostile origins, forwarded-header spoofing, bad fields and account enumeration', async () =>
  server(async ({ call, jar, provider }) => {
    const credentials = {
      email: 'fixture@example.test',
      password: 'synthetic-password',
    };
    assert.equal(
      (await call('login', credentials, { Origin: 'https://evil.test' }))
        .status,
      403,
    );
    assert.equal(
      (await call('login', credentials, { 'X-CSRF-Token': opaque() })).status,
      403,
    );
    assert.equal(
      (await call('login', credentials, { 'Sec-Fetch-Site': 'cross-site' }))
        .status,
      403,
    );
    assert.equal(
      (await call('register', { ...credentials, password: 'short' })).status,
      400,
    );
    assert.equal(
      (await call('login', { ...credentials, admin: true })).status,
      400,
    );
    assert.equal((await call('account')).status, 401);
    const first = await call('recover', { email: 'first@example.test' });
    provider.failure = new UnauthorizedException(
      'synthetic-private-provider-error',
    );
    const second = await call('recover', { email: 'missing@example.test' });
    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    assert.deepEqual(await first.json(), await second.json());
    assert.ok(!jar.has('fmv_session'));
  }));

test('HTTP cookies are opaque/HttpOnly; logout and replay fail even if provider logout fails; logs stay allowlisted', async () =>
  server(async ({ call, jar, provider, events }) => {
    const login = await call('login', {
      email: 'fixture@example.test',
      password: 'synthetic-private-password',
    });
    assert.equal(login.status, 200);
    const cookie = login.headers
      .getSetCookie()
      .find((x) => x.startsWith('fmv_session='));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.ok(!cookie.includes('synthetic-access'));
    const old = jar.get('fmv_session');
    const account = await call('account');
    assert.deepEqual(await account.json(), { email: 'fixture@example.test' });
    provider.failure = new ServiceUnavailableException(
      'synthetic-private-provider-error',
    );
    assert.equal((await call('logout', {})).status, 503);
    assert.ok(!jar.has('fmv_session'));
    jar.set('fmv_session', old);
    assert.equal((await call('account')).status, 401);
    assert.ok(!JSON.stringify(events).includes('synthetic-private'));
    assert.ok(!JSON.stringify(events).includes('fixture@example.test'));
    for (const event of events)
      assert.deepEqual(Object.keys(event).sort(), [
        'durationMs',
        'event',
        'method',
        'requestId',
        'status',
      ]);
  }));

test('HTTP rate limits are shared by email across supplied forwarded addresses', async () =>
  server(async ({ call }) => {
    for (let i = 0; i < 8; i++)
      assert.equal(
        (
          await call(
            'recover',
            { email: 'fixture@example.test' },
            { 'X-Forwarded-For': `192.0.2.${i}` },
          )
        ).status,
        202,
      );
    const response = await call(
      'recover',
      { email: 'fixture@example.test' },
      { 'X-Forwarded-For': '192.0.2.200' },
    );
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '900');
  }));

test('callback never redirects to supplied targets or exposes error/code details', async () =>
  server(async ({ call }) => {
    const response = await call(
      'callback?code=synthetic-private-code&state=bad&next=https://evil.test',
    );
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/#auth-error');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.ok(!(await response.text()).includes('synthetic-private'));
  }));

test('Supabase REST adapter validates verified identities and sanitizes failures without provider text', async () => {
  const calls = [];
  const token = {
    access_token: 'synthetic-access',
    refresh_token: 'synthetic-refresh',
    user: {
      id: 'fixture-id',
      email: 'fixture@example.test',
      email_confirmed_at: '2026-11-05T00:00:00Z',
    },
  };
  const provider = new SupabaseProvider(config, async (url, options) => {
    calls.push({ url, options });
    return new globalThis.Response(JSON.stringify(token), { status: 200 });
  });
  await provider.login('fixture@example.test', 'synthetic-password');
  await provider.refresh('synthetic-refresh');
  await provider.exchange('code', 'verifier');
  assert.ok(calls[0].url.endsWith('/token?grant_type=password'));
  assert.ok(calls[1].url.endsWith('/token?grant_type=refresh_token'));
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    auth_code: 'code',
    code_verifier: 'verifier',
  });
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.apikey, config.publicKey);
  const unverified = new SupabaseProvider(
    config,
    async () =>
      new globalThis.Response(
        JSON.stringify({
          ...token,
          user: { ...token.user, email_confirmed_at: null },
        }),
      ),
  );
  await assert.rejects(
    unverified.login('fixture@example.test', 'synthetic-password'),
    UnauthorizedException,
  );
  for (const status of [400, 401, 429, 500]) {
    const bad = new SupabaseProvider(
      config,
      async () =>
        new globalThis.Response('synthetic-private-provider-error', { status }),
    );
    await assert.rejects(
      bad.login('fixture@example.test', 'synthetic-password'),
      (error) =>
        !error.message.includes('synthetic-private') &&
        error.getStatus() === (status >= 429 ? 503 : 401),
    );
  }
});

test('automatic liveness probes never extend idle expiry', async (t) => {
  const f = fixture();
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const id = await f.auth.login('fixture@example.test', 'synthetic-password');
  t.mock.timers.tick(15 * 60_000);
  await f.auth.account(id);
  t.mock.timers.tick(15 * 60_000 + 1);
  await assert.rejects(f.auth.account(id), UnauthorizedException);
  await f.auth.onModuleDestroy();
});

test('expired and failed PKCE flows cannot create or replay sessions', async () => {
  for (const kind of ['expiry', 'exchange']) {
    const f = fixture();
    const flow = await f.auth.begin('google');
    const row = f.store.rows.get(digest(flow.id));
    const data = f.decode(row);
    if (kind === 'expiry') row.expiresAt = new Date(0);
    await assert.rejects(f.auth.callback(flow.id, 'wrong-code', data.state));
    assert.ok([...f.store.rows.values()].every((r) => !r.userId));
    if (kind === 'exchange')
      assert.equal(f.store.rows.has(digest(flow.id)), false);
    await f.auth.onModuleDestroy();
  }
});
