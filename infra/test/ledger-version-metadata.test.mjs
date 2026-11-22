import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectLedgerVersionMetadata } from '../backup/ledger-version-metadata.mjs';
const prefix = 'fmv-restore-evidence/v1/development/';
const scope = {
  accountId: 'fixture-account',
  bucketId: 'fixture-bucket',
  prefix,
};
const file = (id, action = 'upload') => ({
  accountId: scope.accountId,
  bucketId: scope.bucketId,
  fileId: 'fixture-' + id,
  fileName: prefix + 'opaque.age',
  action,
  contentLength: action === 'upload' ? 100 : 0,
  uploadTimestamp: 1000,
});
const end = (files) => ({ files, nextFileName: null, nextFileId: null });
const rejects = (work) =>
  assert.rejects(
    work,
    /^Error: Ledger version metadata scan failed; history completeness is unverified$/,
  );
test('all versions are counted across pages, including hidden and unfinished versions', async () => {
  const calls = [];
  const pages = [
    {
      files: [file(1, 'hide')],
      nextFileName: prefix + 'opaque.age',
      nextFileId: 'fixture-2',
    },
    end([{ ...file(2), uploadTimestamp: '1000' }, file(3, 'start')]),
  ];
  const result = await inspectLedgerVersionMetadata(async (cursor) => {
    calls.push(cursor);
    return pages[calls.length - 1];
  }, scope);
  assert.deepEqual(result, {
    versionPaginationExhausted: true,
    pagesRead: 2,
    versionMetadataCount: 3,
    uploadedVersions: 1,
    hideMarkers: 1,
    unfinishedVersions: 1,
  });
  assert.deepEqual(calls[1], {
    startFileName: prefix + 'opaque.age',
    startFileId: 'fixture-2',
  });
  assert.ok(!JSON.stringify(result).includes('opaque'));
  assert.equal(
    (await inspectLedgerVersionMetadata(async () => end([]), scope))
      .versionMetadataCount,
    0,
  );
});
test('cross-bucket/prefix, malformed versions and unknown action fail closed', async () => {
  for (const change of [
    (f) => {
      f.bucketId = 'other';
    },
    (f) => {
      f.accountId = 'other';
    },
    (f) => {
      f.fileName = 'other/private';
    },
    (f) => {
      f.action = 'unknown';
    },
    (f) => {
      f.uploadTimestamp = 'invalid';
    },
    (f) => {
      f.contentLength = -1;
    },
    (f) => {
      f.fileId = null;
    },
  ]) {
    const value = file(1);
    change(value);
    await rejects(
      inspectLedgerVersionMetadata(async () => end([value]), scope),
    );
  }
  await rejects(
    inspectLedgerVersionMetadata(
      async () =>
        end([file(1, 'hide'), { ...file(2, 'hide'), contentLength: 1 }]),
      scope,
    ),
  );
});
test('duplicate versions, missing cursor fields, no progress and cursor cycles never return completeness', async () => {
  await rejects(
    inspectLedgerVersionMetadata(async () => end([file(1), file(1)]), scope),
  );
  await rejects(
    inspectLedgerVersionMetadata(async () => ({ files: [] }), scope),
  );
  await rejects(
    inspectLedgerVersionMetadata(
      async () => ({
        files: [],
        nextFileName: prefix + 'next',
        nextFileId: 'next',
      }),
      scope,
    ),
  );
  let n = 0;
  await rejects(
    inspectLedgerVersionMetadata(
      async () => ({
        files: [file(++n)],
        nextFileName: prefix + 'same',
        nextFileId: 'same',
      }),
      scope,
    ),
  );
});
test('page bounds, cancellation and provider failures prevent partial-success flags', async () => {
  let n = 0;
  await rejects(
    inspectLedgerVersionMetadata(
      async () => ({
        files: [file(++n)],
        nextFileName: prefix + 'next-' + n,
        nextFileId: 'next-' + n,
      }),
      scope,
    ),
  );
  assert.equal(n, 100);
  await rejects(
    inspectLedgerVersionMetadata(
      async () => end(Array.from({ length: 101 }, (_, i) => file(i))),
      scope,
    ),
  );
  const controller = new globalThis.AbortController();
  controller.abort();
  let calls = 0;
  await rejects(
    inspectLedgerVersionMetadata(
      async () => {
        calls++;
        return end([]);
      },
      { ...scope, signal: controller.signal },
    ),
  );
  assert.equal(calls, 0);
  await rejects(
    inspectLedgerVersionMetadata(async () => {
      throw Error('private provider detail');
    }, scope),
  );
});

test('missing or invalid scan scope fails without exposing raw provider context', async () => {
  for (const scope of [
    undefined,
    null,
    {},
    {
      accountId: 'fixture-account',
      bucketId: 'fixture-bucket',
      prefix: 'other/',
    },
  ])
    await rejects(inspectLedgerVersionMetadata(async () => end([]), scope));
});
