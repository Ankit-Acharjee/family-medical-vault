import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createApplication } from '../dist/application.js';
import { CaregiverService } from '../dist/access/caregiver.service.js';
import { validateProposal } from '../dist/access/invitation.js';
import { SupabaseProvider } from '../dist/auth/supabase.provider.js';
import { digest } from '../dist/auth/auth.crypto.js';
import { fixture, config } from './support/auth-fixture.mjs';

const ids = {
  patient: randomUUID(),
  otherPatient: randomUUID(),
  invitation: randomUUID(),
  grant: randomUUID(),
  person: randomUUID(),
};
const secret = 'T'.repeat(43);
const proposal = {
  actions: ['view', 'upload'],
  scope: { kind: 'patient' },
  expiresInHours: 24,
};
const paths = {
  list: `/api/patients/${ids.patient}/access`,
  create: `/api/patients/${ids.patient}/access/invitations`,
  request: '/api/access/requests',
  inspect: '/api/access/inspect',
  claim: '/api/access/claim',
  approve: `/api/patients/${ids.patient}/access/invitations/${ids.invitation}/approve`,
  approveRequest: `/api/patients/${ids.patient}/access/requests/approve`,
  revokeInvitation: `/api/patients/${ids.patient}/access/invitations/${ids.invitation}/revoke`,
  revokeGrant: `/api/patients/${ids.patient}/access/grants/${ids.grant}/revoke`,
};
const endpoints = [
  ['GET', paths.list, undefined],
  ['POST', paths.create, proposal],
  ['POST', paths.request, proposal],
  ['POST', paths.inspect, { token: secret }],
  ['POST', paths.claim, { token: secret }],
  ['POST', paths.approve, {}],
  ['POST', paths.approveRequest, { token: secret }],
  ['POST', paths.revokeInvitation, {}],
  ['POST', paths.revokeGrant, {}],
];

async function setup(run) {
  const f = fixture();
  const calls = [];
  const events = [];
  const failures = new Map();
  const { app } = await createApplication({
    auth: f.auth,
    docs: false,
    log: (event) => events.push(event),
  });
  // Per-instance transport doubles: no provider/database caregiver operations.
  // Authorization, replay, lineage and transaction semantics have separate DB tests.
  const service = app.get(CaregiverService);
  const outcomes = {
    list: () => ({ grants: [], invitations: [] }),
    create: (_principal, _patientId, input) => {
      validateProposal(input);
      return {
        id: ids.invitation,
        token: secret,
        expiresAt: '2030-01-01T00:00:00.000Z',
      };
    },
    inspect: () => ({
      kind: 'request',
      actions: proposal.actions,
      scope: proposal.scope,
      expiresAt: '2030-01-01T00:00:00.000Z',
      requesterName: 'Synthetic Caller',
      requesterPersonId: ids.person,
    }),
    claim: () => ({ id: ids.invitation, state: 'claimed' }),
    approve: () => ({ grantId: ids.grant }),
    revoke: () => ({}),
  };
  for (const [operation, outcome] of Object.entries(outcomes)) {
    service[operation] = async (...args) => {
      calls.push({ operation, args: globalThis.structuredClone(args) });
      if (failures.has(operation)) throw failures.get(operation);
      return outcome(...args);
    };
  }
  try {
    await app.listen(0, '127.0.0.1');
  } catch (error) {
    await app.close();
    throw error;
  }
  const base = await app.getUrl();
  const csrf = 'c'.repeat(43);
  const call = (method, path, session, body, headers = {}, raw = false) =>
    globalThis.fetch(`${base}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        Cookie: `fmv_csrf=${csrf}${session ? `; fmv_session=${session}` : ''}`,
        Origin: config.origin,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: raw ? body : JSON.stringify(body) }),
    });
  const login = async (subject = 'synthetic-caregiver-subject') => {
    f.provider.login = async (email) => f.provider.mint(email, subject);
    return f.auth.login('synthetic@example.test', 'synthetic');
  };
  try {
    await run({ ...f, app, calls, events, failures, call, login, csrf });
  } finally {
    await app.close();
  }
}

async function expect(response, expected) {
  assert.equal(
    response.status,
    expected,
    response.status === expected ? undefined : await response.text(),
  );
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response;
}

test('caregiver routes bind authenticated calls to the live principal and explicit route/body values', async () =>
  setup(async (f) => {
    const session = await f.login();
    const principal = {
      issuer: config.providerUrl,
      subject: 'synthetic-caregiver-subject',
    };
    const expectedCalls = [
      ['list', [principal, ids.patient]],
      ['create', [principal, ids.patient, proposal]],
      ['create', [principal, null, proposal]],
      ['inspect', [principal, secret]],
      ['claim', [principal, secret]],
      ['approve', [principal, ids.patient, ids.invitation]],
      ['approve', [principal, ids.patient, secret, true]],
      ['revoke', [principal, ids.patient, ids.invitation, true]],
      ['revoke', [principal, ids.patient, ids.grant]],
    ];
    for (let i = 0; i < endpoints.length; i++) {
      const [method, path, body] = endpoints[i];
      const response = await expect(
        await f.call(method, path, session, body),
        method === 'GET' ? 200 : 201,
      );
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(f.calls.length, i + 1);
      assert.deepEqual(f.calls[i], {
        operation: expectedCalls[i][0],
        args: expectedCalls[i][1],
      });
    }
    assert.equal(f.calls.filter((c) => c.operation === 'approve').length, 2);
    // Inspection and claiming are separate service operations, never approval.
    assert.equal(
      f.calls.findIndex((c) => c.operation === 'approve'),
      5,
    );
  }));

const invalidSessions = [
  ['anonymous', 401, async () => undefined],
  ['unknown', 401, async () => 'u'.repeat(43)],
  [
    'logged-out',
    401,
    async (f) => {
      const session = await f.login();
      await f.auth.logout(session);
      return session;
    },
  ],
  [
    'recovery',
    403,
    async (f) => {
      const flow = await f.auth.begin('recover', 'synthetic@example.test');
      const data = f.decode(f.store.rows.get(digest(flow.id)));
      return (
        await f.auth.callback(
          flow.id,
          f.provider.issue(data, 'synthetic@example.test'),
          data.state,
        )
      ).id;
    },
  ],
  [
    'unverified-provider-account',
    401,
    async (f) => {
      const session = await f.login();
      // Use the real provider response validator with an in-process response.
      // No network request is made and an unverified refresh cannot reach service.
      const rejectingProvider = new SupabaseProvider(
        config,
        async () =>
          new globalThis.Response(
            JSON.stringify({
              access_token: 'synthetic-access',
              refresh_token: 'synthetic-refresh',
              user: {
                id: 'synthetic-caregiver-subject',
                email: 'synthetic@example.test',
                email_confirmed_at: null,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      );
      f.provider.refresh = (token) => rejectingProvider.refresh(token);
      return session;
    },
  ],
];
for (const [name, expected, sessionFor] of invalidSessions) {
  test(`${name} cannot reach any caregiver service operation`, async () =>
    setup(async (f) => {
      const session = await sessionFor(f);
      for (const [method, path, body] of endpoints)
        await expect(await f.call(method, path, session, body), expected);
      assert.deepEqual(f.calls, []);
    }));
}

test('Origin, CSRF, fetch-site and JSON boundaries reject writes before caregiver service calls', async () =>
  setup(async (f) => {
    const session = await f.login();
    for (const [headers, expected] of [
      [{ Origin: 'https://hostile.test' }, 403],
      [{ Origin: '' }, 403],
      [{ 'X-CSRF-Token': '' }, 403],
      [{ 'X-CSRF-Token': 'wrong' }, 403],
      [{ Cookie: `fmv_session=${session}` }, 403],
      [{ 'Sec-Fetch-Site': 'cross-site' }, 403],
      [{ 'Content-Type': 'text/plain' }, 400],
      [{ 'Content-Type': 'application/octet-stream' }, 400],
    ])
      await expect(
        await f.call('POST', paths.claim, session, { token: secret }, headers),
        expected,
      );
    await expect(
      await f.call('POST', paths.request, session, '{"actions":', {}, true),
      400,
    );
    assert.deepEqual(f.calls, []);
  }));

test('token-only and empty-confirmation bodies reject extra fields and identity selectors', async () =>
  setup(async (f) => {
    const session = await f.login();
    for (const path of [paths.inspect, paths.claim, paths.approveRequest]) {
      for (const body of [
        {},
        { token: 42 },
        { token: secret, recipientAccountId: ids.person },
      ])
        await expect(await f.call('POST', path, session, body), 400);
    }
    for (const path of [
      paths.approve,
      paths.revokeInvitation,
      paths.revokeGrant,
    ]) {
      for (const body of [
        [],
        null,
        { actions: ['export'] },
        { recipientAccountId: ids.person },
      ])
        await expect(await f.call('POST', path, session, body), 400);
    }
    assert.deepEqual(f.calls, []);
    for (const path of [paths.create, paths.request]) {
      await expect(
        await f.call('POST', path, session, {
          ...proposal,
          patientId: ids.otherPatient,
        }),
        400,
      );
      assert.equal(f.calls.at(-1).operation, 'create');
    }
  }));

test('query parameters and spoofed identity headers cannot select the principal or supply a token', async () =>
  setup(async (f) => {
    const session = await f.login('bound-session-subject');
    const headers = {
      'X-Account-ID': ids.person,
      'X-Patient-ID': ids.otherPatient,
      'X-Role': 'admin',
    };
    const query = `?token=${secret}&subject=forged-subject&patientId=${ids.otherPatient}`;
    await expect(
      await f.call(
        'GET',
        `${paths.inspect}${query}`,
        session,
        undefined,
        headers,
      ),
      404,
    );
    await expect(
      await f.call(
        'GET',
        `${paths.claim}${query}`,
        session,
        undefined,
        headers,
      ),
      404,
    );
    await expect(
      await f.call('POST', `${paths.inspect}${query}`, session, {}, headers),
      400,
    );
    await expect(
      await f.call('POST', `${paths.claim}${query}`, session, {}, headers),
      400,
    );
    assert.deepEqual(f.calls, []);
    const response = await expect(
      await f.call(
        'POST',
        `${paths.inspect}?token=${'Q'.repeat(43)}`,
        session,
        { token: secret },
        headers,
      ),
      201,
    );
    assert.equal((await response.json()).kind, 'request');
    assert.deepEqual(f.calls, [
      {
        operation: 'inspect',
        args: [
          { issuer: config.providerUrl, subject: 'bound-session-subject' },
          secret,
        ],
      },
    ]);
  }));

test('authorization denials and unexpected caregiver failures return generic responses without secret logging', async () =>
  setup(async (f) => {
    const session = await f.login();
    const sensitive = 'synthetic-private-database-details';
    f.failures.set('list', new NotFoundException(sensitive));
    const denied = await expect(await f.call('GET', paths.list, session), 404);
    const deniedBody = await denied.json();
    assert.equal(deniedBody.error.code, 'NOT_FOUND');
    f.failures.set(
      'claim',
      new ServiceUnavailableException(`${sensitive} ${secret}`),
    );
    const unavailable = await expect(
      await f.call('POST', paths.claim, session, { token: secret }),
      503,
    );
    const failedBody = await unavailable.json();
    assert.equal(failedBody.error.code, 'INTERNAL_ERROR');
    f.failures.set('inspect', new Error(`${sensitive} ${secret}`));
    const unexpected = await expect(
      await f.call('POST', paths.inspect, session, { token: secret }),
      500,
    );
    const unexpectedBody = await unexpected.json();
    assert.equal(unexpectedBody.error.code, 'INTERNAL_ERROR');
    const serialized = JSON.stringify({
      events: f.events,
      deniedBody,
      failedBody,
      unexpectedBody,
    });
    for (const value of [
      sensitive,
      secret,
      session,
      ids.patient,
      config.providerUrl,
      'synthetic@example.test',
    ])
      assert.ok(!serialized.includes(value));
    for (const event of f.events)
      assert.deepEqual(Object.keys(event).sort(), [
        'durationMs',
        'event',
        'method',
        'requestId',
        'status',
      ]);
  }));

test('successful token operations return no-store responses and keep tokens, identity and scope out of request logs', async () =>
  setup(async (f) => {
    const session = await f.login();
    const created = await expect(
      await f.call('POST', paths.create, session, proposal),
      201,
    );
    assert.equal((await created.json()).token, secret);
    await expect(
      await f.call('POST', paths.inspect, session, { token: secret }),
      201,
    );
    await expect(
      await f.call('POST', paths.claim, session, { token: secret }),
      201,
    );
    const serialized = JSON.stringify(f.events);
    for (const value of [
      secret,
      session,
      ids.patient,
      ids.invitation,
      config.providerUrl,
      'Synthetic Caller',
      'synthetic-caregiver-subject',
      'synthetic@example.test',
    ])
      assert.ok(!serialized.includes(value));
    assert.equal(f.events.length, 3);
  }));
