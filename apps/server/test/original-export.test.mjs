import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  isOriginalExportSelection,
  isOriginalExportRequest,
  isOriginalExportPreview,
} from '@fmv/contracts';
import {
  originalArchive,
  OriginalExportService,
} from '../dist/documents/original-export.service.js';
import { documentSetup, ids } from './support/document-fixture.mjs';
const id = '11111111-1111-4111-8111-111111111111';
test('original selection rejects duplicates, implicit scope, excess files and missing explicit consent', () => {
  assert.equal(isOriginalExportSelection({ documentIds: [id] }), true);
  for (const v of [
    { documentIds: [] },
    { documentIds: [id, id.toUpperCase()] },
    { documentIds: ['bad'] },
    { documentIds: [id], all: true },
    { documentIds: Array.from({ length: 21 }, () => randomUUID()) },
  ])
    assert.equal(isOriginalExportSelection(v), false);
  const body = {
    documentIds: [id],
    requestId: id,
    confirmed: true,
    format: 'zip',
    snapshotSha256: 'a'.repeat(64),
  };
  assert.equal(isOriginalExportRequest(body), true);
  assert.equal(isOriginalExportRequest({ ...body, confirmed: false }), false);
  assert.equal(isOriginalExportRequest({ ...body, patientId: id }), false);
});
test('original ZIP preserves exact bytes and Unicode manifest while filenames cannot control archive paths', async () => {
  const bytes = Buffer.from('%PDF-1.7\nSYNTHETIC original\n%%EOF'),
    file = {
      id,
      title: '../বাংলা <script>.pdf',
      originalTitle: '../../private.pdf',
      mimeType: 'application/pdf',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  const preview = {
    patientId: id,
    patientName: 'SYNTHETIC patient',
    snapshotSha256: 'a'.repeat(64),
    files: [file],
  };
  assert.equal(isOriginalExportPreview(preview), true);
  assert.equal(
    isOriginalExportPreview({
      ...preview,
      files: [
        { ...file, bytes: 25 * 1024 * 1024 },
        { ...file, id: randomUUID(), bytes: 25 * 1024 * 1024 },
      ],
    }),
    false,
  );
  assert.equal(
    isOriginalExportPreview({
      ...preview,
      files: [{ ...file, objectKey: 'forbidden-internal-key' }],
    }),
    false,
  );
  const archive = await originalArchive(
      { preview, rows: [] },
      [bytes],
      new globalThis.AbortController().signal,
    ),
    dir = await mkdtemp(join(tmpdir(), 'fmv-original-synthetic-'));
  try {
    const path = join(dir, 'originals.zip');
    await writeFile(path, archive, { mode: 0o600 });
    execFileSync('/usr/bin/unzip', ['-t', path]);
    const names = execFileSync('/usr/bin/unzip', ['-Z1', path], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n');
    assert.deepEqual(names, [
      `documents/${id}/original.pdf`,
      'manifest.json',
      'README.txt',
    ]);
    assert.deepEqual(
      execFileSync('/usr/bin/unzip', ['-p', path, names[0]]),
      bytes,
    );
    const manifest = JSON.parse(
      execFileSync('/usr/bin/unzip', ['-p', path, 'manifest.json'], {
        encoding: 'utf8',
      }),
    );
    assert.equal(manifest.files[0].title, file.title);
    assert.ok(!JSON.stringify(manifest).includes('objectKey'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('original-export endpoints require session and CSRF, preserve exact selection and private headers', async () =>
  documentSetup(async (f) => {
    const service = f.app.get(OriginalExportService),
      path = f.path('exports/originals'),
      calls = [];
    service.prepare = async (...args) => {
      calls.push(args);
      return { synthetic: true };
    };
    service.export = async (...args) => {
      calls.push(args);
      return { bytes: Buffer.from('PK synthetic') };
    };
    assert.equal((await f.request('POST', path, undefined, {})).status, 401);
    const session = await f.login();
    assert.equal(
      (
        await f.request(
          'POST',
          path + '/prepare',
          session,
          {},
          { 'X-CSRF-Token': undefined },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          'POST',
          path,
          session,
          {},
          { Origin: 'https://unapproved.example.test' },
        )
      ).status,
      403,
    );
    assert.equal(calls.length, 0);
    assert.equal(
      (
        await f.request('POST', path + '/prepare', session, {
          documentIds: [id],
        })
      ).status,
      200,
    );
    assert.equal(calls[0][1], ids.patient);
    assert.deepEqual(calls[0][2], { documentIds: [id] });
    const response = await f.request('POST', path, session, {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(
      response.headers
        .get('content-disposition')
        .includes('family-medical-vault-originals.zip'),
    );
  }));
