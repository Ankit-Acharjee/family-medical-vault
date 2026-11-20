import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
const failure = () =>
  new Error('Original capture failed; incomplete sets must not be published');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Caller supplies rows from the SAME exported snapshot as the database dump.
 * No cloud credentials, filesystem paths, publication or deletion authority here.
 * Writer receipts and independent recovery verification remain caller duties.
 */
export async function captureOriginals(
  rows,
  { read, write, maxObjectBytes, maxTotalBytes, signal } = {},
) {
  try {
    if (
      !Array.isArray(rows) ||
      rows.length > 10000 ||
      typeof read !== 'function' ||
      typeof write !== 'function' ||
      !Number.isSafeInteger(maxObjectBytes) ||
      maxObjectBytes < 1 ||
      !Number.isSafeInteger(maxTotalBytes) ||
      maxTotalBytes < 0
    )
      throw failure();
    if (signal?.aborted) throw failure();
    const documents = new Set(),
      keys = new Set();
    let total = 0;
    const inventory = Array.from(rows, (row) => {
      if (
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        Object.keys(row).sort().join(',') !==
          'bytes,documentId,objectKey,sha256' ||
        typeof row.documentId !== 'string' ||
        !uuid.test(row.documentId) ||
        documents.has(row.documentId) ||
        typeof row.objectKey !== 'string' ||
        row.objectKey.length > 256 ||
        !/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(row.objectKey) ||
        keys.has(row.objectKey) ||
        typeof row.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(row.sha256) ||
        !Number.isSafeInteger(row.bytes) ||
        row.bytes < 1 ||
        row.bytes > maxObjectBytes
      )
        throw failure();
      total += row.bytes;
      if (!Number.isSafeInteger(total) || total > maxTotalBytes)
        throw failure();
      documents.add(row.documentId);
      keys.add(row.objectKey);
      return Object.freeze({
        documentId: row.documentId,
        objectKey: row.objectKey,
        bytes: row.bytes,
        sha256: row.sha256,
      });
    });
    for (const row of inventory) {
      if (signal?.aborted) throw failure();
      const original = await read(row.objectKey, signal);
      if (!Buffer.isBuffer(original) || original.length !== row.bytes)
        throw failure();
      const bytes = Buffer.from(original);
      if (
        createHash('sha256').update(bytes).digest('hex') !== row.sha256 ||
        signal?.aborted
      )
        throw failure();
      await write(row, bytes, signal);
      if (signal?.aborted) throw failure();
    }
    return { capturedObjects: inventory.length, capturedBytes: total };
  } catch {
    throw failure();
  }
}
