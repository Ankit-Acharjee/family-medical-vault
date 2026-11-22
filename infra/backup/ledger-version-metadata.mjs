const fail = () =>
  new Error(
    'Ledger version metadata scan failed; history completeness is unverified',
  );
const object = (value) =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 512 &&
  !/[^\x21-\x7e]/.test(value);
const timestamp = (value) =>
  (typeof value === 'number' ||
    (typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value))) &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) >= 0;

/** Metadata only. Never select an authoritative ledger head from upload order.
 * Cursor exhaustion is not an atomic snapshot or proof no version was deleted.
 * Concurrent inserts can be missed; independent authenticated head/fences remain mandatory.
 */
export async function inspectLedgerVersionMetadata(readPage, scope = {}) {
  try {
    const { accountId, bucketId, prefix, signal } = scope;
    if (
      typeof readPage !== 'function' ||
      !identifier(accountId) ||
      !identifier(bucketId) ||
      prefix !== 'fmv-restore-evidence/v1/development/'
    )
      throw fail();
    const ids = new Set(),
      cursors = new Set();
    let cursor = {},
      uploadedVersions = 0,
      hideMarkers = 0,
      unfinishedVersions = 0;
    const name = (value) =>
      typeof value === 'string' &&
      value.length > prefix.length &&
      value.length <= 1024 &&
      value.startsWith(prefix);
    for (let pageNumber = 1; pageNumber <= 100; pageNumber++) {
      if (signal?.aborted) throw fail();
      const page = await readPage(Object.freeze({ ...cursor }));
      if (
        !object(page) ||
        !Array.isArray(page.files) ||
        page.files.length > 100
      )
        throw fail();
      for (const file of page.files) {
        if (
          !object(file) ||
          file.accountId !== accountId ||
          file.bucketId !== bucketId ||
          !name(file.fileName) ||
          !identifier(file.fileId) ||
          ids.has(file.fileId) ||
          !['upload', 'hide', 'start'].includes(file.action) ||
          !timestamp(file.uploadTimestamp) ||
          !Number.isSafeInteger(file.contentLength) ||
          file.contentLength < 0 ||
          (file.action !== 'upload' && file.contentLength !== 0)
        )
          throw fail();
        ids.add(file.fileId);
        if (ids.size > 10000) throw fail();
        if (file.action === 'upload') uploadedVersions++;
        else if (file.action === 'hide') hideMarkers++;
        else unfinishedVersions++;
      }
      if (signal?.aborted) throw fail();
      if (page.nextFileName === null && page.nextFileId === null)
        return {
          versionPaginationExhausted: true,
          pagesRead: pageNumber,
          versionMetadataCount: ids.size,
          uploadedVersions,
          hideMarkers,
          unfinishedVersions,
        };
      if (
        !page.files.length ||
        !name(page.nextFileName) ||
        !identifier(page.nextFileId)
      )
        throw fail();
      const key = JSON.stringify([page.nextFileName, page.nextFileId]);
      if (cursors.has(key)) throw fail();
      cursors.add(key);
      cursor = {
        startFileName: page.nextFileName,
        startFileId: page.nextFileId,
      };
    }
    throw fail();
  } catch {
    throw fail();
  }
}
