import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  BadRequestException,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { IsString } from 'class-validator';
import { createApplication } from '../dist/application.js';
import { HttpErrorFilter } from '../dist/common/http-error.filter.js';

const events = [];
let app;
let base;
before(async () => {
  ({ app } = await createApplication({
    docs: true,
    log: (event) => events.push(event),
  }));
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
after(async () => app?.close());

const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;

test('health reports process liveness and generates a fresh request ID', async () => {
  const first = await globalThis.fetch(`${base}/health`, {
    headers: { 'X-Request-ID': 'untrusted-input' },
  });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { status: 'ok' });
  assert.match(first.headers.get('x-request-id'), uuid);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal(first.headers.get('x-powered-by'), null);
  const second = await globalThis.fetch(`${base}/health`);
  assert.notEqual(
    first.headers.get('x-request-id'),
    second.headers.get('x-request-id'),
  );
  await second.arrayBuffer();
});

test('OpenAPI documents health without inventing patient routes', async () => {
  const response = await globalThis.fetch(`${base}/api/openapi.json`);
  assert.equal(response.status, 200);
  const document = await response.json();
  assert.ok(document.paths['/health']);
  assert.ok(document.paths['/api/auth/account']);
  assert.ok(
    Object.keys(document.paths).every(
      (path) => path === '/health' || path.startsWith('/api/auth/'),
    ),
  );
  assert.ok(document.paths['/health'].get.responses['200']);
  const ui = await globalThis.fetch(`${base}/api/docs`);
  assert.equal(ui.status, 200);
  await ui.text();
});

test('unknown routes and sensitive input are absent from errors and logs', async () => {
  const sentinel = 'synthetic-private-marker';
  const response = await globalThis.fetch(
    `${base}/${sentinel}?token=${sentinel}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sentinel}`,
      },
      body: JSON.stringify({ secret: sentinel }),
    },
  );
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.deepEqual(body.error, {
    code: 'NOT_FOUND',
    message: 'The requested resource is unavailable.',
  });
  assert.equal(body.requestId, response.headers.get('x-request-id'));
  assert.equal(JSON.stringify(body).includes(sentinel), false);
  assert.equal(JSON.stringify(events).includes(sentinel), false);
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), [
      'durationMs',
      'event',
      'method',
      'requestId',
      'status',
    ]);
  }
});

test('malformed JSON receives a sanitized bad-request envelope and health remains available', async () => {
  const response = await globalThis.fetch(`${base}/health`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{invalid-json',
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, 'BAD_REQUEST');
  assert.match(body.requestId, uuid);
  assert.equal(JSON.stringify(body).includes('invalid-json'), false);
  const retry = await globalThis.fetch(`${base}/health`);
  assert.equal(retry.status, 200);
  await retry.arrayBuffer();
});

test('exception filter suppresses exception details for denied and failed operations', () => {
  for (const [exception, expectedStatus, expectedCode] of [
    [new ForbiddenException('synthetic-secret'), 403, 'FORBIDDEN'],
    [new Error('synthetic-secret'), 500, 'INTERNAL_ERROR'],
    [
      new BadRequestException({ message: ['synthetic-secret'] }),
      400,
      'BAD_REQUEST',
    ],
  ]) {
    let status;
    let body;
    const response = {
      status(value) {
        status = value;
        return this;
      },
      json(value) {
        body = value;
      },
    };
    new HttpErrorFilter().catch(exception, {
      switchToHttp: () => ({
        getRequest: () => ({ requestId: 'test-id' }),
        getResponse: () => response,
      }),
    });
    assert.equal(status, expectedStatus);
    assert.equal(body.error.code, expectedCode);
    assert.equal(JSON.stringify(body).includes('synthetic-secret'), false);
  }
});

test('validation rejects unknown fields and conceals submitted values', async () => {
  class Input {
    name;
  }
  IsString()(Input.prototype, 'name');
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    validationError: { target: false, value: false },
  });
  const metadata = { type: 'body', metatype: Input };
  assert.equal(
    (await pipe.transform({ name: 'example' }, metadata)).name,
    'example',
  );
  await assert.rejects(
    pipe.transform({ name: 123, secret: 'synthetic-secret' }, metadata),
    BadRequestException,
  );
});

test('documentation endpoints are unavailable when disabled', async () => {
  const { app: isolated } = await createApplication({
    docs: false,
    log: () => {},
  });
  try {
    await isolated.listen(0, '127.0.0.1');
    const response = await globalThis.fetch(
      `${await isolated.getUrl()}/api/openapi.json`,
    );
    assert.equal(response.status, 404);
    await response.arrayBuffer();
  } finally {
    await isolated.close();
  }
});
