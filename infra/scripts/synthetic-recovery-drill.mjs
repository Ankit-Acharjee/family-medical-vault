// Invoked only inside test-db-native's disposable cluster. No cloud or .env input.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { captureOriginals } from '../backup/capture-originals.mjs';
import { verifySyntheticLinkPublication } from './synthetic-link-publication.mjs';
import {
  encodeBackupCompletion,
  verifySignedBackupCompletion,
} from '../backup/completion-manifest.mjs';
import { backupSignatureNamespace } from '../backup/verify-signature.mjs';
import console from 'node:console';
import { withTool } from '../ci/tools.mjs';
import {
  prepareSyntheticEvidenceFixture,
  verifySyntheticEvidenceReconciliation,
} from './synthetic-evidence-reconciliation.mjs';
const { Client } = createRequire(
  new URL('../../apps/server/package.json', import.meta.url),
)('pg');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function verifySyntheticRecovery({
  bin,
  temporary,
  port,
  ownerPassword,
  appPassword,
}) {
  assert.ok(Number.isInteger(port) && port >= 1024 && port < 65536);
  assert.match(path.basename(temporary), /^fmv-db-verification-/);
  const passfile = path.join(temporary, 'recovery.pgpass');
  await writeFile(
    passfile,
    `127.0.0.1:${port}:*:fmv_owner:${ownerPassword}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  const command = (binary, args, extra = {}) => {
    const r = spawnSync(binary, args, {
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', TMPDIR: temporary, PGPASSFILE: passfile },
      ...extra,
    });
    assert.ok(
      !r.error && r.status === 0,
      'Synthetic recovery command must succeed (output suppressed)',
    );
    return r.stdout.trim();
  };
  const client = (database, user = 'fmv_owner', password = ownerPassword) =>
    new Client({
      host: '127.0.0.1',
      port,
      database,
      user,
      password,
      connectionTimeoutMillis: 5000,
    });
  const source = client('fmv_dev');
  let restored, runtime;
  try {
    await source.connect();
    const linkPublication = await verifySyntheticLinkPublication({
      source,
      client,
      temporary,
    });
    const selectedBytes = Buffer.from(
      '%PDF-1.7\nSYNTHETIC activity fixture\n%%EOF',
    );
    const evidenceFixture = await prepareSyntheticEvidenceFixture(
      source,
      selectedBytes,
    );
    await source.query('CREATE SCHEMA synthetic_provider_excluded');
    await source.query(
      'CREATE TABLE synthetic_provider_excluded.must_not_restore(id integer)',
    );
    const inventory = async (db) => {
      const tables = (
        await db.query(
          "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fmv' AND c.relkind='r' ORDER BY relname",
        )
      ).rows;
      assert.ok(tables.length > 20);
      const result = [];
      for (const { relname } of tables) {
        assert.match(relname, /^[a-z_]+$/);
        const rows = (
          await db.query(
            `SELECT to_jsonb(t)::text AS data FROM fmv."${relname}" t ORDER BY to_jsonb(t)::text COLLATE "C"`,
          )
        ).rows;
        const acl = (
          await db.query(
            "SELECT c.relacl::text, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fmv' AND c.relname=$1",
            [relname],
          )
        ).rows[0];
        result.push({
          table: relname,
          count: rows.length,
          digest: hash(rows.map((r) => r.data).join('\n')),
          acl,
        });
      }
      return result;
    };
    await source.query(
      'CREATE TABLE fmv.recovery_snapshot_probe(id integer PRIMARY KEY)',
    );
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (
      await source.query('SELECT pg_export_snapshot() AS snapshot')
    ).rows[0].snapshot;
    assert.match(snapshot, /^[0-9A-F-]+$/);
    const laterWriter = client('fmv_dev');
    try {
      await laterWriter.connect();
      await laterWriter.query(
        'INSERT INTO fmv.recovery_snapshot_probe(id) VALUES(1)',
      );
    } finally {
      await laterWriter.end();
    }
    const selectedReference = (
      await source.query(
        `SELECT id AS "documentId",object_key AS "objectKey",bytes,sha256 FROM fmv.documents WHERE id=$1 AND state='ready' AND deleted_at IS NULL`,
        [evidenceFixture.documentId],
      )
    ).rows[0];
    assert.ok(
      selectedReference,
      'The synthetic activity original must exist in the snapshot',
    );
    const originalFile = path.join(temporary, 'synthetic-original.bin');
    const capture = await captureOriginals([selectedReference], {
      maxObjectBytes: selectedBytes.length,
      maxTotalBytes: selectedBytes.length,
      read: async (key) => {
        assert.equal(key, selectedReference.objectKey);
        return selectedBytes;
      },
      write: async (_reference, bytes) =>
        writeFile(originalFile, bytes, { mode: 0o600, flag: 'wx' }),
    });
    assert.equal(capture.capturedObjects, 1);
    const before = await inventory(source);
    assert.ok(
      before.find((t) => t.table === '_prisma_migrations')?.count >= 33,
    );
    assert.ok(before.find((t) => t.table === 'documents')?.count > 0);
    const database = path.join(temporary, 'synthetic-database.dump');
    command(path.join(bin, 'pg_dump'), [
      '-h',
      '127.0.0.1',
      '-p',
      String(port),
      '-U',
      'fmv_owner',
      '-d',
      'fmv_dev',
      '--schema=fmv',
      '--snapshot',
      snapshot,
      '--format=custom',
      '--no-owner',
      '--file',
      database,
    ]);
    await source.query('COMMIT');
    await withTool('age', async (age) => {
      const keygen = path.join(path.dirname(age), 'age-keygen');
      const identity = path.join(
        path.dirname(age),
        'synthetic-restore-identity',
      );
      command(keygen, ['-o', identity]);
      const recipient = command(keygen, ['-y', identity]);
      const encrypted = path.join(temporary, 'synthetic-database.dump.age');
      command(age, ['-r', recipient, '-o', encrypted, database]);
      const signingKey = path.join(
        path.dirname(age),
        'synthetic-recovery-signing-key',
      );
      command('/usr/bin/ssh-keygen', [
        '-q',
        '-t',
        'ed25519',
        '-N',
        '',
        '-C',
        'synthetic',
        '-f',
        signingKey,
      ]);
      const trustedPublicKey = command('/usr/bin/ssh-keygen', [
        '-y',
        '-f',
        signingKey,
      ])
        .split(/\s+/)
        .slice(0, 2)
        .join(' ');
      const ciphertext = await readFile(encrypted);
      const expectedSetId = randomUUID().replaceAll('-', '');
      const measured = { bytes: ciphertext.length, sha256: hash(ciphertext) };
      const manifest = encodeBackupCompletion({
        format: 'fmv-encrypted-recovery-v1',
        environment: 'development',
        setId: expectedSetId,
        completedAt: Date.now(),
        ciphertextBytes: measured.bytes,
        ciphertextSha256: measured.sha256,
      });
      const signature = Buffer.from(
        command(
          '/usr/bin/ssh-keygen',
          ['-Y', 'sign', '-f', signingKey, '-n', backupSignatureNamespace],
          { input: manifest },
        ) + '\n',
      );
      const receipt = {
        manifest,
        signature,
        trustedPublicKey,
        expectedSetId,
        observedCiphertext: measured,
        now: Date.now(),
      };
      assert.equal(
        (await verifySignedBackupCompletion(receipt)).setId,
        expectedSetId,
      );
      const changed = Buffer.from(ciphertext);
      changed[changed.length - 1] ^= 1;
      await assert.rejects(
        verifySignedBackupCompletion({
          ...receipt,
          observedCiphertext: { bytes: changed.length, sha256: hash(changed) },
        }),
        /^Error: Backup completion validation failed$/,
      );

      const expected = hash(await readFile(database));
      const encryptedOriginal = path.join(temporary, 'synthetic-original.age');
      command(age, ['-r', recipient, '-o', encryptedOriginal, originalFile]);
      await rm(originalFile);
      command(age, [
        '-d',
        '-i',
        identity,
        '-o',
        originalFile,
        encryptedOriginal,
      ]);
      await rm(database);
      command(age, ['-d', '-i', identity, '-o', database, encrypted]);
      assert.equal(
        hash(await readFile(database)),
        expected,
        'Recovered dump integrity must match',
      );
    });
    await source.query('CREATE DATABASE fmv_restore_test');
    command(path.join(bin, 'pg_restore'), [
      '-h',
      '127.0.0.1',
      '-p',
      String(port),
      '-U',
      'fmv_owner',
      '-d',
      'fmv_restore_test',
      '--exit-on-error',
      '--single-transaction',
      '--no-owner',
      database,
    ]);
    restored = client('fmv_restore_test');
    await restored.connect();
    assert.deepEqual(
      await inventory(restored),
      before,
      'All synthetic table data, migration history and runtime table ACL/RLS must round-trip',
    );
    assert.equal(
      (
        await restored.query(
          "SELECT to_regnamespace('synthetic_provider_excluded') IS NULL AS absent",
        )
      ).rows[0].absent,
      true,
    );
    assert.equal(
      (
        await source.query(
          'SELECT count(*)::integer AS n FROM fmv.recovery_snapshot_probe',
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await restored.query(
          'SELECT count(*)::integer AS n FROM fmv.recovery_snapshot_probe',
        )
      ).rows[0].n,
      0,
      'Post-snapshot writes must not enter the dump',
    );
    const recoveredReference = (
      await restored.query(
        'SELECT id AS "documentId",object_key AS "objectKey",bytes,sha256 FROM fmv.documents WHERE id=$1',
        [selectedReference.documentId],
      )
    ).rows[0];
    assert.deepEqual(recoveredReference, selectedReference);
    const recoveredOriginal = await readFile(originalFile);
    const recoveredCapture = await captureOriginals([recoveredReference], {
      maxObjectBytes: selectedBytes.length,
      maxTotalBytes: selectedBytes.length,
      read: async (key) => {
        assert.equal(key, selectedReference.objectKey);
        return recoveredOriginal;
      },
      write: async (_reference, bytes) =>
        assert.deepEqual(bytes, selectedBytes),
    });
    assert.equal(recoveredCapture.capturedObjects, 1);
    const invalid = randomUUID();
    await assert.rejects(
      restored.query(
        'INSERT INTO fmv.persons(id,owner_account_id,display_name) VALUES($1,$2,$3)',
        [invalid, randomUUID(), 'SYNTHETIC invalid foreign key'],
      ),
      (e) => e.code === '23503',
    );
    runtime = client('fmv_restore_test', 'fmv_app', appPassword);
    await runtime.connect();
    await assert.rejects(
      runtime.query('CREATE TABLE fmv.forbidden_restore_probe(id integer)'),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      runtime.query('DELETE FROM fmv.persons'),
      (e) => e.code === '42501',
    );
    assert.ok(
      (await runtime.query('SELECT count(*)::integer AS n FROM fmv.persons'))
        .rows[0].n > 0,
    );
    const evidenceResult = await verifySyntheticEvidenceReconciliation({
      source,
      restored,
      port,
      appPassword,
      fixture: evidenceFixture,
    });
    console.log(
      JSON.stringify({
        ...evidenceResult,
        ...linkPublication,
        syntheticDatabaseRoundTrip: true,
        concurrentSnapshotIsolation: true,
        encryptedDumpRoundTrip: true,
        signedCiphertextReceiptVerified: true,
        tableAclAndRlsPreserved: true,
        foreignKeysEnforced: true,
        providerSchemaExcluded: true,
        staleRevocationDemonstrated: true,
        syntheticReconciliationApplied: true,
        productionRestoreApproved: false,
        selectedSyntheticOriginalRecovered: true,
        originalsRecoveryVerified: false,
      }),
    );
  } catch {
    throw new Error(
      'Synthetic recovery drill failed; database contents and credentials suppressed',
    );
  } finally {
    for (const db of [runtime, restored, source])
      if (db) await db.end().catch(() => {});
    await rm(passfile, { force: true });
  }
}
