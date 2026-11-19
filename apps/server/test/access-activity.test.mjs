import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  isAccessActivity,
  isActivityCursor,
  isSecurityChanges,
} from '@fmv/contracts';
import {
  AccessActivityService,
  decodeActivityCursor,
} from '../dist/activity/access-activity.service.js';
import { documentSetup } from './support/document-fixture.mjs';
test('activity contracts reject malformed identities, attribution, content and oversized pages', () => {
  const patientId = randomUUID(),
    event = {
      id: randomUUID(),
      source: 'document',
      kind: 'document.viewed',
      actor: 'you',
      recordedAt: new Date().toISOString(),
      documentId: randomUUID(),
      documentLabel: 'SYNTHETIC document',
    },
    page = { patientId, events: [event], nextCursor: null };
  assert.ok(isAccessActivity(page));
  assert.ok(
    isAccessActivity({
      ...page,
      events: [{ ...event, documentLabel: '😀'.repeat(200) }],
    }),
  );
  for (const patch of [
    { actor: 'anonymous-link-holder' },
    { source: 'shared-link' },
    { kind: 'diagnosis.confirmed' },
    { text: 'private' },
    { documentId: null },
    { recordedAt: 'yesterday' },
    { recordedAt: '2026-02-30T00:00:00.000Z' },
    { documentLabel: 'x'.repeat(201) },
  ])
    assert.equal(
      isAccessActivity({ ...page, events: [{ ...event, ...patch }] }),
      false,
    );
  assert.equal(isAccessActivity({ ...page, events: [event, event] }), false);
  assert.equal(isAccessActivity({ ...page, nextCursor: 'opaque' }), false);
  assert.equal(isActivityCursor('x'.repeat(241)), false);
  const c = {
      patientId,
      at: event.recordedAt,
      source: event.source,
      id: event.id,
    },
    encoded = Buffer.from(JSON.stringify(c)).toString('base64url');
  assert.deepEqual(decodeActivityCursor(encoded, patientId), c);
  assert.equal(decodeActivityCursor(undefined, patientId), null);
  for (const value of [
    '',
    [],
    encoded + '=',
    Buffer.from(JSON.stringify({ ...c, patientId: randomUUID() })).toString(
      'base64url',
    ),
    Buffer.from(
      JSON.stringify({ ...c, at: '2026-02-30T00:00:00.000Z' }),
    ).toString('base64url'),
  ])
    assert.throws(
      () => decodeActivityCursor(value, patientId),
      (e) => e.getStatus() === 400,
    );
});
test('activity route requires verified session and rejects unsupported query shapes', async () =>
  documentSetup(async (f) => {
    const service = f.app.get(AccessActivityService),
      calls = [];
    service.read = async (...args) => {
      calls.push(args);
      return { synthetic: true };
    };
    const path = f.path('access-activity');
    assert.equal((await f.request('GET', path)).status, 401);
    const session = await f.login();
    assert.equal((await f.request('GET', path, session)).status, 200);
    assert.equal(
      (await f.request('GET', path + '?cursor=opaque', session)).status,
      200,
    );
    assert.equal(
      (await f.request('GET', path + '?medicalFilter=anything', session))
        .status,
      400,
    );
    assert.equal(calls.length, 2);
    assert.equal((await f.request('POST', path, session, {})).status, 404);
  }));
test('activity unavailable database fails closed without exposing diagnostic text', async () => {
  const service = new AccessActivityService(null);
  await assert.rejects(
    service.read({ issuer: 'synthetic', subject: 'synthetic' }, randomUUID()),
    (e) => e.getStatus() === 503,
  );
  await assert.rejects(
    service.read({ issuer: 'synthetic', subject: 'synthetic' }, 'bad'),
    (e) => e.getStatus() === 404,
  );
});

test('security change contracts and cursors stay separate from ordinary access', () => {
  const patientId = randomUUID(),
    event = {
      id: randomUUID(),
      source: 'grant',
      kind: 'grant.created',
      actor: 'you',
      recordedAt: new Date().toISOString(),
      resourceLabel: 'Whole-patient access',
    },
    page = { patientId, events: [event], nextCursor: null };
  assert.ok(isSecurityChanges(page));
  assert.equal(isAccessActivity(page), false);
  for (const patch of [
    { kind: 'document.viewed' },
    { source: 'link-created' },
    { actor: 'anonymous-link-holder' },
    { resourceLabel: 'x'.repeat(241) },
    { secret: 'no' },
  ])
    assert.equal(
      isSecurityChanges({ ...page, events: [{ ...event, ...patch }] }),
      false,
    );
  const cursor = Buffer.from(
    JSON.stringify({
      patientId,
      at: event.recordedAt,
      source: event.source,
      id: event.id,
    }),
  ).toString('base64url');
  assert.throws(
    () => decodeActivityCursor(cursor, patientId),
    (e) => e.getStatus() === 400,
  );
  assert.equal(
    decodeActivityCursor(cursor, patientId, [
      'grant',
      'link-created',
      'link-revoked',
    ]).source,
    'grant',
  );
});
test('security change route uses the existing verified-session boundary and strict query', async () =>
  documentSetup(async (f) => {
    const service = f.app.get(AccessActivityService);
    let count = 0;
    service.readChanges = async () => {
      count++;
      return { synthetic: true };
    };
    const path = f.path('security-changes');
    assert.equal((await f.request('GET', path)).status, 401);
    const session = await f.login();
    assert.equal((await f.request('GET', path, session)).status, 200);
    assert.equal(
      (await f.request('GET', path + '?kind=anything', session)).status,
      400,
    );
    assert.equal(count, 1);
  }));
