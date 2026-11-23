// Native disposable-cluster fixture only. No publisher or hosted ledger writes.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import { withTool } from '../../../../infra/ci/tools.mjs';
import {
  configureInitialLedgerPolicy,
  initialLedgerPolicyPlan,
} from '../../../../infra/backup/ledger-policy.mjs';

const { Client } = createRequire(
  new URL('../../package.json', import.meta.url),
)('pg');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const denied = (error) => error.code === '42501';
const invalid = (error) => error.code === '23514';
const stageSignature = 'fmv.stage_restore_event(uuid,uuid,text,bytea)';

export async function verifyLedgerStaging({ owner, runtime }) {
  const connections = [];
  let phase = 'fixture';
  try {
    try {
      assert.ok(
        owner.connectionParameters.host === '127.0.0.1' ||
          (owner.connectionParameters.host === 'postgres' &&
            Number(owner.connectionParameters.port) === 5432),
      );
      const events = (
        await owner.query(
          `SELECT e.id,e.patient_id,e.resource_id,e.kind,e.occurred_at
           FROM fmv.restore_ledger_events e
           WHERE NOT EXISTS(SELECT 1 FROM fmv.restore_ledger_publications p WHERE p.event_id=e.id)
           ORDER BY e.id LIMIT 2`,
        )
      ).rows;
      assert.equal(events.length, 2);
      const [first, portable] = events;
      phase = 'role-bootstrap';
      const creator = `fmv_staging_creator_${randomUUID().replaceAll('-', '')}`,
        capability = `fmv_staging_cap_${randomUUID().replaceAll('-', '')}`,
        migration = await readFile(
          new URL(
            '../../prisma/migrations/20261123000100_ledger_ciphertext_staging/migration.sql',
            import.meta.url,
          ),
          'utf8',
        ),
        delimiter = 'GRANT USAGE ON SCHEMA fmv TO fmv_ledger_stager;';
      assert.ok(
        migration.startsWith('BEGIN;') && migration.includes(delimiter),
      );
      const bootstrap = migration
        .split(delimiter)[0]
        .replace(/^BEGIN;\s*/, '')
        .replaceAll('fmv_ledger_stager', capability);
      let creatorCreated = false,
        transaction = false;
      try {
        await owner.query(
          `CREATE ROLE ${quote(creator)} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB CREATEROLE NOINHERIT`,
        );
        creatorCreated = true;
        for (let attempt = 0; attempt < 2; attempt++) {
          await owner.query('BEGIN');
          transaction = true;
          await owner.query(`SET LOCAL ROLE ${quote(creator)}`);
          assert.deepEqual(
            (
              await owner.query(
                'SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user',
              )
            ).rows,
            [{ rolsuper: false, rolbypassrls: false, rolcreaterole: true }],
          );
          // Execute the actual migration bootstrap, changing only its generated
          // global role name; repeat after commit as the same non-super creator.
          await owner.query(bootstrap);
          assert.deepEqual(
            (
              await owner.query(
                `SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit
             FROM pg_roles WHERE rolname=$1`,
                [capability],
              )
            ).rows,
            [
              {
                rolcanlogin: false,
                rolsuper: false,
                rolbypassrls: false,
                rolcreatedb: false,
                rolcreaterole: false,
                rolinherit: false,
              },
            ],
          );
          assert.deepEqual(
            (
              await owner.query(
                `SELECT r.rolname AS role_name,u.rolname AS member_name,
             m.admin_option,m.inherit_option,m.set_option
             FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
             JOIN pg_roles u ON u.oid=m.member
             WHERE r.rolname=$1 OR u.rolname=$1`,
                [capability],
              )
            ).rows,
            [
              {
                role_name: capability,
                member_name: creator,
                admin_option: true,
                inherit_option: false,
                set_option: false,
              },
            ],
          );
          await owner.query('COMMIT');
          transaction = false;
        }
      } finally {
        if (transaction) await owner.query('ROLLBACK');
        await owner.query('RESET ROLE');
        if (creatorCreated) {
          await owner.query(`DROP ROLE IF EXISTS ${quote(capability)}`);
          await owner.query(`DROP ROLE ${quote(creator)}`);
        }
      }
      phase = 'fixture';
      const recipients = await withTool('age', async (age) => {
        const directory = path.dirname(age),
          keygen = path.join(directory, 'age-keygen');
        const run = (args) => {
          const result = spawnSync(keygen, args, {
            encoding: 'utf8',
            timeout: 15000,
            maxBuffer: 65536,
            env: { PATH: '/usr/bin:/bin', TMPDIR: directory },
          });
          assert.ok(!result.error && result.status === 0);
          return result.stdout.trim();
        };
        return [0, 1].map((index) => {
          const identity = path.join(
            directory,
            `synthetic-staging-identity-${index}`,
          );
          run(['-o', identity]);
          const recipient = run(['-y', identity]);
          assert.match(
            recipient,
            /^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/,
          );
          return recipient;
        });
      });
      const oldPolicy = {
          id: randomUUID(),
          ledgerId: randomUUID().replaceAll('-', ''),
          recipient: recipients[0],
        },
        newPolicy = {
          id: randomUUID(),
          ledgerId: randomUUID().replaceAll('-', ''),
          recipient: recipients[1],
        };
      const insertPolicy = (policy) =>
        owner.query(
          `INSERT INTO fmv.restore_ledger_policies
         (id,ledger_id,environment,recipient,recipient_sha256,enabled)
         VALUES($1::uuid,$2,'development',$3,$4,true)`,
          [
            policy.id,
            policy.ledgerId,
            policy.recipient,
            hash(policy.recipient),
          ],
        );
      phase = 'initial-policy';
      const initialPlan = initialLedgerPolicyPlan({
          recipient: oldPolicy.recipient,
          policyId: oldPolicy.id,
          ledgerId: oldPolicy.ledgerId,
        }),
        policyRows = async () =>
          (
            await owner.query(
              'SELECT id,ledger_id,environment,recipient,recipient_sha256,enabled FROM fmv.restore_ledger_policies ORDER BY id',
            )
          ).rows,
        expectedPolicy = [
          {
            id: oldPolicy.id,
            ledger_id: oldPolicy.ledgerId,
            environment: 'development',
            recipient: oldPolicy.recipient,
            recipient_sha256: hash(oldPolicy.recipient),
            enabled: true,
          },
        ];
      assert.deepEqual(await policyRows(), []);
      const prerequisiteChecks = [];
      for (const apply of [false, true]) {
        await assert.rejects(
          configureInitialLedgerPolicy(owner, initialPlan, {
            apply,
            verifyPrerequisites: async (connection) => {
              assert.equal(connection, owner);
              const readOnly = (
                await connection.query(
                  "SELECT current_setting('transaction_read_only') AS value",
                )
              ).rows[0].value;
              assert.equal(readOnly, apply ? 'off' : 'on');
              prerequisiteChecks.push(readOnly);
              throw Error('Synthetic prerequisite rejection');
            },
          }),
          /^Error: Initial ledger policy configuration failed$/,
        );
        assert.deepEqual(await policyRows(), []);
      }
      assert.deepEqual(prerequisiteChecks, ['on', 'off']);
      await assert.rejects(
        configureInitialLedgerPolicy(owner, initialPlan, { apply: 'true' }),
        /^Error: Initial ledger policy configuration failed$/,
      );
      assert.deepEqual(await policyRows(), []);
      assert.deepEqual(await configureInitialLedgerPolicy(owner, initialPlan), {
        initialPolicyMatches: false,
        hostedPolicyWritten: false,
        readOnly: true,
        operatorLoginEnabled: false,
        cloudPublishingEnabled: false,
      });
      assert.deepEqual(await policyRows(), []);
      const connectOwner = async () => {
        const p = owner.connectionParameters;
        const connection = new Client({
          host: p.host,
          port: p.port,
          database: p.database,
          user: p.user,
          password: p.password,
          connectionTimeoutMillis: 5000,
        });
        connections.push(connection);
        await connection.connect();
        return connection;
      };
      const peer = await connectOwner();
      const initialApplications = await Promise.all([
        configureInitialLedgerPolicy(owner, initialPlan, { apply: true }),
        configureInitialLedgerPolicy(peer, initialPlan, { apply: true }),
      ]);
      assert.deepEqual(
        initialApplications.map((result) => result.hostedPolicyWritten).sort(),
        [false, true],
      );
      for (const result of initialApplications)
        assert.deepEqual(result, {
          initialPolicyMatches: true,
          hostedPolicyWritten: result.hostedPolicyWritten,
          readOnly: false,
          operatorLoginEnabled: false,
          cloudPublishingEnabled: false,
        });
      assert.deepEqual(await policyRows(), expectedPolicy);
      assert.deepEqual(
        await configureInitialLedgerPolicy(owner, initialPlan, { apply: true }),
        {
          initialPolicyMatches: true,
          hostedPolicyWritten: false,
          readOnly: false,
          operatorLoginEnabled: false,
          cloudPublishingEnabled: false,
        },
      );
      assert.deepEqual(await configureInitialLedgerPolicy(owner, initialPlan), {
        initialPolicyMatches: true,
        hostedPolicyWritten: false,
        readOnly: true,
        operatorLoginEnabled: false,
        cloudPublishingEnabled: false,
      });
      const conflictingPlan = initialLedgerPolicyPlan({
        recipient: newPolicy.recipient,
        policyId: newPolicy.id,
        ledgerId: newPolicy.ledgerId,
      });
      for (const apply of [false, true]) {
        await assert.rejects(
          configureInitialLedgerPolicy(owner, conflictingPlan, { apply }),
          /^Error: Initial ledger policy configuration failed$/,
        );
        assert.deepEqual(await policyRows(), expectedPolicy);
      }
      const connect = async () => {
        const connection = await connectOwner();
        await connection.query('SET ROLE fmv_ledger_stager');
        assert.equal(
          (await connection.query('SELECT current_user AS name')).rows[0].name,
          'fmv_ledger_stager',
        );
        return connection;
      };
      const a = await connect(),
        b = await connect();
      const prepare = async (connection, event, policy) => {
        const payload = (
          await connection.query(
            'SELECT fmv.prepare_restore_event($1::uuid,$2::uuid) AS payload',
            [event.id, policy.id],
          )
        ).rows[0].payload;
        const eventValue = {
          eventId: event.id,
          patientId: event.patient_id,
          resourceId: event.resource_id,
          kind: event.kind,
          lifecycle: null,
          occurredAt: event.occurred_at.getTime(),
        };
        assert.deepEqual(
          payload,
          Buffer.from(
            JSON.stringify({
              format: 'fmv-restore-event-v1',
              environment: 'development',
              ledgerId: policy.ledgerId,
              recipientSha256: hash(policy.recipient),
              event: eventValue,
            }),
          ),
        );
        return {
          payload,
          digest: hash(payload),
          sourceDigest: hash(JSON.stringify(eventValue)),
        };
      };
      const stage = async (connection, eventId, policyId, digest, ciphertext) =>
        (
          await connection.query(
            'SELECT * FROM fmv.stage_restore_event($1::uuid,$2::uuid,$3::text,$4::bytea)',
            [eventId, policyId, digest, ciphertext],
          )
        ).rows[0];
      const read = async (connection, eventId) =>
        (
          await connection.query(
            'SELECT * FROM fmv.restore_ledger_publications WHERE event_id=$1::uuid',
            [eventId],
          )
        ).rows;
      // These exercise the SQL envelope boundary, not actual encryption.
      // Actual age encryption/roundtrip is covered by the publication drill.
      const cipherA = Buffer.concat([
          Buffer.from('age-encryption.org/v1\n'),
          Buffer.alloc(160, 65),
        ]),
        cipherB = Buffer.concat([
          Buffer.from('age-encryption.org/v1\n'),
          Buffer.alloc(192, 66),
        ]),
        prepared = await prepare(a, first, oldPolicy);

      phase = 'privileges';
      for (const sql of [
        'SELECT * FROM fmv.restore_ledger_policies',
        'SELECT * FROM fmv.restore_ledger_publications',
        `SELECT fmv.restore_event_source_bytes('${first.id}'::uuid)`,
        `SELECT fmv.prepare_restore_event('${first.id}'::uuid,'${oldPolicy.id}'::uuid)`,
        `SELECT * FROM fmv.stage_restore_event('${first.id}'::uuid,'${oldPolicy.id}'::uuid,'${prepared.digest}',NULL)`,
        'SELECT fmv.guard_ledger_staging()',
      ])
        await assert.rejects(runtime.query(sql), denied);
      const forbidden = [
        [
          `INSERT INTO fmv.restore_ledger_policies(id,ledger_id,environment,recipient,recipient_sha256) VALUES($1::uuid,$2,'development',$3,$4)`,
          [
            randomUUID(),
            oldPolicy.ledgerId,
            oldPolicy.recipient,
            hash(oldPolicy.recipient),
          ],
        ],
        [
          'UPDATE fmv.restore_ledger_policies SET enabled=enabled WHERE id=$1::uuid',
          [oldPolicy.id],
        ],
        [
          'DELETE FROM fmv.restore_ledger_policies WHERE id=$1::uuid',
          [oldPolicy.id],
        ],
        [
          `INSERT INTO fmv.restore_ledger_publications(event_id,policy_id,source_sha256,payload_sha256,ciphertext,ciphertext_bytes,ciphertext_sha256) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7)`,
          [
            first.id,
            oldPolicy.id,
            prepared.sourceDigest,
            prepared.digest,
            cipherA,
            cipherA.length,
            hash(cipherA),
          ],
        ],
        [
          'UPDATE fmv.restore_ledger_publications SET staged_at=staged_at WHERE event_id=$1::uuid',
          [first.id],
        ],
        [
          'DELETE FROM fmv.restore_ledger_publications WHERE event_id=$1::uuid',
          [first.id],
        ],
        ['TRUNCATE fmv.restore_ledger_publications', []],
      ];
      for (const connection of [runtime, a]) {
        for (const [sql, values] of forbidden)
          await assert.rejects(connection.query(sql, values), denied);
      }

      phase = 'invalid-inputs';
      for (const [eventId, policyId, digest, ciphertext, reject] of [
        [first.id, randomUUID(), prepared.digest, cipherA, invalid],
        [first.id, null, prepared.digest, cipherA, invalid],
        [randomUUID(), oldPolicy.id, prepared.digest, cipherA, invalid],
        [null, oldPolicy.id, prepared.digest, cipherA, invalid],
        [first.id, oldPolicy.id, '0'.repeat(64), cipherA, invalid],
        [first.id, oldPolicy.id, null, cipherA, invalid],
        [first.id, oldPolicy.id, prepared.digest, Buffer.alloc(160), invalid],
        [
          first.id,
          oldPolicy.id,
          prepared.digest,
          Buffer.from('age-encryption.org/v1\n'),
          invalid,
        ],
        [
          first.id,
          oldPolicy.id,
          prepared.digest,
          Buffer.concat([
            Buffer.from('age-encryption.org/v1\n'),
            Buffer.alloc(65536),
          ]),
          invalid,
        ],
        [
          first.id,
          oldPolicy.id,
          prepared.digest,
          null,
          (error) => error.code === '23502',
        ],
      ])
        await assert.rejects(
          stage(a, eventId, policyId, digest, ciphertext),
          reject,
        );
      assert.deepEqual(await read(a, first.id), []);

      phase = 'race';
      const [winnerA, winnerB] = await Promise.all([
        stage(a, first.id, oldPolicy.id, prepared.digest, cipherA),
        stage(b, first.id, oldPolicy.id, prepared.digest, cipherB),
      ]);
      assert.deepEqual(winnerA, winnerB);
      assert.ok(
        winnerA.ciphertext.equals(cipherA) ||
          winnerA.ciphertext.equals(cipherB),
      );
      assert.equal(winnerA.event_id, first.id);
      assert.equal(winnerA.policy_id, oldPolicy.id);
      assert.equal(winnerA.source_sha256, prepared.sourceDigest);
      assert.equal(winnerA.payload_sha256, prepared.digest);
      assert.equal(winnerA.ciphertext_sha256, hash(winnerA.ciphertext));
      assert.equal(winnerA.ciphertext_bytes, winnerA.ciphertext.length);
      const measured = (
        await a.query(
          `SELECT encode(sha256(ciphertext),'hex') AS digest,octet_length(ciphertext) AS bytes
         FROM fmv.restore_ledger_publications WHERE event_id=$1::uuid`,
          [first.id],
        )
      ).rows[0];
      assert.deepEqual(measured, {
        digest: hash(winnerA.ciphertext),
        bytes: winnerA.ciphertext.length,
      });
      assert.deepEqual(await read(a, first.id), [winnerA]);
      assert.deepEqual(
        await stage(a, first.id, oldPolicy.id, prepared.digest, cipherB),
        winnerA,
      );

      phase = 'rotation';
      await owner.query(
        'UPDATE fmv.restore_ledger_policies SET enabled=false WHERE id=$1::uuid',
        [oldPolicy.id],
      );
      for (const apply of [false, true]) {
        await assert.rejects(
          configureInitialLedgerPolicy(owner, initialPlan, { apply }),
          /^Error: Initial ledger policy configuration failed$/,
        );
        assert.deepEqual(await policyRows(), [
          { ...expectedPolicy[0], enabled: false },
        ]);
      }
      await insertPolicy(newPolicy);
      const rotated = await prepare(a, first, newPolicy);
      assert.notEqual(rotated.digest, prepared.digest);
      assert.deepEqual(await read(a, first.id), [winnerA]);
      assert.deepEqual(
        await stage(b, first.id, oldPolicy.id, prepared.digest, null),
        winnerA,
      );
      await assert.rejects(
        stage(a, first.id, newPolicy.id, rotated.digest, cipherB),
        invalid,
      );
      await assert.rejects(
        stage(a, first.id, oldPolicy.id, rotated.digest, cipherB),
        invalid,
      );
      for (const [sql, values] of [
        [
          'UPDATE fmv.restore_ledger_publications SET staged_at=staged_at WHERE event_id=$1::uuid',
          [first.id],
        ],
        [
          'DELETE FROM fmv.restore_ledger_publications WHERE event_id=$1::uuid',
          [first.id],
        ],
        [
          'UPDATE fmv.restore_ledger_policies SET ledger_id=$2 WHERE id=$1::uuid',
          [oldPolicy.id, randomUUID().replaceAll('-', '')],
        ],
        [
          'UPDATE fmv.restore_ledger_policies SET recipient=$2,recipient_sha256=$3 WHERE id=$1::uuid',
          [oldPolicy.id, newPolicy.recipient, hash(newPolicy.recipient)],
        ],
        [
          'DELETE FROM fmv.restore_ledger_policies WHERE id=$1::uuid',
          [oldPolicy.id],
        ],
      ])
        await assert.rejects(owner.query(sql, values), invalid);
      await assert.rejects(
        owner.query('DELETE FROM fmv.restore_ledger_events WHERE id=$1::uuid', [
          first.id,
        ]),
        (error) => error.code === '23503',
      );
      assert.deepEqual(await read(a, first.id), [winnerA]);

      phase = 'portable-owner';
      const probe = `fmv_staging_probe_${randomUUID().replaceAll('-', '')}`,
        ownership = (
          await owner.query(
            `SELECT pg_get_userbyid(c.relowner) AS publication_owner,
           pg_get_userbyid(p.relowner) AS policy_owner,pg_get_userbyid(f.proowner) AS function_owner,
           e.relrowsecurity,e.relforcerowsecurity
           FROM pg_class c CROSS JOIN pg_class p CROSS JOIN pg_proc f CROSS JOIN pg_class e
           WHERE c.oid='fmv.restore_ledger_publications'::regclass
           AND p.oid='fmv.restore_ledger_policies'::regclass
           AND f.oid='${stageSignature}'::regprocedure
           AND e.oid='fmv.restore_ledger_events'::regclass`,
          )
        ).rows[0];
      assert.equal(ownership.relrowsecurity, true);
      assert.equal(ownership.relforcerowsecurity, true);
      let created = false,
        policyChanged = false,
        publicationChanged = false,
        functionChanged = false;
      try {
        await owner.query(
          `CREATE ROLE ${quote(probe)} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT`,
        );
        created = true;
        await owner.query(`GRANT fmv_ledger_stager TO ${quote(probe)}`);
        await owner.query(
          `ALTER TABLE fmv.restore_ledger_policies OWNER TO ${quote(probe)}`,
        );
        policyChanged = true;
        await owner.query(
          `ALTER TABLE fmv.restore_ledger_publications OWNER TO ${quote(probe)}`,
        );
        publicationChanged = true;
        await owner.query(
          `ALTER FUNCTION ${stageSignature} OWNER TO ${quote(probe)}`,
        );
        functionChanged = true;
        assert.deepEqual(
          (
            await owner.query(
              'SELECT rolsuper,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=$1',
              [probe],
            )
          ).rows,
          [{ rolsuper: false, rolbypassrls: false, rolinherit: true }],
        );
        const portablePayload = await prepare(a, portable, newPolicy),
          result = await stage(
            a,
            portable.id,
            newPolicy.id,
            portablePayload.digest,
            cipherB,
          );
        assert.equal(result.event_id, portable.id);
        assert.equal(result.source_sha256, portablePayload.sourceDigest);
        assert.equal(result.payload_sha256, portablePayload.digest);
        assert.ok(result.ciphertext.equals(cipherB));
        assert.deepEqual(
          await stage(
            b,
            portable.id,
            newPolicy.id,
            portablePayload.digest,
            cipherA,
          ),
          result,
        );
        assert.deepEqual(await read(a, portable.id), [result]);
      } finally {
        if (functionChanged)
          await owner.query(
            `ALTER FUNCTION ${stageSignature} OWNER TO ${quote(ownership.function_owner)}`,
          );
        if (publicationChanged)
          await owner.query(
            `ALTER TABLE fmv.restore_ledger_publications OWNER TO ${quote(ownership.publication_owner)}`,
          );
        if (policyChanged)
          await owner.query(
            `ALTER TABLE fmv.restore_ledger_policies OWNER TO ${quote(ownership.policy_owner)}`,
          );
        if (created) {
          await owner.query(`REVOKE fmv_ledger_stager FROM ${quote(probe)}`);
          await owner.query(`DROP ROLE ${quote(probe)}`);
        }
      }
      // Leave immutable synthetic artifacts for native-cluster disposal, and
      // disable only this helper's default policy after exercising rotation.
      await owner.query(
        'UPDATE fmv.restore_ledger_policies SET enabled=false WHERE id=$1::uuid',
        [newPolicy.id],
      );
    } finally {
      const cleanup = await Promise.allSettled(
        connections.map((connection) => connection.end()),
      );
      assert.ok(cleanup.every((result) => result.status === 'fulfilled'));
    }
  } catch {
    throw new Error(`Synthetic ledger staging verification failed (${phase})`);
  }
}
