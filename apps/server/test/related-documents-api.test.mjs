import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { documentSetup, principals, pdf } from './support/document-fixture.mjs';

test('related route enforces View for both originals and rechecks authority', async () =>
  documentSetup(async (f) => {
    const owner = await f.login();
    const start = await f.request('POST', f.path('uploads'), owner, f.input());
    const upload = await start.json();
    await f.request(
      'PUT',
      f.path(`uploads/${upload.uploadId}/content`),
      owner,
      pdf,
    );
    await f.request(
      'POST',
      f.path(`uploads/${upload.uploadId}/finalize`),
      owner,
      {},
    );
    const record = [...f.metadata.rows.values()].find(
      (r) => r.documentId === upload.documentId,
    );
    const source = { ...record, deletedAt: null };
    const candidate = { ...source, documentId: randomUUID() };
    const path = f.path(`documents/${upload.documentId}/related-documents`);
    const result = {
      source: {
        documentId: source.documentId,
        sourceSha256: source.sha256,
        sourceRevision: 0,
        metadataRevision: 0,
        lifecycleVersion: 0,
      },
      status: 'insufficient-hints',
      matches: [],
      limited: false,
    };
    let revoke;
    f.metadata.readRelatedDocuments = async (_p, _d, _scopes, authorize) => {
      await authorize([source, candidate]);
      if (revoke) revoke();
      await authorize([source, candidate]);
      return result;
    };
    assert.equal((await f.request('GET', path)).status, 401);
    const read = await f.request('GET', path, owner);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await read.json(), result);
    const reader = await f.login(principals.caregiver.subject);
    const grant = f.access.grant({
      actions: ['view'],
      scope: { kind: 'document', documentId: source.documentId },
    });
    assert.equal((await f.request('GET', path, reader)).status, 404);
    grant.scope = { kind: 'patient' };
    grant.actions = ['edit', 'export'];
    assert.equal((await f.request('GET', path, reader)).status, 404);
    grant.actions = ['view'];
    assert.equal((await f.request('GET', path, reader)).status, 200);
    revoke = () => {
      grant.revokedAt = f.access.now;
    };
    assert.equal((await f.request('GET', path, reader)).status, 404);
    f.metadata.readRelatedDocuments = async () => {
      throw new Error('private');
    };
    assert.equal((await f.request('GET', path, owner)).status, 503);
  }));
