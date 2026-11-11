import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { test } from 'node:test';
import { createApplication } from '../dist/application.js';
import { PermissionService } from '../dist/access/permission.service.js';
import { fixture, config } from './support/auth-fixture.mjs';
import {
  MemoryAccess,
  actions,
  ids,
  principals,
} from './support/access-fixture.mjs';

const patientScope = { kind: 'patient' };
const categoryScope = { kind: 'category', categoryId: ids.category };
const documentScope = { kind: 'document', documentId: ids.document };
const status = (expected) => (error) => {
  assert.equal(error.getStatus?.(), expected);
  assert.ok(!String(error.message).includes('sensitive'));
  return true;
};
const denied = (work) => assert.rejects(work, status(404));

test('explicit owner rule permits each action but never bypasses resource existence or patient ownership', async () => {
  const store = new MemoryAccess();
  const permissions = new PermissionService(store);
  for (const action of actions) {
    for (const scope of [patientScope, categoryScope, documentScope])
      assert.deepEqual(
        await permissions.require(principals.owner, ids.patient, action, scope),
        {
          accountId: ids.owner,
          patientId: ids.patient,
        },
      );
    await denied(() =>
      permissions.require(principals.owner, ids.otherPatient, action),
    );
    await denied(() =>
      permissions.require(principals.owner, ids.unknownPatient, action),
    );
    await denied(() =>
      permissions.require(principals.owner, ids.patient, action, {
        kind: 'document',
        documentId: ids.otherPatientDocument,
      }),
    );
    await denied(() =>
      permissions.require(principals.owner, ids.patient, action, {
        kind: 'document',
        documentId: ids.unknownDocument,
      }),
    );
    await denied(() =>
      permissions.require(principals.owner, ids.patient, action, {
        kind: 'category',
        categoryId: ids.unknownCategory,
      }),
    );
  }
});

test('every granted action is independent, including view/export and manage/delegated content actions', async () => {
  for (const granted of actions) {
    const store = new MemoryAccess();
    store.grant({ actions: [granted] });
    const permissions = new PermissionService(store);
    for (const requested of actions) {
      const work = () =>
        permissions.require(principals.caregiver, ids.patient, requested);
      if (granted === requested)
        assert.equal((await work()).accountId, ids.caregiver);
      else await denied(work);
    }
  }
});

test('malformed resource scopes and newline-suffixed UUIDs fail closed before owner or broad-grant shortcuts', async () => {
  const store = new MemoryAccess();
  store.grant({ actions });
  const permissions = new PermissionService(store);
  const malformedScopes = [
    null,
    false,
    'patient',
    [],
    {},
    { kind: 'unknown-resource' },
    { kind: 'patient', documentId: ids.otherPatientDocument },
    { kind: 'category' },
    { kind: 'category', categoryId: 7 },
    { kind: 'category', categoryId: `${ids.category}\n` },
    { kind: 'category', categoryId: ids.category, documentId: ids.document },
    { kind: 'document' },
    { kind: 'document', documentId: 'not-a-uuid' },
    { kind: 'document', documentId: `${ids.document}\n` },
    { kind: 'document', documentId: ids.document, categoryId: ids.category },
  ];
  for (const principal of [principals.owner, principals.caregiver]) {
    const snapshot = await store.load(principal, ids.patient);
    for (const scope of malformedScopes) {
      assert.equal(permissions.allows(snapshot, 'view', scope), false);
      await denied(() =>
        permissions.require(principal, ids.patient, 'view', scope),
      );
    }
    await denied(() =>
      permissions.require(principal, `${ids.patient}\n`, 'view'),
    );
    await denied(() =>
      permissions.require(principal, ids.patient, 'unknown-action'),
    );
  }
  store.grants = [];
  store.grant({ scope: { kind: 'patient', documentId: ids.document } });
  await denied(() =>
    permissions.require(principals.caregiver, ids.patient, 'view'),
  );
});

test('patient/category/document grants cover only matching resource contexts for every action', async () => {
  for (const action of actions) {
    for (const scope of [patientScope, categoryScope, documentScope]) {
      const store = new MemoryAccess();
      store.grant({ actions: [action], scope });
      const permissions = new PermissionService(store);
      assert.equal(
        (
          await permissions.require(
            principals.caregiver,
            ids.patient,
            action,
            documentScope,
          )
        ).patientId,
        ids.patient,
      );
      if (scope.kind === 'patient') {
        await permissions.require(
          principals.caregiver,
          ids.patient,
          action,
          patientScope,
        );
        await permissions.require(
          principals.caregiver,
          ids.patient,
          action,
          categoryScope,
        );
      } else {
        await denied(() =>
          permissions.require(
            principals.caregiver,
            ids.patient,
            action,
            patientScope,
          ),
        );
        if (scope.kind === 'category')
          await permissions.require(
            principals.caregiver,
            ids.patient,
            action,
            categoryScope,
          );
        else
          await denied(() =>
            permissions.require(
              principals.caregiver,
              ids.patient,
              action,
              categoryScope,
            ),
          );
      }
      const sameCategory = () =>
        permissions.require(principals.caregiver, ids.patient, action, {
          kind: 'document',
          documentId: ids.sameCategoryDocument,
        });
      if (scope.kind === 'document') await denied(sameCategory);
      else await sameCategory();
      const otherCategory = () =>
        permissions.require(principals.caregiver, ids.patient, action, {
          kind: 'document',
          documentId: ids.otherCategoryDocument,
        });
      if (scope.kind === 'patient') await otherCategory();
      else await denied(otherCategory);
      await denied(() =>
        permissions.require(principals.caregiver, ids.otherPatient, action, {
          kind: 'document',
          documentId: ids.otherPatientDocument,
        }),
      );
    }
  }
});

test('a grant action and scope must match together; unrelated grants cannot be spliced into authorization', async () => {
  const store = new MemoryAccess();
  store.grant({ actions: ['view'], scope: categoryScope });
  store.grant({
    actions: ['export'],
    scope: { kind: 'document', documentId: ids.otherCategoryDocument },
  });
  store.grant({ patientId: ids.otherPatient, actions: ['edit'] });
  store.grant({ granteeAccountId: ids.stranger, actions: ['manage'] });
  const permissions = new PermissionService(store);
  await denied(() =>
    permissions.require(
      principals.caregiver,
      ids.patient,
      'export',
      documentScope,
    ),
  );
  await denied(() =>
    permissions.require(principals.caregiver, ids.patient, 'view', {
      kind: 'document',
      documentId: ids.otherCategoryDocument,
    }),
  );
  await denied(() =>
    permissions.require(principals.caregiver, ids.patient, 'edit'),
  );
  await denied(() =>
    permissions.require(principals.caregiver, ids.patient, 'manage'),
  );
});

test('expiry uses authoritative snapshot time and equality expires; revoked grants never authorize', async () => {
  for (const overrides of [
    { expiresAt: new Date('2029-12-31T23:59:59.999Z') },
    { expiresAt: new Date('2030-01-01T00:00:00.000Z') },
    { revokedAt: new Date('2029-12-31T23:59:59.999Z') },
  ]) {
    const store = new MemoryAccess();
    store.grant({ actions, ...overrides });
    const permissions = new PermissionService(store);
    for (const action of actions)
      await denied(() =>
        permissions.require(principals.caregiver, ids.patient, action),
      );
  }
  const store = new MemoryAccess();
  store.grant({ expiresAt: new Date('2030-01-01T00:00:00.001Z') });
  await new PermissionService(store).require(
    principals.caregiver,
    ids.patient,
    'view',
  );
});

test('independent service instances consult current grant state after revocation and expiry', async () => {
  const store = new MemoryAccess();
  const grant = store.grant({ actions });
  const services = [new PermissionService(store), new PermissionService(store)];
  await Promise.all(
    services.map((service) =>
      service.require(principals.caregiver, ids.patient, 'view'),
    ),
  );
  grant.revokedAt = new Date(store.now);
  await Promise.all(
    services.flatMap((service) =>
      actions.map((action) =>
        denied(() =>
          service.require(principals.caregiver, ids.patient, action),
        ),
      ),
    ),
  );
  grant.revokedAt = null;
  grant.expiresAt = new Date(store.now.getTime() + 1);
  await services[0].require(principals.caregiver, ids.patient, 'view');
  store.now = new Date(grant.expiresAt);
  await denied(() =>
    services[1].require(principals.caregiver, ids.patient, 'view'),
  );
});

test('unknown principals, foreign issuers and ambient administrator claims have no patient entitlement', async () => {
  const store = new MemoryAccess();
  const permissions = new PermissionService(store);
  for (const principal of [
    principals.unknown,
    principals.caregiver,
    { ...principals.owner, issuer: 'https://different-issuer.example.test' },
    {
      ...principals.caregiver,
      role: 'admin',
      patientId: ids.patient,
      accountId: ids.owner,
    },
  ])
    for (const action of actions)
      await denied(() => permissions.require(principal, ids.patient, action));
});

test('all authoritative-store failures fail closed with sanitized 503 responses', async () => {
  for (const operation of ['load', 'document', 'category']) {
    const store = new MemoryAccess();
    store.grant({ actions });
    store.fail = operation;
    const target =
      operation === 'document'
        ? documentScope
        : operation === 'category'
          ? categoryScope
          : patientScope;
    await assert.rejects(
      () =>
        new PermissionService(store).require(
          principals.caregiver,
          ids.patient,
          'view',
          target,
        ),
      status(503),
    );
  }
  const store = new MemoryAccess();
  store.fail = 'list';
  await assert.rejects(
    () => new PermissionService(store).patients(principals.owner),
    status(503),
  );
});

async function httpSetup(run) {
  const f = fixture();
  const access = new MemoryAccess();
  const events = [];
  const { app } = await createApplication({
    auth: f.auth,
    access,
    docs: false,
    log: (event) => events.push(event),
  });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const csrf = 'c'.repeat(43);
  const call = (
    session,
    path = '/api/patients',
    method = 'GET',
    body,
    extra = {},
  ) =>
    globalThis.fetch(`${base}${path}`, {
      method,
      headers: {
        Cookie: `fmv_csrf=${csrf}${session ? `; fmv_session=${session}` : ''}`,
        Origin: config.origin,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = async (subject = principals.caregiver.subject) => {
    f.provider.login = async (email) => f.provider.mint(email, subject);
    return f.auth.login('synthetic@example.test', 'synthetic');
  };
  try {
    await run({ ...f, access, events, call, login });
  } finally {
    await app.close();
  }
}

test('patient-list HTTP requires a current account session before reaching authorization storage', async () =>
  httpSetup(async ({ auth, provider, access, call, login }) => {
    for (const session of [undefined, 'a'.repeat(43)])
      assert.equal((await call(session)).status, 401);
    assert.equal(access.calls.length, 0);
    const flow = await auth.begin('recover', 'fixture@example.test');
    const sent = provider.sent.at(-1);
    provider.codes.set('access-recovery', {
      challenge: sent.challenge,
      email: 'fixture@example.test',
    });
    const recovery = await auth.callback(
      flow.id,
      'access-recovery',
      new URL(sent.redirect).searchParams.get('state'),
    );
    assert.equal((await call(recovery.id)).status, 403);
    assert.equal(access.calls.length, 0);
    const revoked = await login();
    await auth.logout(revoked);
    assert.equal((await call(revoked)).status, 401);
    assert.equal(access.calls.length, 0);
    const providerRevoked = await login();
    provider.tokens.clear();
    assert.equal((await call(providerRevoked)).status, 401);
    assert.equal(access.calls.length, 0);
  }));

test('patient-list HTTP binds authorization to session principal, reflects revocation, and never enumerates other patients', async () =>
  httpSetup(async ({ access, call, login }) => {
    const session = await login();
    const empty = await call(session);
    assert.equal(empty.status, 200);
    assert.equal(empty.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await empty.json(), { patients: [] });
    const grant = access.grant({ scope: documentScope });
    const listed = await call(
      session,
      `/api/patients?patientId=${ids.otherPatient}&accountId=${ids.owner}`,
      'GET',
      undefined,
      {
        'X-Patient-ID': ids.otherPatient,
        'X-Account-ID': ids.owner,
        'X-Role': 'admin',
      },
    );
    assert.equal(listed.status, 200);
    assert.deepEqual(await listed.json(), {
      patients: [
        {
          id: ids.patient,
          displayName: 'Private Patient A',
          relationship: 'caregiver',
          capabilities: [{ action: 'view', scope: documentScope }],
        },
      ],
    });
    assert.deepEqual(
      access.calls.filter(({ operation }) => operation === 'list').at(-1).args,
      [principals.caregiver],
    );
    grant.revokedAt = new Date(access.now);
    assert.deepEqual(await (await call(session)).json(), { patients: [] });
    grant.revokedAt = null;
    grant.expiresAt = new Date(access.now);
    assert.deepEqual(await (await call(session)).json(), { patients: [] });
  }));

test('patient-list failures and absent resource routes reveal no patient contents or sensitive log fields', async () =>
  httpSetup(async ({ access, events, call, login }) => {
    const session = await login(principals.owner.subject);
    const success = await call(session);
    assert.equal(success.status, 200);
    assert.equal((await success.json()).patients.length, 1);
    access.fail = 'list';
    const failed = await call(session);
    assert.equal(failed.status, 503);
    const payload = await failed.text();
    for (const privateValue of [
      'sensitive',
      'Private Patient',
      'owner-subject',
      ids.owner,
    ])
      assert.ok(!payload.includes(privateValue));
    access.fail = null;
    const missing = [];
    for (const patientId of [ids.otherPatient, ids.unknownPatient]) {
      const response = await call(session, `/api/patients/${patientId}`);
      assert.equal(response.status, 404);
      const body = await response.json();
      delete body.requestId;
      missing.push(body);
    }
    assert.deepEqual(missing[0], missing[1]);
    for (const path of ['/api/grants', `/api/patients/${ids.patient}/grants`])
      assert.equal(
        (
          await call(session, path, 'POST', {
            granteeAccountId: ids.caregiver,
            actions,
          })
        ).status,
        404,
      );
    const serialized = JSON.stringify(events);
    for (const privateValue of [
      'Private Patient',
      ids.patient,
      ids.otherPatient,
      ids.owner,
      principals.owner.subject,
      'synthetic@example.test',
      session,
      'sensitive',
    ])
      assert.ok(!serialized.includes(privateValue));
    for (const event of events)
      assert.deepEqual(Object.keys(event).sort(), [
        'durationMs',
        'event',
        'method',
        'requestId',
        'status',
      ]);
  }));
