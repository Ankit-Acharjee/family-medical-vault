import assert from 'node:assert/strict';
import process from 'node:process';
import { test } from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import { createApplication } from '../dist/application.js';
import {
  OBJECT_STORE,
  UnavailableObjectStore,
} from '../dist/documents/object-store.js';
import { R2ObjectStore } from '../dist/documents/r2-object-store.js';
import { fixture } from './support/auth-fixture.mjs';

async function environment(values, work) {
  const names = [
    'R2_ENABLED',
    'R2_ACCOUNT_ID',
    'R2_BUCKET',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_ENDPOINT',
    'R2_PUBLIC_URL',
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    Object.assign(process.env, values);
    return await work();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
test('storage stays unavailable when disabled and never creates an SDK request', async (t) => {
  t.mock.method(S3Client.prototype, 'send', () =>
    assert.fail('No startup provider calls'),
  );
  await environment({ R2_ENABLED: 'false' }, async () => {
    const f = fixture();
    const { app } = await createApplication({
      auth: f.auth,
      log: () => {},
      docs: false,
    });
    try {
      assert.ok(app.get(OBJECT_STORE) instanceof UnavailableObjectStore);
      assert.equal(app.get(OBJECT_STORE).ready, false);
    } finally {
      await app.close();
    }
  });
});
test('configured adapter is wired without network and shuts down through Nest lifecycle', async (t) => {
  t.mock.method(S3Client.prototype, 'send', () =>
    assert.fail('No startup provider calls'),
  );
  await environment(
    {
      R2_ENABLED: 'true',
      R2_ACCOUNT_ID: 'a'.repeat(32),
      R2_BUCKET: 'fixture-private-development',
      R2_ACCESS_KEY_ID: 'synthetic-access',
      R2_SECRET_ACCESS_KEY: 'synthetic-secret',
    },
    async () => {
      const f = fixture();
      const { app, document } = await createApplication({
        auth: f.auth,
        log: () => {},
        docs: false,
      });
      const store = app.get(OBJECT_STORE);
      try {
        assert.ok(store instanceof R2ObjectStore);
        assert.equal(store.ready, true);
        assert.ok(
          !Object.keys(document.paths).some(
            (path) => path.includes('presign') || path.includes('r2'),
          ),
        );
      } finally {
        await app.close();
      }
      assert.equal(store.ready, false);
    },
  );
});
test('enabled incomplete storage fails startup with a sanitized configuration error', async () => {
  await environment(
    { R2_ENABLED: 'true', R2_SECRET_ACCESS_KEY: 'synthetic-private-secret' },
    async () => {
      const f = fixture();
      try {
        await assert.rejects(
          createApplication({ auth: f.auth, log: () => {}, docs: false }),
          (error) =>
            error.message ===
            'Object storage configuration is invalid; check the server-only R2 settings.',
        );
      } finally {
        await f.auth.onModuleDestroy();
      }
    },
  );
});
