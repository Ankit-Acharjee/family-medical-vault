// Explicitly gated synthetic provider check. Never reads or deletes app records.
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, open, appendFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import { storageConfig } from '../dist/documents/storage.config.js';
import { R2ObjectStore } from '../dist/documents/r2-object-store.js';

let store;
async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
try {
  const config = storageConfig({ ...process.env, R2_ENABLED: 'true' });
  if (!config) throw new Error();
  const target = createHash('sha256')
    .update(JSON.stringify([config.accountId, config.bucket]))
    .digest('hex');
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--show-target') {
    console.log(`Development R2 target fingerprint: ${target}`);
  } else {
    if (
      args.length !== 2 ||
      !args.includes('--confirm-private-development-write') ||
      !args.includes(`--expect-target=${target}`)
    )
      throw new Error();
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    let directory = root;
    for (const part of ['.local', 'r2-probes']) {
      const parent = directory;
      directory = path.join(directory, part);
      let created = true;
      await mkdir(directory, { mode: 0o700 }).catch((error) => {
        if (error.code !== 'EEXIST') throw error;
        created = false;
      });
      const stat = await lstat(directory);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())
      )
        throw new Error();
      if (created) await syncDirectory(parent);
    }
    const objectKey = randomUUID().replaceAll('-', '');
    const journal = path.join(directory, `${randomUUID()}.json`);
    const entry = {
      version: 1,
      target,
      objectKey,
      createdAt: new Date().toISOString(),
      putAttempted: false,
      roundtripVerified: false,
      cleanupAcknowledged: false,
      uncertain: false,
    };
    // Reserve an exact-key recovery record before any provider write. Keep it
    // even after cleanup: a timed-out remote PUT can complete later.
    const reservation = await open(journal, 'wx', 0o600);
    try {
      await reservation.writeFile(
        JSON.stringify({
          version: entry.version,
          target,
          objectKey,
          createdAt: entry.createdAt,
        }),
      );
      await reservation.sync();
    } finally {
      await reservation.close();
    }
    await syncDirectory(directory);
    // Status updates never truncate the immutable exact-key reservation.
    const save = () =>
      appendFile(
        `${journal}.status`,
        JSON.stringify({
          at: new Date().toISOString(),
          putAttempted: entry.putAttempted,
          roundtripVerified: entry.roundtripVerified,
          cleanupAcknowledged: entry.cleanupAcknowledged,
          uncertain: entry.uncertain,
        }) + '\n',
        { mode: 0o600 },
      );
    store = new R2ObjectStore(config);
    const original = Buffer.from(
      '%PDF-1.7\n% FMV synthetic storage probe; not a medical record.\n%%EOF\n',
    );
    try {
      entry.putAttempted = true;
      await save();
      await store.put(objectKey, original, 'application/pdf');
      const returned = await store.get(objectKey);
      if (!original.equals(returned)) throw new Error();
      entry.roundtripVerified = true;
    } catch {
      entry.uncertain = true;
    } finally {
      if (entry.putAttempted) {
        try {
          await store.remove(objectKey);
          entry.cleanupAcknowledged = true;
        } catch {
          entry.uncertain = true;
        }
      }
      await save();
    }
    if (
      !entry.roundtripVerified ||
      !entry.cleanupAcknowledged ||
      entry.uncertain
    )
      throw new Error();
    console.log(
      'Synthetic R2 roundtrip verified; exact-key cleanup acknowledged. Private recovery journal retained.',
    );
  }
} catch {
  console.error(
    'R2 verification did not complete. Check configuration, explicit target approval and any private probe journal; no credentials are printed.',
  );
  process.exitCode = 1;
} finally {
  store?.destroy();
}
