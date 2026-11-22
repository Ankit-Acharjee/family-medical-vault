// Test fixture only: invoked inside test-db-native's disposable local cluster.
// This is neither a production publisher nor an independent ledger verifier.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
} from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { withTool } from '../ci/tools.mjs';
import { encodeRestoreEvidence } from '../backup/restore-evidence.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const database = 'fmv_ledger_receiver_test';
const receiptFormat = 'fmv-synthetic-link-receipt-v1';
const signatureNamespace = Buffer.from(
  'fmv.synthetic-link-publication.receipt.test-only.v1\0',
);

export async function verifySyntheticLinkPublication({
  source,
  client,
  temporary,
}) {
  let receiver,
    directory,
    stage = 'harness';
  try {
    try {
      assert.equal(source.connectionParameters.database, 'fmv_dev');
      assert.equal(source.connectionParameters.host, '127.0.0.1');
      assert.match(path.basename(temporary), /^fmv-db-verification-/);
      const temporaryStat = await lstat(temporary);
      assert.ok(temporaryStat.isDirectory() && !temporaryStat.isSymbolicLink());
      const canonicalTemporary = await realpath(temporary);
      assert.match(path.basename(canonicalTemporary), /^fmv-db-verification-/);
      const dataDirectory = (await source.query('SHOW data_directory')).rows[0]
        .data_directory;
      assert.equal(
        await realpath(dataDirectory),
        await realpath(path.join(canonicalTemporary, 'data')),
      );
      assert.equal(
        (await source.query('SELECT current_database() AS name')).rows[0].name,
        'fmv_dev',
      );
      directory = await mkdtemp(
        path.join(canonicalTemporary, 'link-publication-'),
      );

      // Read only opaque identity, kind and timing from the synthetic fixture.
      stage = 'repair';
      const selected = (
        await source.query(
          `SELECT l.id AS resource_id,l.patient_id,l.revoked_at,
           e.id AS event_id,e.kind,e.occurred_at,e.recorded_at
           FROM fmv.temporary_links l JOIN fmv.restore_ledger_events e
           ON e.resource_id=l.id AND e.kind='link.revoked'
           WHERE l.revoked_at IS NOT NULL ORDER BY e.id LIMIT 1`,
        )
      ).rows[0];
      assert.ok(selected);
      assert.equal(
        selected.occurred_at.getTime(),
        selected.revoked_at.getTime(),
      );
      const readLocal = async () =>
        (
          await source.query(
            `SELECT id,patient_id,resource_id,kind,occurred_at,recorded_at
             FROM fmv.restore_ledger_events
             WHERE resource_id=$1::uuid AND kind='link.revoked'`,
            [selected.resource_id],
          )
        ).rows;
      // Controlled owner-only crash-gap simulation. The retained source intent
      // must recreate exactly its own denial, then preserve the repaired UUID.
      assert.equal(
        (
          await source.query(
            'DELETE FROM fmv.restore_ledger_events WHERE id=$1::uuid',
            [selected.event_id],
          )
        ).rowCount,
        1,
      );
      assert.deepEqual(await readLocal(), []);
      await source.query(
        'SELECT fmv.capture_temporary_link_revocation($1::uuid)',
        [selected.resource_id],
      );
      const repaired = await readLocal();
      assert.equal(repaired.length, 1);
      const event = repaired[0];
      assert.equal(event.patient_id, selected.patient_id);
      assert.equal(event.resource_id, selected.resource_id);
      assert.equal(event.kind, 'link.revoked');
      assert.equal(event.occurred_at.getTime(), selected.revoked_at.getTime());
      await source.query(
        'SELECT fmv.capture_temporary_link_revocation($1::uuid)',
        [selected.resource_id],
      );
      assert.deepEqual(await readLocal(), repaired);
      assert.equal(
        (
          await source.query(
            'SELECT revoked_at FROM fmv.temporary_links WHERE id=$1::uuid',
            [selected.resource_id],
          )
        ).rows[0].revoked_at.getTime(),
        selected.revoked_at.getTime(),
      );

      const ledgerId = randomUUID().replaceAll('-', ''),
        evidence = encodeRestoreEvidence({
          format: 'fmv-restore-evidence-v1',
          ledgerId,
          afterSequence: 0,
          throughSequence: 1,
          events: [
            {
              sequence: 1,
              eventId: event.id,
              patientId: event.patient_id,
              resourceId: event.resource_id,
              kind: event.kind,
              lifecycle: null,
              occurredAt: event.occurred_at.getTime(),
            },
          ],
        });
      stage = 'encryption';
      const stagedCiphertext = path.join(directory, `${event.id}.age`);
      const ciphertext = await withTool('age', async (age) => {
        const identity = path.join(directory, 'ephemeral-age-identity'),
          plaintext = path.join(directory, 'link-evidence.json'),
          encrypted = stagedCiphertext,
          decrypted = path.join(directory, 'link-evidence-roundtrip.json'),
          keygen = path.join(path.dirname(age), 'age-keygen');
        const run = (binary, args) => {
          const result = spawnSync(binary, args, {
            encoding: 'utf8',
            timeout: 15000,
            maxBuffer: 65536,
            env: { PATH: '/usr/bin:/bin', TMPDIR: directory },
          });
          assert.ok(
            !result.error && result.status === 0,
            'Synthetic link encryption failed (output suppressed)',
          );
          return result.stdout.trim();
        };
        run(keygen, ['-o', identity]);
        const recipient = run(keygen, ['-y', identity]);
        await writeFile(plaintext, evidence, { flag: 'wx', mode: 0o600 });
        run(age, ['-r', recipient, '-o', encrypted, plaintext]);
        await rm(plaintext);
        run(age, ['-d', '-i', identity, '-o', decrypted, encrypted]);
        assert.ok((await readFile(decrypted)).equals(evidence));
        const encryptedBytes = await readFile(encrypted);
        assert.ok(
          encryptedBytes.length > 0 && !encryptedBytes.equals(evidence),
        );
        return encryptedBytes;
      });

      const signing = generateKeyPairSync('ed25519'),
        wrongSigning = generateKeyPairSync('ed25519');
      const signedBytes = (receipt) =>
        Buffer.concat([signatureNamespace, receipt]);
      const verifyReceipt = (row, bytes, trustedKey = signing.publicKey) => {
        const receipt = JSON.parse(row.receipt.toString('utf8'));
        assert.deepEqual(Object.keys(receipt), [
          'format',
          'eventId',
          'ledgerId',
          'ciphertextSha256',
          'ciphertextBytes',
          'sequence',
        ]);
        assert.equal(receipt.format, receiptFormat);
        assert.equal(receipt.eventId, event.id);
        assert.equal(receipt.eventId, row.event_id);
        assert.equal(receipt.ledgerId, ledgerId);
        assert.equal(receipt.ledgerId, row.ledger_id);
        assert.equal(receipt.ciphertextSha256, hash(bytes));
        assert.equal(receipt.ciphertextSha256, row.ciphertext_sha256);
        assert.equal(receipt.ciphertextBytes, bytes.length);
        assert.equal(receipt.ciphertextBytes, row.ciphertext_bytes);
        assert.equal(receipt.sequence, Number(row.sequence));
        assert.ok(
          Number.isSafeInteger(receipt.sequence) && receipt.sequence > 0,
        );
        assert.equal(JSON.stringify(receipt), row.receipt.toString('utf8'));
        assert.ok(
          verify(null, signedBytes(row.receipt), trustedKey, row.signature),
        );
      };

      // This database shares only the disposable test cluster, never production
      // hosting or keys. Its successful receipt cannot prove source-loss safety.
      stage = 'receiver';
      await source.query(`CREATE DATABASE ${database} TEMPLATE template0`);
      const connectReceiver = async () => {
        const connection = client(database);
        assert.equal(connection.connectionParameters.database, database);
        assert.equal(connection.connectionParameters.host, '127.0.0.1');
        assert.equal(
          connection.connectionParameters.port,
          source.connectionParameters.port,
        );
        await connection.connect();
        return connection;
      };
      receiver = await connectReceiver();
      await receiver.query('CREATE SCHEMA synthetic_link_ledger');
      await receiver.query(
        'CREATE SEQUENCE synthetic_link_ledger.publication_sequence AS bigint',
      );
      await receiver.query(
        `CREATE TABLE synthetic_link_ledger.publications(
         event_id uuid PRIMARY KEY,ledger_id text NOT NULL,
         ciphertext bytea NOT NULL,ciphertext_sha256 text NOT NULL,
         ciphertext_bytes integer NOT NULL CHECK(ciphertext_bytes>0),
         sequence bigint NOT NULL UNIQUE CHECK(sequence>0),
         receipt bytea NOT NULL,signature bytea NOT NULL,
         CHECK(octet_length(ciphertext)=ciphertext_bytes),
         CHECK(ciphertext_sha256 ~ '^[a-f0-9]{64}$'),
         CHECK(octet_length(signature)=64))`,
      );
      const readReceiver = async () =>
        (
          await receiver.query(
            'SELECT * FROM synthetic_link_ledger.publications WHERE event_id=$1::uuid',
            [event.id],
          )
        ).rows[0];
      const lostAcknowledgement = new Error('Synthetic acknowledgement lost'),
        conflict = new Error('Synthetic ciphertext identity conflict');
      const publish = async (bytes, loseAcknowledgement = false) => {
        let row;
        await receiver.query('BEGIN');
        try {
          // Retry consumes nextval too: gaps are valid. This local sequence is
          // only receipt identity, never a complete coverage or restore anchor.
          const sequence = Number(
              (
                await receiver.query(
                  "SELECT nextval('synthetic_link_ledger.publication_sequence') AS value",
                )
              ).rows[0].value,
            ),
            digest = hash(bytes),
            receipt = Buffer.from(
              JSON.stringify({
                format: receiptFormat,
                eventId: event.id,
                ledgerId,
                ciphertextSha256: digest,
                ciphertextBytes: bytes.length,
                sequence,
              }),
            ),
            signature = sign(null, signedBytes(receipt), signing.privateKey);
          assert.ok(Number.isSafeInteger(sequence) && sequence > 0);
          await receiver.query(
            `INSERT INTO synthetic_link_ledger.publications
             (event_id,ledger_id,ciphertext,ciphertext_sha256,ciphertext_bytes,
              sequence,receipt,signature)
             VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT(event_id) DO NOTHING`,
            [
              event.id,
              ledgerId,
              bytes,
              digest,
              bytes.length,
              sequence,
              receipt,
              signature,
            ],
          );
          row = await readReceiver();
          if (
            row.ledger_id !== ledgerId ||
            row.ciphertext_sha256 !== digest ||
            row.ciphertext_bytes !== bytes.length ||
            !row.ciphertext.equals(bytes)
          )
            throw conflict;
          verifyReceipt(row, bytes);
          await receiver.query('COMMIT');
        } catch (error) {
          await receiver.query('ROLLBACK');
          throw error;
        }
        if (loseAcknowledgement) throw lostAcknowledgement;
        return row;
      };

      // Commit all receiver bytes and receipt, then lose the acknowledgement and
      // connection. A new connection must retrieve the exact durable response.
      stage = 'publication';
      await assert.rejects(
        publish(ciphertext, true),
        (error) => error === lostAcknowledgement,
      );
      await receiver.end();
      receiver = undefined;
      receiver = await connectReceiver();
      stage = 'replay';
      const replayCiphertext = await readFile(stagedCiphertext);
      assert.equal(replayCiphertext.length, ciphertext.length);
      assert.equal(hash(replayCiphertext), hash(ciphertext));
      assert.ok(replayCiphertext.equals(ciphertext));
      const committed = await readReceiver(),
        retry = await publish(replayCiphertext),
        repeated = await publish(replayCiphertext);
      assert.deepEqual(retry, committed);
      assert.deepEqual(repeated, committed);
      assert.ok(committed.ciphertext.equals(ciphertext));
      assert.equal(committed.ciphertext_sha256, hash(ciphertext));
      assert.equal(Number(committed.sequence), 1);
      verifyReceipt(committed, ciphertext);
      const changedCiphertext = Buffer.from(ciphertext);
      changedCiphertext[changedCiphertext.length - 1] ^= 1;
      await assert.rejects(
        publish(changedCiphertext),
        (error) => error === conflict,
      );
      assert.deepEqual(await readReceiver(), committed);
      assert.equal(
        (
          await receiver.query(
            'SELECT count(*)::int AS n FROM synthetic_link_ledger.publications',
          )
        ).rows[0].n,
        1,
      );
      assert.throws(() =>
        verifyReceipt(committed, ciphertext, wrongSigning.publicKey),
      );
      const changedReceipt = Buffer.from(
        JSON.stringify({
          ...JSON.parse(committed.receipt.toString('utf8')),
          sequence: 2,
        }),
      );
      assert.throws(() =>
        verifyReceipt({ ...committed, receipt: changedReceipt }, ciphertext),
      );
      assert.equal(
        verify(
          null,
          signedBytes(changedReceipt),
          signing.publicKey,
          committed.signature,
        ),
        false,
      );
      assert.equal(
        verify(null, committed.receipt, signing.publicKey, committed.signature),
        false,
      );
      return {
        pendingIntentRepairVerified: true,
        encryptedLinkEvidenceRoundTrip: true,
        receiverCiphertextStoredExactly: true,
        receiverRetryIdempotent: true,
        conflictingCiphertextRejected: true,
        lostAcknowledgementRetryVerified: true,
        receiptSignatureVerified: true,
        receiptTamperingRejected: true,
        receiptWrongKeyRejected: true,
        receiptNamespaceVerified: true,
        independentlyHostedLedgerVerified: false,
        sourceLossCoverageVerified: false,
      };
    } finally {
      const cleanup = await Promise.allSettled([
        receiver?.end(),
        directory && rm(directory, { recursive: true, force: true }),
      ]);
      if (cleanup.some((result) => result.status !== 'fulfilled'))
        stage = 'cleanup';
      assert.ok(cleanup.every((result) => result.status === 'fulfilled'));
    }
  } catch {
    // Never propagate SQL details, opaque metadata, subprocess output or keys.
    throw new Error(
      `Synthetic link publication verification failed (${stage})`,
    );
  }
}
