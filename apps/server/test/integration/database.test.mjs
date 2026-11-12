import process from 'node:process';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { setTimeout as schedule, clearTimeout as cancel } from 'node:timers';
import pg from 'pg';
import { PrismaAuthStore } from '../../dist/auth/auth.store.js';
import { PrismaPersonStore } from '../../dist/identity/person.store.js';
import { PrismaAccessStore } from '../../dist/access/access.store.js';
import { PermissionService } from '../../dist/access/permission.service.js';
import { CaregiverService } from '../../dist/access/caregiver.service.js';
import { hashInvitationToken } from '../../dist/access/invitation.js';
import { PrismaDocumentStore } from '../../dist/documents/document.store.js';
import { DocumentIntake } from '../../dist/documents/intake.js';
import { MemoryObjectStore } from '../../dist/documents/memory-object-store.js';
import { AuthService } from '../../dist/auth/auth.service.js';
import { digest } from '../../dist/auth/auth.crypto.js';
import {
  config as authConfig,
  FakeProvider,
} from '../support/auth-fixture.mjs';
import { ServiceUnavailableException } from '@nestjs/common';

const server = fileURLToPath(new URL('../../', import.meta.url));
const failureMigration = '20261105000200_failure_probe';

function localUrl(name, user) {
  let url;
  try {
    url = new URL(process.env[name]);
  } catch {
    assert.fail(`${name} must be a disposable local database URL`);
  }
  const dockerEndpoint =
    url.hostname === 'postgres' && ['', '5432'].includes(url.port);
  const nativeEndpoint =
    process.env.TEST_NATIVE_POSTGRES === '1' &&
    url.hostname === '127.0.0.1' &&
    Number(url.port) >= 1024 &&
    Number(url.port) < 65536;
  assert.ok(
    ['postgres:', 'postgresql:'].includes(url.protocol) &&
      (dockerEndpoint || nativeEndpoint) &&
      url.pathname === '/fmv_dev' &&
      url.username === user &&
      url.password.length > 0 &&
      !url.hash &&
      [...url.searchParams].every(
        ([key, value]) => key === 'schema' && value === 'fmv',
      ) &&
      (user !== 'fmv_owner' || url.searchParams.get('schema') === 'fmv'),
    `${name} must target the expected disposable local database and role`,
  );
  return url;
}

function prisma(ownerUrl, args) {
  const result = spawnSync('pnpm', ['exec', 'prisma', ...args], {
    cwd: server,
    env: { ...process.env, DATABASE_MIGRATION_URL: ownerUrl.href },
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Never attach captured Prisma output or process errors to an assertion.
  assert.ok(
    !result.error && result.signal === null,
    'Prisma command must complete normally',
  );
  return result.status;
}

async function query(client, sql, values) {
  try {
    return await client.query(sql, values);
  } catch {
    assert.fail('Database verification query failed');
  }
}

async function denied(client, sql) {
  let code;
  try {
    await client.query(sql);
  } catch (error) {
    code = error.code;
  }
  assert.ok(
    code === '42501',
    'Restricted operation must fail with insufficient_privilege',
  );
}

async function rejectedSql(client, sql, values, expectedCode) {
  let code;
  try {
    await client.query(sql, values);
  } catch (error) {
    code = error.code;
  }
  assert.equal(
    code,
    expectedCode,
    'Invalid domain write must fail with the expected SQLSTATE',
  );
}

const unavailable = (status) => (error) => error.getStatus?.() === status;
const accessDenied = (work) => assert.rejects(work, unavailable(404));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

async function within(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = schedule(
          () =>
            reject(new Error('Synthetic database work exceeded its deadline')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    cancel(timer);
  }
}

async function insertGrant(client, fixture, overrides = {}) {
  const grant = {
    id: randomUUID(),
    patientId: fixture.patientId,
    granteeAccountId: fixture.caregiverAccountId,
    issuerAccountId: fixture.ownerAccountId,
    actions: ['view'],
    scopeKind: 'patient',
    categoryId: null,
    documentId: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date(Date.now() - 2 * 24 * 3600000),
    ...overrides,
  };
  await query(
    client,
    `INSERT INTO fmv.access_grants
    (id,patient_id,grantee_account_id,issuer_account_id,actions,scope_kind,category_id,document_id,expires_at,revoked_at,created_at)
    VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text[],$6,$7::uuid,$8::uuid,$9,$10,$11)`,
    [
      grant.id,
      grant.patientId,
      grant.granteeAccountId,
      grant.issuerAccountId,
      grant.actions,
      grant.scopeKind,
      grant.categoryId,
      grant.documentId,
      grant.expiresAt,
      grant.revokedAt,
      grant.createdAt,
    ],
  );
  return grant;
}

test('disposable PostgreSQL migration and runtime security lifecycle', async (t) => {
  const ownerUrl = localUrl('TEST_DATABASE_URL', 'fmv_owner');
  const runtimeUrl = localUrl('TEST_RUNTIME_URL', 'fmv_app');
  const clients = [];
  let temporary;
  let vault;
  async function stage(name, run) {
    let completed = false;
    await t.test(name, async () => {
      await run();
      completed = true;
    });
    assert.ok(completed, 'Database lifecycle stopped after a failed stage');
  }
  async function connect(url) {
    const client = new pg.Client({
      connectionString: url.href,
      connectionTimeoutMillis: 10_000,
    });
    clients.push(client);
    client.on('error', () => {});
    try {
      await client.connect();
    } catch {
      assert.fail('Expected local database connection failed');
    }
    return client;
  }
  try {
    const owner = await connect(ownerUrl);
    await stage('fresh baseline deploys once and is repeatable', async () => {
      const before = await query(
        owner,
        "SELECT to_regclass('fmv._prisma_migrations') IS NULL AS fresh",
      );
      assert.equal(
        before.rows[0].fresh,
        true,
        'Integration database must be fresh',
      );
      // Exercise an actual upgrade with retained P1.2 identities, not just a
      // fresh schema followed by creating identities after the new migrations.
      const upgradeDirectory = await mkdtemp(
        path.join(tmpdir(), 'fmv-upgrade-'),
      );
      const upgradeAccount = randomUUID(),
        upgradePerson = randomUUID();
      const upgradeDocument = randomUUID(),
        upgradeUpload = randomUUID();
      const upgradeKey = randomUUID().replaceAll('-', '');
      const upgradeBytes = Buffer.from(
        '%PDF-1.7\nRetained pre-generation original\n%%EOF\n',
      );
      const upgradeCreatedAt = new Date('2026-11-10T02:03:04.567Z');
      const upgradeObjects = new MemoryObjectStore();
      try {
        const migrations = path.join(upgradeDirectory, 'migrations');
        await mkdir(migrations);
        for (const name of [
          '20261105000100_foundation',
          '20261105000300_auth_sessions',
          '20261105000400_person_identity',
        ])
          await cp(
            path.join(server, 'prisma/migrations', name),
            path.join(migrations, name),
            { recursive: true },
          );
        await cp(
          path.join(server, 'prisma/migrations/migration_lock.toml'),
          path.join(migrations, 'migration_lock.toml'),
        );
        const config = path.join(upgradeDirectory, 'prisma.config.mjs');
        const configModule = pathToFileURL(
          createRequire(import.meta.url).resolve('prisma/config'),
        ).href;
        await writeFile(
          config,
          `import {defineConfig,env} from ${JSON.stringify(configModule)}; export default defineConfig({schema:${JSON.stringify(path.join(server, 'prisma/schema.prisma'))},migrations:{path:${JSON.stringify(migrations)}},datasource:{url:env('DATABASE_MIGRATION_URL')}});`,
        );
        assert.equal(
          prisma(ownerUrl, ['migrate', 'deploy', '--config', config]),
          0,
          'Prior P1.2 migrations must deploy',
        );
        await query(
          owner,
          'INSERT INTO fmv.app_accounts(id,issuer,subject) VALUES($1::uuid,$2,$3)',
          [upgradeAccount, 'https://upgrade.example.test', 'upgrade-subject'],
        );
        await query(
          owner,
          'INSERT INTO fmv.persons(id,owner_account_id,display_name) VALUES($1::uuid,$2::uuid,$3)',
          [upgradePerson, upgradeAccount, 'Retained upgrade fixture'],
        );
        for (const name of [
          '20261110000100_patient_permissions',
          '20261110000200_document_intake',
          '20261110000300_caregiver_approvals',
        ])
          await cp(
            path.join(server, 'prisma/migrations', name),
            path.join(migrations, name),
            { recursive: true },
          );
        assert.equal(
          prisma(ownerUrl, ['migrate', 'deploy', '--config', config]),
          0,
          'Pre-generation document schema must upgrade retained P1.2 identities',
        );
        const category = (
          await query(
            owner,
            "SELECT id FROM fmv.document_categories WHERE slug='unclassified'",
          )
        ).rows[0];
        await query(
          owner,
          `INSERT INTO fmv.documents(id,upload_id,patient_id,category_id,title,mime_type,bytes,sha256,idempotency_key,object_key,state,created_at)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'application/pdf',$6,$7,$8,$9,'ready',$10)`,
          [
            upgradeDocument,
            upgradeUpload,
            upgradePerson,
            category.id,
            'Retained original',
            upgradeBytes.length,
            createHash('sha256').update(upgradeBytes).digest('hex'),
            randomUUID(),
            upgradeKey,
            upgradeCreatedAt,
          ],
        );
        await upgradeObjects.put(upgradeKey, upgradeBytes, 'application/pdf');
      } finally {
        await rm(upgradeDirectory, { recursive: true, force: true });
      }
      assert.equal(
        prisma(ownerUrl, ['migrate', 'deploy']),
        0,
        'Initial migration must succeed',
      );
      async function baseline() {
        const result = await query(
          owner,
          'SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NULL AS active FROM fmv._prisma_migrations',
        );
        assert.equal(
          result.rowCount,
          10,
          'All ten foundation through document trash migrations must exist',
        );
        assert.equal(
          result.rows
            .map((row) => row.migration_name)
            .sort()
            .join(','),
          '20261105000100_foundation,20261105000300_auth_sessions,20261105000400_person_identity,20261110000100_patient_permissions,20261110000200_document_intake,20261110000300_caregiver_approvals,20261111000100_object_generations,20261111000200_patient_object_layout,20261112000100_document_display_titles,20261112000200_document_trash',
        );
        assert.ok(result.rows.every((row) => row.finished && row.active));
      }
      await baseline();
      const retained = await query(
        owner,
        'SELECT id,owner_account_id,display_name,storage_namespace FROM fmv.persons WHERE id=$1::uuid',
        [upgradePerson],
      );
      const upgradeNamespace = retained.rows[0].storage_namespace;
      assert.ok(upgradeNamespace);
      assert.notEqual(upgradeNamespace, upgradePerson);
      assert.deepEqual(retained.rows, [
        {
          id: upgradePerson,
          owner_account_id: upgradeAccount,
          display_name: 'Retained upgrade fixture',
          storage_namespace: upgradeNamespace,
        },
      ]);
      const backfilled = await query(
        owner,
        'SELECT object_key,document_id,created_at,retired_at FROM fmv.document_object_attempts WHERE document_id=$1::uuid',
        [upgradeDocument],
      );
      assert.equal(backfilled.rowCount, 1);
      assert.equal(backfilled.rows[0].object_key, upgradeKey);
      assert.equal(backfilled.rows[0].document_id, upgradeDocument);
      assert.equal(
        backfilled.rows[0].created_at.toISOString(),
        upgradeCreatedAt.toISOString(),
      );
      assert.equal(backfilled.rows[0].retired_at, null);
      const upgradeStore = new PrismaDocumentStore(runtimeUrl.href),
        upgradeAccess = new PrismaAccessStore(runtimeUrl.href);
      try {
        const permissions = new PermissionService(upgradeAccess);
        const core = new DocumentIntake(
          upgradeStore.asActor(upgradeAccount),
          upgradeObjects,
        );
        const read = await core.read(
          upgradePerson,
          upgradeDocument,
          'view',
          async (p, a, s) => {
            await permissions.require(
              {
                issuer: 'https://upgrade.example.test',
                subject: 'upgrade-subject',
              },
              p,
              a,
              s,
            );
          },
        );
        assert.equal(read.record.documentId, upgradeDocument);
        assert.equal(read.record.uploadId, upgradeUpload);
        assert.equal(read.record.patientId, upgradePerson);
        assert.equal(read.record.objectKey, upgradeKey);
        assert.deepEqual(read.bytes, upgradeBytes);
      } finally {
        await upgradeStore.onModuleDestroy();
        await upgradeAccess.onModuleDestroy();
      }
      assert.equal(
        prisma(ownerUrl, ['migrate', 'deploy']),
        0,
        'Repeated migration must succeed',
      );
      await baseline();
      const unchanged = await query(
        owner,
        'SELECT p.storage_namespace,d.object_key FROM fmv.persons p JOIN fmv.documents d ON d.patient_id=p.id WHERE d.id=$1::uuid',
        [upgradeDocument],
      );
      assert.deepEqual(unchanged.rows, [
        { storage_namespace: upgradeNamespace, object_key: upgradeKey },
      ]);
      const unchangedAttempt = await query(
        owner,
        'SELECT object_key FROM fmv.document_object_attempts WHERE document_id=$1::uuid',
        [upgradeDocument],
      );
      assert.deepEqual(unchangedAttempt.rows, [{ object_key: upgradeKey }]);
      const tables = await query(
        owner,
        "SELECT tablename FROM pg_tables WHERE schemaname = 'fmv' AND tablename <> '_prisma_migrations'",
      );
      assert.equal(
        tables.rows
          .map((row) => row.tablename)
          .sort()
          .join(','),
        'access_events,access_grant_dependencies,access_grants,access_invitations,app_accounts,auth_rate_limits,auth_sessions,document_categories,document_events,document_object_attempts,documents,persons',
        'Only reviewed application tables may exist',
      );
      const permissions = await query(
        owner,
        "SELECT EXISTS (SELECT 1 FROM pg_namespace n, LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a WHERE n.nspname = 'fmv' AND a.grantee = 0 AND a.privilege_type IN ('USAGE', 'CREATE')) AS public_access",
      );
      assert.equal(
        permissions.rows[0].public_access,
        false,
        'PUBLIC must have no fmv schema access',
      );
    });

    await stage('runtime connects with restricted privileges', async () => {
      const runtime = await connect(runtimeUrl);
      const result = await query(
        runtime,
        'SELECT current_user AS name, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user',
      );
      assert.deepEqual(result.rows, [
        {
          name: 'fmv_app',
          rolsuper: false,
          rolbypassrls: false,
          rolcreatedb: false,
          rolcreaterole: false,
        },
      ]);
      await denied(runtime, 'CREATE TABLE fmv.probe (id integer)');
      await denied(runtime, 'SELECT * FROM fmv._prisma_migrations');
    });

    await stage(
      'Prisma sessions enforce real row locks and durable consumption with restricted runtime role',
      async () => {
        const first = new PrismaAuthStore(runtimeUrl.href);
        const second = new PrismaAuthStore(runtimeUrl.href);
        const provider = new FakeProvider();
        const primary = new AuthService(authConfig, first, provider);
        const other = new AuthService(authConfig, second, provider);
        const runtime = await connect(runtimeUrl);
        try {
          const id = await primary.login(
            'fixture@example.test',
            'synthetic-password',
          );
          await Promise.all(
            Array.from({ length: 6 }, (_, i) =>
              (i % 2 ? other : primary).account(id),
            ),
          );
          const encrypted = await query(
            runtime,
            'SELECT payload FROM fmv.auth_sessions WHERE id_hash = $1',
            [digest(id)],
          );
          assert.equal(encrypted.rowCount, 1);
          assert.equal(
            encrypted.rows[0].payload.includes('synthetic-access'),
            false,
          );
          provider.failure = new ServiceUnavailableException();
          await assert.rejects(primary.logout(id));
          const consumed = await query(
            runtime,
            'SELECT count(*)::integer AS count FROM fmv.auth_sessions WHERE id_hash = $1',
            [digest(id)],
          );
          assert.equal(
            consumed.rows[0].count,
            0,
            'Logout deletion must survive provider failure',
          );
          await assert.rejects(other.account(id));
          provider.failure = null;
          const existing = await primary.login(
            'fixture@example.test',
            'synthetic-password',
          );
          const flow = await primary.begin('recover', 'fixture@example.test');
          const sent = provider.sent.at(-1);
          provider.codes.set('synthetic-db-recovery-code', {
            challenge: sent.challenge,
            email: 'fixture@example.test',
          });
          const state = new URL(sent.redirect).searchParams.get('state');
          const recovery = await primary.callback(
            flow.id,
            'synthetic-db-recovery-code',
            state,
          );
          provider.passwordFailure = new ServiceUnavailableException();
          await assert.rejects(
            primary.reset(recovery.id, 'synthetic-new-password'),
          );
          await assert.rejects(other.account(existing));
          await assert.rejects(
            other.reset(recovery.id, 'synthetic-new-password'),
          );
          assert.equal(
            provider.passwordCalls,
            1,
            'Consumed recovery cannot be reused',
          );
          const limitUntil = new Date(Date.now() + 60_000);
          const limits = await Promise.all(
            Array.from({ length: 10 }, () =>
              first.limit('synthetic-shared-bucket', limitUntil, 3),
            ),
          );
          assert.equal(
            limits.filter(Boolean).length,
            3,
            'Concurrent rate limits must be atomic',
          );
          const limitExpiry = await query(
            runtime,
            'SELECT expires_at FROM fmv.auth_rate_limits WHERE id=$1',
            ['synthetic-shared-bucket'],
          );
          assert.equal(
            limitExpiry.rows[0].expires_at.toISOString(),
            limitUntil.toISOString(),
            'Rate-limit expiry must preserve the exact UTC instant on a non-UTC database',
          );
          const policies = await query(
            runtime,
            "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'fmv' AND c.relname IN ('auth_sessions','auth_rate_limits')",
          );
          assert.equal(policies.rowCount, 2);
          assert.ok(
            policies.rows.every(
              (row) => row.relrowsecurity && row.relforcerowsecurity,
            ),
          );
          await denied(
            runtime,
            'ALTER TABLE fmv.auth_sessions DISABLE ROW LEVEL SECURITY',
          );
        } catch {
          assert.fail('Restricted auth session database verification failed');
        } finally {
          await primary.onModuleDestroy();
          await other.onModuleDestroy();
        }
      },
    );

    await stage(
      'Person onboarding is atomic, isolated, immutable and retry-safe across stores',
      async () => {
        const left = new PrismaPersonStore(runtimeUrl.href);
        const right = new PrismaPersonStore(runtimeUrl.href);
        const runtime = await connect(runtimeUrl);
        const principal = {
          issuer: 'https://fixture.supabase.co',
          subject: 'person-a',
        };
        try {
          assert.equal(await left.find(principal), null);
          const results = await Promise.all(
            Array.from({ length: 8 }, (_, i) =>
              (i % 2 ? left : right).create(principal, 'Fixture Person'),
            ),
          );
          assert.equal(new Set(results.map((p) => p.id)).size, 1);
          const person = results[0];
          assert.deepEqual(Object.keys(person).sort(), ['displayName', 'id']);
          const namespace = (
            await query(
              owner,
              'SELECT storage_namespace FROM fmv.persons WHERE id=$1::uuid',
              [person.id],
            )
          ).rows[0].storage_namespace;
          assert.match(
            namespace,
            /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
          );
          assert.notEqual(namespace, person.id);
          await rejectedSql(
            owner,
            'UPDATE fmv.persons SET storage_namespace=$1::uuid WHERE id=$2::uuid',
            [randomUUID(), person.id],
            '23514',
          );
          await query(
            owner,
            'UPDATE fmv.persons SET storage_namespace=storage_namespace WHERE id=$1::uuid',
            [person.id],
          );
          assert.deepEqual(
            await right.create(principal, 'Different name'),
            person,
          );
          const other = { ...principal, subject: 'person-b' };
          assert.equal(await right.find(other), null);
          const second = await right.create(other, 'Fixture Person');
          assert.notEqual(second.id, person.id);
          const namespaces = await query(
            owner,
            'SELECT id,storage_namespace FROM fmv.persons WHERE id=ANY($1::uuid[])',
            [[person.id, second.id]],
          );
          assert.equal(
            namespaces.rows.find((row) => row.id === person.id)
              .storage_namespace,
            namespace,
          );
          assert.notEqual(
            namespaces.rows.find((row) => row.id === second.id)
              .storage_namespace,
            namespace,
          );
          assert.deepEqual(Object.keys(await right.find(principal)).sort(), [
            'displayName',
            'id',
          ]);
          const otherIssuer = await right.create(
            { ...principal, issuer: 'https://other.supabase.co' },
            'Fixture Person',
          );
          assert.notEqual(otherIssuer.id, person.id);
          const counts = await query(
            owner,
            "SELECT count(*)::integer AS n FROM fmv.persons p JOIN fmv.app_accounts a ON a.id=p.owner_account_id WHERE a.subject IN ('person-a','person-b')",
          );
          assert.equal(counts.rows[0].n, 3);
          for (const sql of [
            "UPDATE fmv.persons SET display_name = 'Forbidden'",
            'DELETE FROM fmv.persons',
            'DELETE FROM fmv.app_accounts',
            "UPDATE fmv.app_accounts SET subject = 'Forbidden'",
            'ALTER TABLE fmv.persons DISABLE ROW LEVEL SECURITY',
            'ALTER TABLE fmv.app_accounts DISABLE ROW LEVEL SECURITY',
            'SELECT * FROM fmv._prisma_migrations',
          ])
            await denied(runtime, sql);
          const flags = await query(
            owner,
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'fmv' AND c.relname IN ('persons', 'app_accounts')",
          );
          assert.equal(flags.rowCount, 2);
          assert.ok(
            flags.rows.every(
              (row) => row.relrowsecurity && row.relforcerowsecurity,
            ),
          );
          // Force a Person insert failure after account insert, proving rollback
          // removes the partial account and a clean retry remains possible.
          await query(
            owner,
            `CREATE FUNCTION fmv.fail_person_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.display_name = 'Rollback probe' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`,
          );
          await query(
            owner,
            'CREATE TRIGGER person_failure_probe BEFORE INSERT ON fmv.persons FOR EACH ROW EXECUTE FUNCTION fmv.fail_person_probe()',
          );
          const retry = { ...principal, subject: 'person-rollback' };
          try {
            await assert.rejects(left.create(retry, 'Rollback probe'));
            const orphan = await query(
              owner,
              'SELECT count(*)::integer AS n FROM fmv.app_accounts WHERE subject = $1',
              [retry.subject],
            );
            assert.equal(orphan.rows[0].n, 0);
            assert.equal(await right.find(retry), null);
          } finally {
            await query(
              owner,
              'DROP TRIGGER person_failure_probe ON fmv.persons',
            );
            await query(owner, 'DROP FUNCTION fmv.fail_person_probe()');
          }
          const retried = await right.create(retry, 'Fixture Person');
          assert.deepEqual(await left.find(retry), retried);
        } finally {
          await left.onModuleDestroy();
          await right.onModuleDestroy();
        }
      },
    );

    await stage(
      'authoritative access stores enforce current patient grants across independent instances',
      async () => {
        const people = new PrismaPersonStore(runtimeUrl.href);
        const left = new PrismaAccessStore(runtimeUrl.href);
        const right = new PrismaAccessStore(runtimeUrl.href);
        const runtime = await connect(runtimeUrl);
        try {
          const principal = (subject) => ({
            issuer: 'https://fixture.supabase.co',
            subject,
          });
          const ownerPrincipal = principal('db-vault-owner');
          const caregiverPrincipal = principal('db-vault-caregiver');
          const strangerPrincipal = principal('db-vault-stranger');
          const patient = await people.create(
            ownerPrincipal,
            'Synthetic vault owner',
          );
          const caregiver = await people.create(
            caregiverPrincipal,
            'Synthetic vault caregiver',
          );
          const stranger = await people.create(
            strangerPrincipal,
            'Synthetic vault stranger',
          );
          const accounts = await query(
            runtime,
            'SELECT id,subject FROM fmv.app_accounts WHERE issuer=$1 AND subject=ANY($2::text[])',
            [
              ownerPrincipal.issuer,
              [
                ownerPrincipal.subject,
                caregiverPrincipal.subject,
                strangerPrincipal.subject,
              ],
            ],
          );
          const account = (p) =>
            accounts.rows.find((row) => row.subject === p.subject).id;
          const [category] = (
            await query(
              runtime,
              "SELECT id FROM fmv.document_categories WHERE slug='unclassified'",
            )
          ).rows;
          vault = {
            ownerPrincipal,
            caregiverPrincipal,
            strangerPrincipal,
            patientId: patient.id,
            caregiverPersonId: caregiver.id,
            strangerPersonId: stranger.id,
            ownerAccountId: account(ownerPrincipal),
            caregiverAccountId: account(caregiverPrincipal),
            strangerAccountId: account(strangerPrincipal),
            categoryId: category.id,
          };
          const services = [
            new PermissionService(left),
            new PermissionService(right),
          ];
          const grant = await insertGrant(runtime, vault);
          await insertGrant(runtime, vault, {
            actions: ['export'],
            revokedAt: new Date(),
          });
          await insertGrant(runtime, vault, {
            actions: ['upload'],
            expiresAt: new Date(Date.now() - 3600000),
          });
          const listing = await right.list(caregiverPrincipal);
          const shared = listing.find((row) => row.id === patient.id);
          assert.deepEqual(shared.capabilities, [
            { action: 'view', scope: { kind: 'patient' } },
          ]);
          assert.equal(shared.relationship, 'caregiver');
          assert.ok(
            listing.some(
              (row) => row.id === caregiver.id && row.relationship === 'self',
            ),
          );
          assert.ok(!listing.some((row) => row.id === stranger.id));
          assert.deepEqual(
            await left.list(principal('unregistered-account')),
            [],
          );
          assert.deepEqual(
            (await left.list(strangerPrincipal)).map((row) => row.id),
            [stranger.id],
          );
          for (const service of services) {
            await service.require(caregiverPrincipal, patient.id, 'view');
            for (const action of ['upload', 'edit', 'export', 'manage'])
              await accessDenied(() =>
                service.require(caregiverPrincipal, patient.id, action),
              );
            for (const action of ['view', 'upload', 'edit', 'export', 'manage'])
              await service.require(ownerPrincipal, patient.id, action);
            await accessDenied(() =>
              service.require(strangerPrincipal, patient.id, 'view'),
            );
          }
          await query(
            runtime,
            'UPDATE fmv.access_grants SET revoked_at=statement_timestamp() WHERE id=$1::uuid',
            [grant.id],
          );
          for (const service of services)
            await accessDenied(() =>
              service.require(caregiverPrincipal, patient.id, 'view'),
            );
          assert.ok(
            !(await left.list(caregiverPrincipal)).some(
              (row) => row.id === patient.id,
            ),
          );
        } finally {
          await people.onModuleDestroy();
          await left.onModuleDestroy();
          await right.onModuleDestroy();
        }
      },
    );

    await stage(
      'new authorization, document and audit tables enforce forced RLS and narrow runtime privileges',
      async () => {
        const runtime = await connect(runtimeUrl);
        const names = [
          'access_grants',
          'access_events',
          'access_grant_dependencies',
          'access_invitations',
          'document_categories',
          'documents',
          'document_events',
          'document_object_attempts',
        ];
        const flags = await query(
          runtime,
          "SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fmv' AND c.relname=ANY($1::text[])",
          [names],
        );
        assert.equal(flags.rowCount, names.length);
        assert.ok(
          flags.rows.every(
            (row) => row.relrowsecurity && row.relforcerowsecurity,
          ),
        );
        for (const sql of [
          'DELETE FROM fmv.access_grants',
          "UPDATE fmv.access_grants SET actions=ARRAY['export']::text[]",
          'UPDATE fmv.access_events SET occurred_at=statement_timestamp()',
          'DELETE FROM fmv.access_events',
          'UPDATE fmv.access_grant_dependencies SET parent_grant_id=grant_id',
          'DELETE FROM fmv.access_grant_dependencies',
          "UPDATE fmv.documents SET title='Forbidden'",
          'DELETE FROM fmv.documents',
          "INSERT INTO fmv.document_categories(slug,name) VALUES ('forbidden','Forbidden')",
          "UPDATE fmv.document_categories SET name='Forbidden'",
          'UPDATE fmv.document_events SET occurred_at=statement_timestamp()',
          'DELETE FROM fmv.document_events',
          'DELETE FROM fmv.document_object_attempts',
          "UPDATE fmv.document_object_attempts SET object_key=repeat('f',32)",
          'UPDATE fmv.document_object_attempts SET document_id=gen_random_uuid()',
          'UPDATE fmv.document_object_attempts SET created_at=statement_timestamp()',
          "UPDATE fmv.access_invitations SET actions=ARRAY['export']::text[]",
          "UPDATE fmv.access_invitations SET token_hash=repeat('f',64)",
          'DELETE FROM fmv.access_invitations',
          ...names.map(
            (name) => `ALTER TABLE fmv.${name} DISABLE ROW LEVEL SECURITY`,
          ),
        ])
          await denied(runtime, sql);
        const publicPrivileges = await query(
          owner,
          "SELECT count(*)::integer AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname='fmv' AND c.relname=ANY($1::text[]) AND a.grantee=0",
          [names],
        );
        assert.equal(publicPrivileges.rows[0].n, 0);
        const manifestPrivileges = await query(
          runtime,
          `SELECT
          has_table_privilege(current_user,'fmv.document_object_attempts','SELECT') AS can_read,
          has_table_privilege(current_user,'fmv.document_object_attempts','INSERT') AS can_insert,
          has_column_privilege(current_user,'fmv.document_object_attempts','retired_at','UPDATE') AS can_retire,
          has_column_privilege(current_user,'fmv.documents','object_key','UPDATE') AS can_switch_pointer`,
        );
        assert.deepEqual(manifestPrivileges.rows, [
          {
            can_read: true,
            can_insert: true,
            can_retire: true,
            can_switch_pointer: true,
          },
        ]);
      },
    );

    await stage(
      'Prisma intake uses real advisory locks, unique idempotency, integrity checks and append-only access audit',
      async () => {
        const first = new PrismaDocumentStore(runtimeUrl.href);
        const second = new PrismaDocumentStore(runtimeUrl.href);
        const access = new PrismaAccessStore(runtimeUrl.href);
        const runtime = await connect(runtimeUrl);
        class Objects extends MemoryObjectStore {
          beforePut;
          failPut = false;
          async put(...args) {
            await this.beforePut?.();
            await super.put(...args);
            if (this.failPut) throw new Error('synthetic partial write');
          }
        }
        const objects = new Objects();
        const permissions = new PermissionService(access);
        const authorize = async (p, a, s) => {
          await permissions.require(vault.ownerPrincipal, p, a, s);
        };
        const cores = [first, second].map(
          (store) =>
            new DocumentIntake(store.asActor(vault.ownerAccountId), objects),
        );
        const bytes = Buffer.from(
          '%PDF-1.7\nSynthetic database original\n%%EOF\n',
        );
        const declaration = {
          title: 'Synthetic database original',
          mimeType: 'application/pdf',
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          idempotencyKey: randomUUID(),
        };
        try {
          const begins = await Promise.all(
            Array.from({ length: 8 }, (_, i) =>
              cores[i % 2].begin(vault.patientId, declaration, authorize),
            ),
          );
          assert.equal(new Set(begins.map((row) => row.uploadId)).size, 1);
          const upload = begins[0];
          const count = await query(
            runtime,
            'SELECT count(*)::integer AS n FROM fmv.documents WHERE patient_id=$1::uuid AND idempotency_key=$2',
            [vault.patientId, declaration.idempotencyKey],
          );
          assert.equal(count.rows[0].n, 1);
          assert.deepEqual(await first.list(vault.patientId), []);
          await assert.rejects(
            cores[0].begin(
              vault.patientId,
              { ...declaration, title: 'Conflicting retry' },
              authorize,
            ),
            (error) => error.status === 409,
          );
          await assert.rejects(
            cores[0].content(
              vault.patientId,
              upload.uploadId,
              Buffer.from('x'.repeat(bytes.length)),
              authorize,
            ),
            (error) => error.status === 400,
          );
          const entered = deferred(),
            release = deferred();
          objects.beforePut = async () => {
            entered.resolve();
            await release.promise;
          };
          const writing = cores[0].content(
            vault.patientId,
            upload.uploadId,
            bytes,
            authorize,
          );
          await Promise.race([
            entered.promise,
            writing.then(() =>
              assert.fail('Expected the object-write barrier'),
            ),
          ]);
          let finalized = false;
          const finishing = cores[1]
            .finalize(vault.patientId, upload.uploadId, authorize)
            .then((value) => {
              finalized = true;
              return value;
            });
          let waiting = false;
          try {
            for (let attempt = 0; attempt < 500; attempt++) {
              const locks = await query(
                owner,
                "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) AS waiting",
              );
              if (locks.rows[0].waiting) {
                waiting = true;
                break;
              }
              await delay(10);
            }
            assert.equal(
              waiting,
              true,
              'A second API store must wait on the database advisory lock',
            );
            assert.equal(finalized, false);
          } finally {
            release.resolve();
          }
          const completed = await Promise.all([writing, finishing]);
          assert.deepEqual(
            completed.map((row) => row.state),
            ['pending', 'ready'],
          );
          objects.beforePut = undefined;
          assert.equal(
            (
              await cores[0].finalize(
                vault.patientId,
                upload.uploadId,
                authorize,
              )
            ).state,
            'ready',
          );
          const read = await cores[1].read(
            vault.patientId,
            upload.documentId,
            'view',
            authorize,
          );
          assert.deepEqual(read.bytes, bytes);
          const storageNamespace = (
            await query(
              owner,
              'SELECT storage_namespace FROM fmv.persons WHERE id=$1::uuid',
              [vault.patientId],
            )
          ).rows[0].storage_namespace;
          const objectPrefix = `originals/v1/${storageNamespace.replaceAll('-', '')}/${upload.documentId.replaceAll('-', '')}/`;
          assert.ok(read.record.objectKey.startsWith(objectPrefix));
          assert.match(
            read.record.objectKey.slice(objectPrefix.length),
            /^[a-f0-9]{32}$/,
          );
          assert.equal(read.record.objectKey.includes(vault.patientId), false);
          assert.equal((await first.list(vault.patientId)).length, 1);
          await first.audit(
            vault.patientId,
            upload.documentId,
            vault.ownerAccountId,
            'document.viewed',
          );
          await second.audit(
            vault.patientId,
            upload.documentId,
            vault.ownerAccountId,
            'document.exported',
          );
          const events = await query(
            runtime,
            "SELECT kind,retention_until-occurred_at=interval '90 days' AS retention FROM fmv.document_events WHERE document_id=$1::uuid ORDER BY kind",
            [upload.documentId],
          );
          assert.deepEqual(
            events.rows.map((row) => row.kind),
            ['document.exported', 'document.uploaded', 'document.viewed'],
          );
          assert.ok(events.rows.every((row) => row.retention));
          await insertGrant(runtime, vault, {
            scopeKind: 'document',
            documentId: upload.documentId,
          });
          // The promise is asserted below; attach a handler while observing the
          // database lock so an early adapter failure cannot become unhandled.
          void finishing.catch(() => {});
          await permissions.require(
            vault.caregiverPrincipal,
            vault.patientId,
            'view',
            { kind: 'document', documentId: upload.documentId },
          );
          await accessDenied(() =>
            permissions.require(
              vault.caregiverPrincipal,
              vault.patientId,
              'export',
              { kind: 'document', documentId: upload.documentId },
            ),
          );
          await rejectedSql(
            runtime,
            "INSERT INTO fmv.access_grants(id,patient_id,grantee_account_id,issuer_account_id,actions,scope_kind,document_id) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,ARRAY['view'],'document',$5::uuid)",
            [
              randomUUID(),
              vault.strangerPersonId,
              vault.caregiverAccountId,
              vault.ownerAccountId,
              upload.documentId,
            ],
            '23503',
          );
          const failure = await cores[0].begin(
            vault.patientId,
            { ...declaration, idempotencyKey: randomUUID() },
            authorize,
          );
          objects.failPut = true;
          await assert.rejects(
            cores[0].content(
              vault.patientId,
              failure.uploadId,
              bytes,
              authorize,
            ),
            (error) => error.status === 503,
          );
          const failed = await query(
            runtime,
            'SELECT state FROM fmv.documents WHERE upload_id=$1::uuid',
            [failure.uploadId],
          );
          assert.equal(failed.rows[0].state, 'failed');
          assert.equal((await first.list(vault.patientId)).length, 1);
          objects.failPut = false;
          await cores[1].content(
            vault.patientId,
            failure.uploadId,
            bytes,
            authorize,
          );
          await cores[1].finalize(vault.patientId, failure.uploadId, authorize);
          assert.equal((await first.list(vault.patientId)).length, 2);
          vault.documentId = upload.documentId;
          const timestampRecord = {
            ...read.record,
            uploadId: randomUUID(),
            documentId: randomUUID(),
            idempotencyKey: randomUUID(),
            objectKey: randomUUID().replaceAll('-', ''),
            state: 'pending',
            createdAt: new Date('2026-11-10T01:02:03.456Z'),
          };
          const persisted = await first
            .asActor(vault.ownerAccountId)
            .withLock(
              `timestamp-roundtrip:${timestampRecord.uploadId}`,
              async (metadata) => {
                await metadata.create(timestampRecord);
                return metadata.findUpload(
                  vault.patientId,
                  timestampRecord.uploadId,
                );
              },
            );
          assert.equal(
            persisted.createdAt.toISOString(),
            timestampRecord.createdAt.toISOString(),
          );
          const rawTimestamp = await query(
            runtime,
            'SELECT created_at FROM fmv.documents WHERE id=$1::uuid',
            [timestampRecord.documentId],
          );
          assert.equal(
            rawTimestamp.rows[0].created_at.toISOString(),
            timestampRecord.createdAt.toISOString(),
            'Document timestamps must preserve milliseconds and UTC offset across Prisma and PostgreSQL',
          );
          const foreignKey = await first
            .asActor(vault.ownerAccountId)
            .withLock(
              `foreign-generation:${timestampRecord.documentId}`,
              (metadata) => metadata.reserveObject(timestampRecord.documentId),
            );
          const reservedPrefix = `originals/v1/${storageNamespace.replaceAll('-', '')}/${timestampRecord.documentId.replaceAll('-', '')}/`;
          assert.ok(foreignKey.startsWith(reservedPrefix));
          assert.match(
            foreignKey.slice(reservedPrefix.length),
            /^[a-f0-9]{32}$/,
          );
          for (const malformedKey of [
            '../' + read.record.objectKey,
            objectPrefix + '../' + randomUUID().replaceAll('-', ''),
            objectPrefix + randomUUID(),
            objectPrefix.toUpperCase() + 'a'.repeat(32),
            objectPrefix + 'a'.repeat(31),
            objectPrefix + 'a'.repeat(32) + '/extra',
          ]) {
            await rejectedSql(
              runtime,
              'UPDATE fmv.documents SET object_key=$1 WHERE id=$2::uuid',
              [malformedKey, upload.documentId],
              '23514',
            );
            await rejectedSql(
              runtime,
              'INSERT INTO fmv.document_object_attempts(object_key,document_id) VALUES($1,$2::uuid)',
              [malformedKey, upload.documentId],
              '23514',
            );
          }
          for (const [invalidPointer, expectedCode] of [
            [randomUUID().replaceAll('-', ''), '23503'],
            [objectPrefix + randomUUID().replaceAll('-', ''), '23503'],
            [foreignKey, '23514'],
          ])
            await rejectedSql(
              runtime,
              'UPDATE fmv.documents SET object_key=$1 WHERE id=$2::uuid',
              [invalidPointer, upload.documentId],
              expectedCode,
            );
          const retainedPointer = await query(
            runtime,
            'SELECT object_key FROM fmv.documents WHERE id=$1::uuid',
            [upload.documentId],
          );
          assert.equal(
            retainedPointer.rows[0].object_key,
            read.record.objectKey,
          );
        } finally {
          await first.onModuleDestroy();
          await second.onModuleDestroy();
          await access.onModuleDestroy();
        }
      },
    );

    await stage(
      'display-title renames preserve originals, idempotency and atomic audit under restricted runtime grants',
      async () => {
        const store = new PrismaDocumentStore(runtimeUrl.href);
        const runtime = await connect(runtimeUrl);
        const objects = new MemoryObjectStore();
        const core = new DocumentIntake(
          store.asActor(vault.ownerAccountId),
          objects,
        );
        const bytes = Buffer.from(
          '%PDF-1.7\nSynthetic rename original\n%%EOF\n',
        );
        const declaration = {
          title: 'Immutable intake title',
          mimeType: 'application/pdf',
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          idempotencyKey: randomUUID(),
        };
        const authorize = async () => {};
        try {
          const upload = await core.begin(
            vault.patientId,
            declaration,
            authorize,
          );
          assert.equal(
            await store.rename(
              vault.patientId,
              upload.documentId,
              'Premature',
              vault.ownerAccountId,
              authorize,
            ),
            false,
          );
          await core.content(
            vault.patientId,
            upload.uploadId,
            bytes,
            authorize,
          );
          await core.finalize(vault.patientId, upload.uploadId, authorize);
          const snapshot = async () =>
            (
              await query(
                runtime,
                'SELECT title,display_title,object_key,bytes,sha256,created_at FROM fmv.documents WHERE id=$1::uuid',
                [upload.documentId],
              )
            ).rows[0];
          const original = await snapshot();
          assert.equal(original.display_title, null);
          for (const column of ['title', 'sha256', 'bytes', 'created_at']) {
            await denied(
              runtime,
              `UPDATE fmv.documents SET ${column}=${column} WHERE id='${upload.documentId}'::uuid`,
            );
          }
          for (const invalid of ['', 'x'.repeat(201)]) {
            await rejectedSql(
              runtime,
              'UPDATE fmv.documents SET display_title=$2 WHERE id=$1::uuid',
              [upload.documentId, invalid],
              '23514',
            );
          }
          let checks = 0;
          assert.equal(
            await store.rename(
              vault.patientId,
              upload.documentId,
              'Renamed record',
              vault.ownerAccountId,
              async () => {
                checks++;
              },
            ),
            true,
          );
          assert.equal(
            checks,
            2,
            'Authorization must run after the lock and before commit',
          );
          assert.deepEqual(await snapshot(), {
            ...original,
            display_title: 'Renamed record',
          });
          assert.deepEqual(
            await core.begin(vault.patientId, declaration, authorize),
            { ...upload, state: 'ready' },
          );
          assert.deepEqual(
            (
              await core.read(
                vault.patientId,
                upload.documentId,
                'view',
                authorize,
              )
            ).bytes,
            bytes,
          );
          const renameEvents = async () =>
            (
              await query(
                runtime,
                "SELECT actor_account_id,retention_until-occurred_at=interval '90 days' AS retention FROM fmv.document_events WHERE document_id=$1::uuid AND kind='document.renamed'",
                [upload.documentId],
              )
            ).rows;
          const events = await renameEvents();
          assert.equal(events.length, 1);
          assert.equal(events[0].actor_account_id, vault.ownerAccountId);
          assert.equal(events[0].retention, true);
          assert.equal(
            await store.rename(
              vault.patientId,
              upload.documentId,
              'Renamed record',
              vault.ownerAccountId,
              authorize,
            ),
            true,
          );
          assert.equal(
            (await renameEvents()).length,
            1,
            'Unchanged display titles must not create duplicate audit',
          );
          for (const denyAt of [1, 2]) {
            let calls = 0;
            await assert.rejects(
              store.rename(
                vault.patientId,
                upload.documentId,
                'Denied title',
                vault.ownerAccountId,
                async () => {
                  if (++calls === denyAt)
                    throw new Error('Synthetic authorization denial');
                },
              ),
            );
            assert.deepEqual(await snapshot(), {
              ...original,
              display_title: 'Renamed record',
            });
            assert.equal((await renameEvents()).length, 1);
          }
          assert.equal(
            await store.rename(
              vault.strangerPersonId,
              upload.documentId,
              'Foreign',
              vault.ownerAccountId,
              authorize,
            ),
            false,
          );
          assert.equal(
            await store.rename(
              vault.patientId,
              randomUUID(),
              'Missing',
              vault.ownerAccountId,
              authorize,
            ),
            false,
          );
          await query(
            owner,
            "CREATE FUNCTION fmv.fail_rename_event_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='document.renamed' THEN RAISE EXCEPTION 'synthetic rename audit failure'; END IF; RETURN NEW; END $$",
          );
          await query(
            owner,
            'CREATE TRIGGER rename_failure_probe BEFORE INSERT ON fmv.document_events FOR EACH ROW EXECUTE FUNCTION fmv.fail_rename_event_probe()',
          );
          try {
            await assert.rejects(
              store.rename(
                vault.patientId,
                upload.documentId,
                'Failed audit',
                vault.ownerAccountId,
                authorize,
              ),
            );
            assert.deepEqual(await snapshot(), {
              ...original,
              display_title: 'Renamed record',
            });
            assert.equal((await renameEvents()).length, 1);
          } finally {
            await query(
              owner,
              'DROP TRIGGER rename_failure_probe ON fmv.document_events',
            );
            await query(owner, 'DROP FUNCTION fmv.fail_rename_event_probe()');
          }
          assert.equal(
            await store.rename(
              vault.patientId,
              upload.documentId,
              'Clean retry',
              vault.ownerAccountId,
              authorize,
            ),
            true,
          );
          assert.equal((await renameEvents()).length, 2);
          assert.deepEqual(await snapshot(), {
            ...original,
            display_title: 'Clean retry',
          });
        } finally {
          await store.onModuleDestroy();
        }
      },
    );

    await stage(
      'durable object generations survive rollback, late DELETE and saturated upload pools',
      async () => {
        const first = new PrismaDocumentStore(runtimeUrl.href),
          second = new PrismaDocumentStore(runtimeUrl.href);
        const access = new PrismaAccessStore(runtimeUrl.href),
          permissions = new PermissionService(access);
        const runtime = await connect(runtimeUrl);
        class Objects extends MemoryObjectStore {
          puts = [];
          gets = [];
          removals = [];
          beforeRemove;
          async put(key, bytes, mime) {
            this.puts.push(key);
            await super.put(key, bytes, mime);
          }
          async get(key) {
            this.gets.push(key);
            return super.get(key);
          }
          async remove(key) {
            this.removals.push(key);
            await this.beforeRemove?.(key);
            await super.remove(key);
          }
        }
        const objects = new Objects(),
          actor = first.asActor(vault.ownerAccountId);
        const core = new DocumentIntake(actor, objects);
        const other = new DocumentIntake(
          second.asActor(vault.ownerAccountId),
          objects,
        );
        const bytes = Buffer.from(
          '%PDF-1.7\nSynthetic durable generation original\n%%EOF\n',
        );
        const declaration = () => ({
          title: 'Synthetic generation original',
          mimeType: 'application/pdf',
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          idempotencyKey: randomUUID(),
        });
        const authorize = async (p, a, s) => {
          await permissions.require(vault.ownerPrincipal, p, a, s);
        };
        try {
          const upload = await core.begin(
            vault.patientId,
            declaration(),
            authorize,
          );
          const initial = (
            await query(
              runtime,
              'SELECT object_key,state FROM fmv.documents WHERE id=$1::uuid',
              [upload.documentId],
            )
          ).rows[0];
          const rollbackCore = new DocumentIntake(
            {
              withLock: (key, work) =>
                actor.withLock(key, async (metadata) => {
                  await work(metadata);
                  throw new Error(
                    'Synthetic outer transaction rollback after object PUT',
                  );
                }),
            },
            objects,
          );
          await assert.rejects(
            rollbackCore.content(
              vault.patientId,
              upload.uploadId,
              bytes,
              authorize,
            ),
            (error) => error.status === 503,
          );
          const orphanKey = objects.puts.at(-1);
          const rolledBack = (
            await query(
              runtime,
              'SELECT object_key,state FROM fmv.documents WHERE id=$1::uuid',
              [upload.documentId],
            )
          ).rows[0];
          assert.deepEqual(rolledBack, initial);
          assert.notEqual(orphanKey, initial.object_key);
          const attempts = await query(
            runtime,
            'SELECT object_key,document_id,retired_at IS NOT NULL AS retired FROM fmv.document_object_attempts WHERE document_id=$1::uuid',
            [upload.documentId],
          );
          assert.equal(attempts.rowCount, 2);
          assert.equal(
            attempts.rows.find((row) => row.object_key === initial.object_key)
              .retired,
            true,
          );
          assert.equal(
            attempts.rows.find((row) => row.object_key === orphanKey).retired,
            false,
          );
          assert.ok(
            attempts.rows.every((row) => row.document_id === upload.documentId),
          );
          assert.deepEqual(await objects.get(orphanKey), bytes);
          const gets = objects.gets.length;
          await assert.rejects(
            other.finalize(vault.patientId, upload.uploadId, authorize),
            (error) => error.status === 409,
          );
          assert.equal(objects.gets.length, gets);
          await other.content(
            vault.patientId,
            upload.uploadId,
            bytes,
            authorize,
          );
          await other.finalize(vault.patientId, upload.uploadId, authorize);
          const recovered = (
            await query(
              runtime,
              'SELECT object_key,state FROM fmv.documents WHERE id=$1::uuid',
              [upload.documentId],
            )
          ).rows[0];
          assert.equal(recovered.state, 'ready');
          assert.notEqual(recovered.object_key, orphanKey);
          assert.notEqual(recovered.object_key, initial.object_key);
          assert.deepEqual(
            (
              await core.read(
                vault.patientId,
                upload.documentId,
                'view',
                authorize,
              )
            ).bytes,
            bytes,
          );
          await assert.rejects(
            actor.withLock(
              `refuse-ready-retirement:${upload.documentId}`,
              (metadata) =>
                metadata.retireObject(upload.documentId, recovered.object_key),
            ),
          );
          await rejectedSql(
            runtime,
            'UPDATE fmv.document_object_attempts SET retired_at=statement_timestamp() WHERE object_key=$1',
            [recovered.object_key],
            '23514',
          );
          for (const transition of ['NULL', "retired_at+interval '1 second'"])
            await rejectedSql(
              runtime,
              `UPDATE fmv.document_object_attempts SET retired_at=${transition} WHERE object_key=$1`,
              [initial.object_key],
              '23514',
            );
          const initialRetirement = (
            await query(
              runtime,
              'SELECT retired_at FROM fmv.document_object_attempts WHERE object_key=$1',
              [initial.object_key],
            )
          ).rows[0].retired_at;
          await query(
            runtime,
            'UPDATE fmv.document_object_attempts SET retired_at=retired_at WHERE object_key=$1',
            [initial.object_key],
          );
          const idempotentRetirement = (
            await query(
              runtime,
              'SELECT retired_at FROM fmv.document_object_attempts WHERE object_key=$1',
              [initial.object_key],
            )
          ).rows[0].retired_at;
          assert.equal(
            idempotentRetirement.toISOString(),
            initialRetirement.toISOString(),
          );
          await query(
            runtime,
            'UPDATE fmv.document_object_attempts SET retired_at=statement_timestamp() WHERE object_key=$1',
            [orphanKey],
          );
          const retained = await query(
            runtime,
            'SELECT object_key,document_id,retired_at FROM fmv.document_object_attempts WHERE document_id=$1::uuid',
            [upload.documentId],
          );
          assert.equal(retained.rowCount, 3);
          assert.ok(
            retained.rows.every((row) => row.document_id === upload.documentId),
          );
          assert.equal(
            retained.rows.find((row) => row.object_key === recovered.object_key)
              .retired_at,
            null,
          );
          assert.ok(retained.rows.some((row) => row.object_key === orphanKey));
          assert.ok(
            retained.rows.find((row) => row.object_key === orphanKey)
              .retired_at,
          );

          const parallelUploads = await Promise.all(
            Array.from({ length: 3 }, () =>
              core.begin(vault.patientId, declaration(), authorize),
            ),
          );
          const entered = deferred();
          let occupied = 0;
          const saturated = new DocumentIntake(
            {
              withLock: (key, work) =>
                actor.withLock(key, async (metadata) => {
                  if (++occupied === 3) entered.resolve();
                  await entered.promise;
                  return work(metadata);
                }),
            },
            objects,
          );
          const writes = parallelUploads.map((row) =>
            saturated.content(vault.patientId, row.uploadId, bytes, authorize),
          );
          try {
            await within(Promise.all(writes), 12000);
          } finally {
            entered.resolve();
            await Promise.allSettled(writes);
          }
          assert.equal(
            occupied,
            3,
            'All three upload transactions must occupy the outer pool together',
          );
          await within(
            Promise.all(
              parallelUploads.map((row) =>
                core.finalize(vault.patientId, row.uploadId, authorize),
              ),
            ),
            12000,
          );
          const parallelRows = await query(
            runtime,
            'SELECT id,object_key,state FROM fmv.documents WHERE id=ANY($1::uuid[])',
            [parallelUploads.map((row) => row.documentId)],
          );
          assert.equal(parallelRows.rowCount, 3);
          assert.ok(parallelRows.rows.every((row) => row.state === 'ready'));
          assert.equal(
            new Set(parallelRows.rows.map((row) => row.object_key)).size,
            3,
          );
          const parallelManifests = await query(
            runtime,
            'SELECT document_id,object_key,retired_at FROM fmv.document_object_attempts WHERE document_id=ANY($1::uuid[])',
            [parallelUploads.map((row) => row.documentId)],
          );
          assert.equal(parallelManifests.rowCount, 6);
          for (const row of parallelRows.rows) {
            const active = parallelManifests.rows.filter(
              (manifest) =>
                manifest.document_id === row.id && !manifest.retired_at,
            );
            assert.equal(active.length, 1);
            assert.equal(active[0].object_key, row.object_key);
            assert.deepEqual(await objects.get(row.object_key), bytes);
          }

          const delayed = await core.begin(
            vault.patientId,
            declaration(),
            authorize,
          );
          await core.content(
            vault.patientId,
            delayed.uploadId,
            bytes,
            authorize,
          );
          const oldKey = (
            await query(
              runtime,
              'SELECT object_key FROM fmv.documents WHERE id=$1::uuid',
              [delayed.documentId],
            )
          ).rows[0].object_key;
          const release = deferred();
          let lateDelete;
          objects.beforeRemove = async (key) => {
            if (key !== oldKey) return;
            lateDelete = release.promise.then(() =>
              MemoryObjectStore.prototype.remove.call(objects, key),
            );
            throw new Error('Synthetic DELETE timeout before late completion');
          };
          try {
            await assert.rejects(
              core.content(vault.patientId, delayed.uploadId, bytes, authorize),
              (error) => error.status === 503,
            );
            assert.ok(lateDelete);
            objects.beforeRemove = undefined;
            await other.content(
              vault.patientId,
              delayed.uploadId,
              bytes,
              authorize,
            );
            await other.finalize(vault.patientId, delayed.uploadId, authorize);
            const latest = (
              await query(
                runtime,
                'SELECT object_key,state FROM fmv.documents WHERE id=$1::uuid',
                [delayed.documentId],
              )
            ).rows[0];
            assert.equal(latest.state, 'ready');
            assert.notEqual(latest.object_key, oldKey);
            release.resolve();
            await lateDelete;
            assert.deepEqual(
              (
                await core.read(
                  vault.patientId,
                  delayed.documentId,
                  'export',
                  authorize,
                )
              ).bytes,
              bytes,
            );
            assert.ok(!objects.removals.includes(latest.object_key));
            const generations = await query(
              runtime,
              'SELECT object_key,document_id,retired_at IS NOT NULL AS retired FROM fmv.document_object_attempts WHERE document_id=$1::uuid',
              [delayed.documentId],
            );
            assert.ok(
              generations.rows.every(
                (row) => row.document_id === delayed.documentId,
              ),
            );
            assert.equal(
              generations.rows.find((row) => row.object_key === oldKey).retired,
              true,
            );
            assert.equal(
              generations.rows.find(
                (row) => row.object_key === latest.object_key,
              ).retired,
              false,
            );
          } finally {
            release.resolve();
            await lateDelete;
          }
          assert.equal(
            new Set(objects.puts).size,
            objects.puts.length,
            'No external PUT may reuse an object generation',
          );
        } finally {
          await first.onModuleDestroy();
          await second.onModuleDestroy();
          await access.onModuleDestroy();
        }
      },
    );

    await stage(
      'caregiver invitations and requests require explicit atomic approval and prevent replay and expiry',
      async () => {
        const first = new CaregiverService(runtimeUrl.href),
          second = new CaregiverService(runtimeUrl.href);
        const access = new PrismaAccessStore(runtimeUrl.href),
          permissions = new PermissionService(access);
        const runtime = await connect(runtimeUrl);
        const proposal = {
          actions: ['view'],
          scope: { kind: 'patient' },
          expiresInHours: 24,
        };
        try {
          const invitation = await first.create(
            vault.ownerPrincipal,
            vault.patientId,
            proposal,
          );
          const secret = await query(
            runtime,
            'SELECT token_hash FROM fmv.access_invitations WHERE id=$1::uuid',
            [invitation.id],
          );
          assert.equal(
            secret.rows[0].token_hash,
            hashInvitationToken(invitation.token),
          );
          assert.notEqual(secret.rows[0].token_hash, invitation.token);
          assert.equal(
            (await second.inspect(vault.caregiverPrincipal, invitation.token))
              .kind,
            'invitation',
          );
          await accessDenied(() =>
            permissions.require(
              vault.caregiverPrincipal,
              vault.patientId,
              'view',
            ),
          );
          await second.claim(vault.caregiverPrincipal, invitation.token);
          await accessDenied(() =>
            first.claim(vault.strangerPrincipal, invitation.token),
          );
          await accessDenied(() =>
            permissions.require(
              vault.caregiverPrincipal,
              vault.patientId,
              'view',
            ),
          );
          const approvals = await Promise.allSettled([
            first.approve(vault.ownerPrincipal, vault.patientId, invitation.id),
            second.approve(
              vault.ownerPrincipal,
              vault.patientId,
              invitation.id,
            ),
          ]);
          assert.equal(
            approvals.filter((result) => result.status === 'fulfilled').length,
            1,
          );
          const rejected = approvals.find(
            (result) => result.status === 'rejected',
          );
          assert.equal(rejected.reason.getStatus?.(), 404);
          const accepted = approvals.find(
            (result) => result.status === 'fulfilled',
          ).value;
          await permissions.require(
            vault.caregiverPrincipal,
            vault.patientId,
            'view',
          );
          await accessDenied(() =>
            permissions.require(
              vault.caregiverPrincipal,
              vault.patientId,
              'export',
            ),
          );
          const grant = await query(
            runtime,
            'SELECT actions,grantee_account_id,expires_at FROM fmv.access_grants WHERE id=$1::uuid',
            [accepted.grantId],
          );
          assert.deepEqual(grant.rows[0].actions, ['view']);
          assert.equal(
            grant.rows[0].grantee_account_id,
            vault.caregiverAccountId,
          );
          assert.equal(
            grant.rows[0].expires_at.toISOString(),
            invitation.expiresAt,
          );
          const revokedAuditBefore = await query(
            runtime,
            "SELECT count(*)::integer AS n FROM fmv.access_events WHERE patient_id=$1::uuid AND kind='invitation.revoked'",
            [vault.patientId],
          );
          await accessDenied(() =>
            first.revoke(
              vault.ownerPrincipal,
              vault.patientId,
              invitation.id,
              true,
            ),
          );
          const revokedAuditAfter = await query(
            runtime,
            "SELECT count(*)::integer AS n FROM fmv.access_events WHERE patient_id=$1::uuid AND kind='invitation.revoked'",
            [vault.patientId],
          );
          assert.equal(
            revokedAuditAfter.rows[0].n,
            revokedAuditBefore.rows[0].n,
            'An accepted invitation cannot emit a false revocation event',
          );
          const stillAccepted = await query(
            runtime,
            'SELECT state FROM fmv.access_invitations WHERE id=$1::uuid',
            [invitation.id],
          );
          assert.equal(stillAccepted.rows[0].state, 'accepted');
          await permissions.require(
            vault.caregiverPrincipal,
            vault.patientId,
            'view',
          );
          await Promise.all([
            first.revoke(
              vault.ownerPrincipal,
              vault.patientId,
              accepted.grantId,
            ),
            second.revoke(
              vault.ownerPrincipal,
              vault.patientId,
              accepted.grantId,
            ),
          ]);
          const grantRevocations = await query(
            runtime,
            "SELECT count(*)::integer AS n FROM fmv.access_events WHERE kind='grant.revoked' AND grant_id=$1::uuid",
            [accepted.grantId],
          );
          assert.equal(
            grantRevocations.rows[0].n,
            1,
            'Concurrent grant revocation must append exactly one event',
          );
          await accessDenied(() =>
            permissions.require(
              vault.caregiverPrincipal,
              vault.patientId,
              'view',
            ),
          );
          const request = await second.create(vault.caregiverPrincipal, null, {
            ...proposal,
            actions: ['export'],
          });
          assert.equal(
            (await first.inspect(vault.ownerPrincipal, request.token)).kind,
            'request',
          );
          await accessDenied(() =>
            permissions.require(
              vault.caregiverPrincipal,
              vault.patientId,
              'export',
            ),
          );
          const requested = await first.approve(
            vault.ownerPrincipal,
            vault.patientId,
            request.token,
            true,
          );
          await permissions.require(
            vault.caregiverPrincipal,
            vault.patientId,
            'export',
          );
          await accessDenied(() =>
            permissions.require(
              vault.caregiverPrincipal,
              vault.patientId,
              'view',
            ),
          );
          await accessDenied(() =>
            second.approve(
              vault.ownerPrincipal,
              vault.patientId,
              request.token,
              true,
            ),
          );
          await first.revoke(
            vault.ownerPrincipal,
            vault.patientId,
            requested.grantId,
          );
          for (const claimed of [false, true]) {
            const expired = await first.create(
              vault.ownerPrincipal,
              vault.patientId,
              proposal,
            );
            if (claimed)
              await second.claim(vault.caregiverPrincipal, expired.token);
            await query(
              owner,
              "UPDATE fmv.access_invitations SET created_at=statement_timestamp()-interval '2 hours',expires_at=statement_timestamp()-interval '1 hour' WHERE id=$1::uuid",
              [expired.id],
            );
            if (claimed)
              await accessDenied(() =>
                first.approve(
                  vault.ownerPrincipal,
                  vault.patientId,
                  expired.id,
                ),
              );
            else
              await accessDenied(() =>
                second.claim(vault.caregiverPrincipal, expired.token),
              );
          }
          const revoked = await first.create(
            vault.ownerPrincipal,
            vault.patientId,
            proposal,
          );
          const beforeDoubleRevoke = await query(
            runtime,
            "SELECT count(*)::integer AS n FROM fmv.access_events WHERE patient_id=$1::uuid AND kind='invitation.revoked'",
            [vault.patientId],
          );
          await Promise.all([
            first.revoke(
              vault.ownerPrincipal,
              vault.patientId,
              revoked.id,
              true,
            ),
            second.revoke(
              vault.ownerPrincipal,
              vault.patientId,
              revoked.id,
              true,
            ),
          ]);
          const afterDoubleRevoke = await query(
            runtime,
            "SELECT count(*)::integer AS n FROM fmv.access_events WHERE patient_id=$1::uuid AND kind='invitation.revoked'",
            [vault.patientId],
          );
          assert.equal(
            afterDoubleRevoke.rows[0].n,
            beforeDoubleRevoke.rows[0].n + 1,
            'Concurrent repeated revocation must append exactly one event',
          );
          await accessDenied(() =>
            second.claim(vault.caregiverPrincipal, revoked.token),
          );
        } finally {
          await first.onModuleDestroy();
          await second.onModuleDestroy();
          await access.onModuleDestroy();
        }
      },
    );

    await stage(
      'invitation claim and approval/revocation races serialize across independent services',
      async () => {
        const first = new CaregiverService(runtimeUrl.href),
          second = new CaregiverService(runtimeUrl.href);
        const runtime = await connect(runtimeUrl);
        const proposal = {
          actions: ['view'],
          scope: { kind: 'patient' },
          expiresInHours: 1,
        };
        try {
          const invitation = await first.create(
            vault.ownerPrincipal,
            vault.patientId,
            proposal,
          );
          const claims = await Promise.allSettled([
            first.claim(vault.caregiverPrincipal, invitation.token),
            second.claim(vault.strangerPrincipal, invitation.token),
          ]);
          assert.equal(
            claims.filter((result) => result.status === 'fulfilled').length,
            1,
          );
          assert.equal(
            claims
              .find((result) => result.status === 'rejected')
              .reason.getStatus?.(),
            404,
          );
          const winner =
            claims[0].status === 'fulfilled'
              ? vault.caregiverAccountId
              : vault.strangerAccountId;
          const recipient = await query(
            runtime,
            'SELECT state,recipient_account_id FROM fmv.access_invitations WHERE id=$1::uuid',
            [invitation.id],
          );
          assert.equal(recipient.rows[0].state, 'claimed');
          assert.equal(recipient.rows[0].recipient_account_id, winner);
          await first.revoke(
            vault.ownerPrincipal,
            vault.patientId,
            invitation.id,
            true,
          );
          const raced = await first.create(
            vault.ownerPrincipal,
            vault.patientId,
            proposal,
          );
          await second.claim(vault.strangerPrincipal, raced.token);
          const outcomes = await Promise.allSettled([
            first.approve(vault.ownerPrincipal, vault.patientId, raced.id),
            second.revoke(
              vault.ownerPrincipal,
              vault.patientId,
              raced.id,
              true,
            ),
          ]);
          assert.equal(
            outcomes.filter((result) => result.status === 'fulfilled').length,
            1,
          );
          assert.equal(
            outcomes
              .find((result) => result.status === 'rejected')
              .reason.getStatus?.(),
            404,
          );
          const row = await query(
            runtime,
            'SELECT state FROM fmv.access_invitations WHERE id=$1::uuid',
            [raced.id],
          );
          if (outcomes[0].status === 'fulfilled') {
            assert.equal(row.rows[0].state, 'accepted');
            const accepted = outcomes[0].value;
            const grant = await query(
              runtime,
              'SELECT revoked_at FROM fmv.access_grants WHERE id=$1::uuid',
              [accepted.grantId],
            );
            assert.equal(grant.rows[0].revoked_at, null);
            await first.revoke(
              vault.ownerPrincipal,
              vault.patientId,
              accepted.grantId,
            );
          } else {
            assert.equal(row.rows[0].state, 'revoked');
            await accessDenied(() =>
              first.approve(vault.ownerPrincipal, vault.patientId, raced.id),
            );
          }
        } finally {
          await first.onModuleDestroy();
          await second.onModuleDestroy();
        }
      },
    );

    await stage(
      'manager-approved grants inherit exact authority; owner-approved grants remain independent after issuer revocation',
      async () => {
        const service = new CaregiverService(runtimeUrl.href),
          other = new CaregiverService(runtimeUrl.href);
        const access = new PrismaAccessStore(runtimeUrl.href),
          permissions = new PermissionService(access);
        const runtime = await connect(runtimeUrl);
        const proposal = {
          actions: ['view'],
          scope: { kind: 'category', categoryId: vault.categoryId },
          expiresInHours: 1,
        };
        try {
          const parent = await insertGrant(runtime, vault, {
            actions: ['manage', 'view'],
            scopeKind: 'category',
            categoryId: vault.categoryId,
            expiresAt: new Date(Date.now() + 4 * 3600000),
          });
          const independent = await insertGrant(runtime, vault, {
            granteeAccountId: vault.strangerAccountId,
            actions: ['export'],
            scopeKind: 'document',
            documentId: vault.documentId,
          });
          await accessDenied(() =>
            service.create(vault.caregiverPrincipal, vault.patientId, {
              ...proposal,
              actions: ['export'],
            }),
          );
          await accessDenied(() =>
            service.create(vault.caregiverPrincipal, vault.patientId, {
              ...proposal,
              scope: { kind: 'patient' },
            }),
          );
          const invitation = await service.create(
            vault.caregiverPrincipal,
            vault.patientId,
            proposal,
          );
          const hiddenCategoryId = randomUUID();
          await query(
            owner,
            'INSERT INTO fmv.document_categories(id,slug,name) VALUES($1::uuid,$2,$3)',
            [
              hiddenCategoryId,
              `scope-${hiddenCategoryId}`,
              'Hidden synthetic category',
            ],
          );
          const hiddenGrant = await insertGrant(runtime, vault, {
            scopeKind: 'category',
            categoryId: hiddenCategoryId,
          });
          const hiddenInvitation = await service.create(
            vault.ownerPrincipal,
            vault.patientId,
            {
              ...proposal,
              scope: { kind: 'category', categoryId: hiddenCategoryId },
            },
          );
          const managerList = await service.list(
            vault.caregiverPrincipal,
            vault.patientId,
          );
          assert.ok(
            managerList.grants.some(
              (row) =>
                row.id === parent.id &&
                row.recipientPersonId === vault.caregiverPersonId,
            ),
          );
          assert.ok(
            managerList.grants.some(
              (row) =>
                row.id === independent.id &&
                row.recipientPersonId === vault.strangerPersonId,
            ),
          );
          assert.ok(
            managerList.invitations.some((row) => row.id === invitation.id),
          );
          assert.ok(
            !managerList.grants.some((row) => row.id === hiddenGrant.id),
          );
          assert.ok(
            !managerList.invitations.some(
              (row) => row.id === hiddenInvitation.id,
            ),
          );
          for (const row of [
            ...managerList.grants,
            ...managerList.invitations,
          ]) {
            assert.notEqual(row.scope.kind, 'patient');
            if (row.scope.kind === 'category')
              assert.equal(row.scope.categoryId, vault.categoryId);
            else assert.equal(row.scope.documentId, vault.documentId);
          }
          await other.claim(vault.strangerPrincipal, invitation.token);
          // The explicit approver issues the grant. Owner approval establishes
          // independent owner authority; manager approval inherits parent authority.
          const ownerApproved = await service.approve(
            vault.ownerPrincipal,
            vault.patientId,
            invitation.id,
          );
          const directEdges = await query(
            runtime,
            'SELECT parent_grant_id FROM fmv.access_grant_dependencies WHERE grant_id=$1::uuid',
            [ownerApproved.grantId],
          );
          assert.equal(directEdges.rowCount, 0);
          const delegatedInvitation = await service.create(
            vault.caregiverPrincipal,
            vault.patientId,
            proposal,
          );
          await other.claim(vault.strangerPrincipal, delegatedInvitation.token);
          const child = await service.approve(
            vault.caregiverPrincipal,
            vault.patientId,
            delegatedInvitation.id,
          );
          const edge = await query(
            runtime,
            'SELECT parent_grant_id FROM fmv.access_grant_dependencies WHERE grant_id=$1::uuid',
            [child.grantId],
          );
          assert.ok(edge.rows.some((row) => row.parent_grant_id === parent.id));
          await permissions.require(
            vault.strangerPrincipal,
            vault.patientId,
            'view',
            { kind: 'category', categoryId: vault.categoryId },
          );
          await service.revoke(
            vault.ownerPrincipal,
            vault.patientId,
            parent.id,
          );
          await accessDenied(() =>
            service.list(vault.caregiverPrincipal, vault.patientId),
          );
          const states = await query(
            runtime,
            'SELECT id,revoked_at IS NOT NULL AS revoked FROM fmv.access_grants WHERE id=ANY($1::uuid[])',
            [[parent.id, child.grantId, independent.id, ownerApproved.grantId]],
          );
          assert.equal(
            states.rows.find((row) => row.id === parent.id).revoked,
            true,
          );
          assert.equal(
            states.rows.find((row) => row.id === child.grantId).revoked,
            true,
          );
          assert.equal(
            states.rows.find((row) => row.id === independent.id).revoked,
            false,
          );
          assert.equal(
            states.rows.find((row) => row.id === ownerApproved.grantId).revoked,
            false,
          );
          await permissions.require(
            vault.strangerPrincipal,
            vault.patientId,
            'view',
            { kind: 'category', categoryId: vault.categoryId },
          );
          await service.revoke(
            vault.ownerPrincipal,
            vault.patientId,
            ownerApproved.grantId,
          );
          await accessDenied(() =>
            permissions.require(
              vault.strangerPrincipal,
              vault.patientId,
              'view',
              { kind: 'category', categoryId: vault.categoryId },
            ),
          );
          await permissions.require(
            vault.strangerPrincipal,
            vault.patientId,
            'export',
            { kind: 'document', documentId: vault.documentId },
          );
          const short = await insertGrant(runtime, vault, {
            actions: ['manage', 'view'],
            scopeKind: 'category',
            categoryId: vault.categoryId,
            expiresAt: new Date(Date.now() + 30 * 60000),
          });
          await accessDenied(() =>
            service.create(vault.caregiverPrincipal, vault.patientId, proposal),
          );
          await service.revoke(vault.ownerPrincipal, vault.patientId, short.id);
          for (const shortAction of ['manage', 'view']) {
            const supports = [];
            for (const action of ['manage', 'view'])
              supports.push(
                await insertGrant(runtime, vault, {
                  actions: [action],
                  scopeKind: 'category',
                  categoryId: vault.categoryId,
                  expiresAt: new Date(
                    Date.now() +
                      (action === shortAction ? 30 * 60000 : 4 * 3600000),
                  ),
                }),
              );
            await accessDenied(() =>
              service.create(
                vault.caregiverPrincipal,
                vault.patientId,
                proposal,
              ),
            );
            for (const support of supports)
              await service.revoke(
                vault.ownerPrincipal,
                vault.patientId,
                support.id,
              );
          }
          const supports = [];
          for (const action of ['manage', 'view'])
            supports.push(
              await insertGrant(runtime, vault, {
                actions: [action],
                scopeKind: 'category',
                categoryId: vault.categoryId,
                expiresAt: new Date(Date.now() + 4 * 3600000),
              }),
            );
          const supportedInvitation = await service.create(
            vault.caregiverPrincipal,
            vault.patientId,
            proposal,
          );
          await other.claim(vault.strangerPrincipal, supportedInvitation.token);
          const supportedChild = await service.approve(
            vault.caregiverPrincipal,
            vault.patientId,
            supportedInvitation.id,
          );
          const supportEdges = await query(
            runtime,
            'SELECT parent_grant_id FROM fmv.access_grant_dependencies WHERE grant_id=$1::uuid',
            [supportedChild.grantId],
          );
          assert.deepEqual(
            supportEdges.rows.map((row) => row.parent_grant_id).sort(),
            supports.map((support) => support.id).sort(),
          );
          await service.revoke(
            vault.ownerPrincipal,
            vault.patientId,
            supports[0].id,
          );
          const childState = await query(
            runtime,
            'SELECT revoked_at IS NOT NULL AS revoked FROM fmv.access_grants WHERE id=$1::uuid',
            [supportedChild.grantId],
          );
          assert.equal(childState.rows[0].revoked, true);
          await service.revoke(
            vault.ownerPrincipal,
            vault.patientId,
            supports[1].id,
          );
          const issuer = await insertGrant(runtime, vault, {
            actions: ['manage', 'view'],
            scopeKind: 'category',
            categoryId: vault.categoryId,
            expiresAt: new Date(Date.now() + 4 * 3600000),
          });
          const pending = await service.create(
            vault.caregiverPrincipal,
            vault.patientId,
            proposal,
          );
          await other.claim(vault.strangerPrincipal, pending.token);
          await service.revoke(
            vault.ownerPrincipal,
            vault.patientId,
            issuer.id,
          );
          await accessDenied(() =>
            service.approve(vault.ownerPrincipal, vault.patientId, pending.id),
          );
          const raceParent = await insertGrant(runtime, vault, {
            actions: ['manage', 'view'],
            scopeKind: 'category',
            categoryId: vault.categoryId,
            expiresAt: new Date(Date.now() + 4 * 3600000),
          });
          const raceInvitation = await service.create(
            vault.caregiverPrincipal,
            vault.patientId,
            proposal,
          );
          await other.claim(vault.strangerPrincipal, raceInvitation.token);
          const raced = await Promise.allSettled([
            service.approve(
              vault.caregiverPrincipal,
              vault.patientId,
              raceInvitation.id,
            ),
            other.revoke(vault.ownerPrincipal, vault.patientId, raceParent.id),
          ]);
          assert.equal(raced[1].status, 'fulfilled');
          if (raced[0].status === 'fulfilled') {
            const child = await query(
              runtime,
              'SELECT revoked_at IS NOT NULL AS revoked FROM fmv.access_grants WHERE id=$1::uuid',
              [raced[0].value.grantId],
            );
            assert.equal(
              child.rows[0].revoked,
              true,
              'Approval winning the lock must still be caught by subsequent parent revocation',
            );
          } else assert.equal(raced[0].reason.getStatus?.(), 404);
          await accessDenied(() =>
            permissions.require(
              vault.strangerPrincipal,
              vault.patientId,
              'view',
              { kind: 'category', categoryId: vault.categoryId },
            ),
          );
        } finally {
          await service.onModuleDestroy();
          await other.onModuleDestroy();
          await access.onModuleDestroy();
        }
      },
    );

    await stage(
      'approval audit failure rolls back grant, dependency and token transition and clean retry keeps Person IDs',
      async () => {
        const service = new CaregiverService(runtimeUrl.href);
        const runtime = await connect(runtimeUrl);
        try {
          await insertGrant(runtime, vault, {
            actions: ['manage', 'edit'],
            expiresAt: new Date(Date.now() + 4 * 3600000),
          });
          const invitation = await service.create(
            vault.ownerPrincipal,
            vault.patientId,
            {
              actions: ['edit'],
              scope: { kind: 'patient' },
              expiresInHours: 1,
            },
          );
          await service.claim(vault.strangerPrincipal, invitation.token);
          const before = await query(
            runtime,
            'SELECT count(*)::integer AS n FROM fmv.access_grants',
          );
          const dependenciesBefore = await query(
            runtime,
            'SELECT count(*)::integer AS n FROM fmv.access_grant_dependencies',
          );
          await query(
            owner,
            "CREATE FUNCTION fmv.fail_approval_event_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='grant.created' THEN RAISE EXCEPTION 'synthetic approval audit failure'; END IF; RETURN NEW; END $$",
          );
          await query(
            owner,
            'CREATE TRIGGER approval_failure_probe BEFORE INSERT ON fmv.access_events FOR EACH ROW EXECUTE FUNCTION fmv.fail_approval_event_probe()',
          );
          try {
            await assert.rejects(
              service.approve(
                vault.caregiverPrincipal,
                vault.patientId,
                invitation.id,
              ),
              unavailable(503),
            );
            const after = await query(
              runtime,
              'SELECT count(*)::integer AS n FROM fmv.access_grants',
            );
            assert.equal(after.rows[0].n, before.rows[0].n);
            const dependenciesAfter = await query(
              runtime,
              'SELECT count(*)::integer AS n FROM fmv.access_grant_dependencies',
            );
            assert.equal(
              dependenciesAfter.rows[0].n,
              dependenciesBefore.rows[0].n,
            );
            const invitationState = await query(
              runtime,
              'SELECT state FROM fmv.access_invitations WHERE id=$1::uuid',
              [invitation.id],
            );
            assert.equal(invitationState.rows[0].state, 'claimed');
          } finally {
            await query(
              owner,
              'DROP TRIGGER approval_failure_probe ON fmv.access_events',
            );
            await query(owner, 'DROP FUNCTION fmv.fail_approval_event_probe()');
          }
          const retried = await service.approve(
            vault.caregiverPrincipal,
            vault.patientId,
            invitation.id,
          );
          assert.ok(retried.grantId);
          await accessDenied(() =>
            service.approve(
              vault.ownerPrincipal,
              vault.patientId,
              invitation.id,
            ),
          );
          const identities = await query(
            runtime,
            'SELECT id,owner_account_id FROM fmv.persons WHERE id=ANY($1::uuid[])',
            [
              [
                vault.patientId,
                vault.caregiverPersonId,
                vault.strangerPersonId,
              ],
            ],
          );
          assert.equal(identities.rowCount, 3);
          assert.equal(
            identities.rows.find((row) => row.id === vault.patientId)
              .owner_account_id,
            vault.ownerAccountId,
          );
          assert.equal(
            identities.rows.find((row) => row.id === vault.caregiverPersonId)
              .owner_account_id,
            vault.caregiverAccountId,
          );
          assert.equal(
            identities.rows.find((row) => row.id === vault.strangerPersonId)
              .owner_account_id,
            vault.strangerAccountId,
          );
        } finally {
          await service.onModuleDestroy();
        }
      },
    );

    await stage(
      'DEL-01 trash preserves originals, denies upload replay and atomically restores within the database deadline',
      async () => {
        const store = new PrismaDocumentStore(runtimeUrl.href);
        const other = new PrismaDocumentStore(runtimeUrl.href);
        const access = new PrismaAccessStore(runtimeUrl.href);
        const runtime = await connect(runtimeUrl);
        class Objects extends MemoryObjectStore {
          calls = 0;
          beforeGet;
          async get(...args) {
            this.calls++;
            await this.beforeGet?.();
            return super.get(...args);
          }
          async put(...args) {
            this.calls++;
            return super.put(...args);
          }
          async remove(...args) {
            this.calls++;
            return super.remove(...args);
          }
        }
        const objects = new Objects();
        const core = new DocumentIntake(
          store.asActor(vault.ownerAccountId),
          objects,
        );
        const permissions = new PermissionService(access);
        const authorize = async (p, a, s) =>
          permissions.require(vault.ownerPrincipal, p, a, s);
        const bytes = Buffer.from(
          '%PDF-1.7\nSynthetic trash original\n%%EOF\n',
        );
        const declaration = {
          title: 'Preserved trash original',
          mimeType: 'application/pdf',
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          idempotencyKey: randomUUID(),
        };
        try {
          const upload = await core.begin(
            vault.patientId,
            declaration,
            authorize,
          );
          const target = { kind: 'document', documentId: upload.documentId };
          const edit = () =>
            permissions.require(
              vault.ownerPrincipal,
              vault.patientId,
              'edit',
              target,
              true,
            );
          const change = (action, callback = edit, using = store) =>
            using.changeTrash(
              vault.patientId,
              upload.documentId,
              action,
              vault.ownerAccountId,
              callback,
            );
          assert.equal(
            await change('trash'),
            'missing',
            'Pending uploads cannot enter trash',
          );
          await rejectedSql(
            runtime,
            'UPDATE fmv.documents SET deleted_at=clock_timestamp() WHERE id=$1::uuid',
            [upload.documentId],
            '23514',
          );
          await core.content(
            vault.patientId,
            upload.uploadId,
            bytes,
            authorize,
          );
          await core.finalize(vault.patientId, upload.uploadId, authorize);
          const snapshot = async () =>
            (
              await query(
                runtime,
                'SELECT title,display_title,object_key,bytes,sha256,created_at,state,deleted_at FROM fmv.documents WHERE id=$1::uuid',
                [upload.documentId],
              )
            ).rows[0];
          const original = await snapshot();
          const events = async () =>
            (
              await query(
                runtime,
                "SELECT kind,actor_account_id,retention_until-occurred_at=interval '90 days' AS retention FROM fmv.document_events WHERE document_id=$1::uuid AND kind IN ('document.trashed','document.restored') ORDER BY occurred_at,id",
                [upload.documentId],
              )
            ).rows;
          const manifests = await query(
            runtime,
            'SELECT * FROM fmv.document_object_attempts WHERE document_id=$1::uuid ORDER BY object_key',
            [upload.documentId],
          );
          const privileges = await query(
            runtime,
            "SELECT has_column_privilege(current_user,'fmv.documents','deleted_at','UPDATE') AS can_trash,has_table_privilege(current_user,'fmv.documents','DELETE') AS can_delete",
          );
          assert.deepEqual(privileges.rows, [
            { can_trash: true, can_delete: false },
          ]);
          let checks = 0;
          assert.equal(
            await change('trash', async () => {
              checks++;
              await edit();
            }),
            'changed',
          );
          assert.equal(
            checks,
            2,
            'Both authorization checks run for a transition',
          );
          const trashed = await snapshot();
          assert.ok(trashed.deleted_at instanceof Date);
          assert.deepEqual({ ...trashed, deleted_at: null }, original);
          assert.equal(await change('trash'), 'unchanged');
          assert.deepEqual(
            await snapshot(),
            trashed,
            'Retry cannot extend recovery',
          );
          assert.equal((await events()).length, 1);
          assert.ok(
            !(await store.list(vault.patientId)).some(
              (row) => row.documentId === upload.documentId,
            ),
          );
          assert.ok(
            (await store.listTrash(vault.patientId)).some(
              (row) => row.documentId === upload.documentId,
            ),
          );
          for (const action of ['view', 'export', 'edit', 'manage', 'upload'])
            await accessDenied(() =>
              permissions.require(
                vault.ownerPrincipal,
                vault.patientId,
                action,
                target,
              ),
            );
          await accessDenied(() =>
            permissions.require(
              vault.ownerPrincipal,
              vault.patientId,
              'view',
              target,
              true,
            ),
          );
          assert.equal(
            await store.rename(
              vault.patientId,
              upload.documentId,
              'Hidden rename',
              vault.ownerAccountId,
              edit,
            ),
            false,
          );
          const caregiverService = new CaregiverService(runtimeUrl.href);
          try {
            const grant = await insertGrant(runtime, vault, {
              scopeKind: 'document',
              documentId: upload.documentId,
              actions: ['view'],
            });
            const accessList = await caregiverService.list(
              vault.ownerPrincipal,
              vault.patientId,
            );
            assert.ok(
              accessList.grants.some((g) => g.id === grant.id),
              'Trash must not hide grants from an authorized manager',
            );
            await caregiverService.revoke(
              vault.ownerPrincipal,
              vault.patientId,
              grant.id,
            );
            assert.ok(
              (
                await query(
                  runtime,
                  'SELECT revoked_at FROM fmv.access_grants WHERE id=$1::uuid',
                  [grant.id],
                )
              ).rows[0].revoked_at,
              'Trash must not block revocation',
            );
            await accessDenied(() =>
              caregiverService.create(vault.ownerPrincipal, vault.patientId, {
                actions: ['view'],
                scope: { kind: 'document', documentId: upload.documentId },
                expiresInHours: 1,
              }),
            );
          } finally {
            await caregiverService.onModuleDestroy();
          }
          const ioBefore = objects.calls;
          const hidden = (error) => error.status === 404;
          for (const action of ['view', 'export'])
            await assert.rejects(
              core.read(
                vault.patientId,
                upload.documentId,
                action,
                async () => {},
              ),
              hidden,
            );
          await assert.rejects(
            core.begin(vault.patientId, declaration, async () => {}),
            hidden,
          );
          await assert.rejects(
            core.content(
              vault.patientId,
              upload.uploadId,
              bytes,
              async () => {},
            ),
            hidden,
          );
          await assert.rejects(
            core.finalize(vault.patientId, upload.uploadId, async () => {}),
            hidden,
          );
          assert.equal(
            objects.calls,
            ioBefore,
            'Hidden records deny before object IO, even with permissive callbacks',
          );
          let postcheck = 0;
          await assert.rejects(
            change('restore', async () => {
              if (++postcheck === 2)
                throw new Error('Synthetic current access lost');
            }),
          );
          assert.deepEqual(await snapshot(), trashed);
          assert.equal(
            (await events()).length,
            1,
            'Post-check denial rolls audit back',
          );
          await query(
            owner,
            "CREATE FUNCTION fmv.fail_trash_event_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind IN ('document.trashed','document.restored') THEN RAISE EXCEPTION 'synthetic trash audit failure'; END IF; RETURN NEW; END $$",
          );
          await query(
            owner,
            'CREATE TRIGGER trash_failure_probe BEFORE INSERT ON fmv.document_events FOR EACH ROW EXECUTE FUNCTION fmv.fail_trash_event_probe()',
          );
          try {
            await assert.rejects(change('restore'));
            assert.deepEqual(await snapshot(), trashed);
            assert.equal((await events()).length, 1);
          } finally {
            await query(
              owner,
              'DROP TRIGGER trash_failure_probe ON fmv.document_events',
            );
            await query(owner, 'DROP FUNCTION fmv.fail_trash_event_probe()');
          }
          assert.equal(await change('restore'), 'changed');
          assert.equal(await change('restore'), 'unchanged');
          assert.deepEqual(await snapshot(), original);
          assert.deepEqual(
            (
              await core.read(
                vault.patientId,
                upload.documentId,
                'view',
                authorize,
              )
            ).bytes,
            bytes,
          );
          const replay = await core.begin(
            vault.patientId,
            declaration,
            authorize,
          );
          assert.equal(replay.uploadId, upload.uploadId);
          assert.equal(replay.documentId, upload.documentId);
          assert.equal(replay.state, 'ready');
          assert.deepEqual(
            (await events()).map((row) => row.kind),
            ['document.trashed', 'document.restored'],
          );
          assert.ok(
            (await events()).every(
              (row) =>
                row.retention && row.actor_account_id === vault.ownerAccountId,
            ),
          );
          assert.deepEqual(
            (
              await query(
                runtime,
                'SELECT * FROM fmv.document_object_attempts WHERE document_id=$1::uuid ORDER BY object_key',
                [upload.documentId],
              )
            ).rows,
            manifests.rows,
          );
          // Use database-relative times so neither application clocks nor sleeps
          // decide the strict 30-day boundary.
          await change('trash');
          await query(
            owner,
            "UPDATE fmv.documents SET deleted_at=clock_timestamp()-interval '30 days'+interval '1 minute' WHERE id=$1::uuid",
            [upload.documentId],
          );
          assert.equal(await change('restore'), 'changed');
          await change('trash');
          await query(
            owner,
            "UPDATE fmv.documents SET deleted_at=clock_timestamp()-interval '30 days' WHERE id=$1::uuid",
            [upload.documentId],
          );
          assert.equal(await change('restore'), 'expired');
          // The deadline must be evaluated when the UPDATE runs, after any
          // slow authorization callback, rather than at transaction start.
          await query(
            owner,
            "UPDATE fmv.documents SET deleted_at=clock_timestamp()-interval '30 days'+interval '400 milliseconds' WHERE id=$1::uuid",
            [upload.documentId],
          );
          let deadlineChecks = 0;
          assert.equal(
            await change('restore', async () => {
              if (++deadlineChecks === 1) await delay(600);
              await edit();
            }),
            'expired',
          );
          const expired = await snapshot();
          const eventCount = (await events()).length;
          assert.equal(await change('restore'), 'expired');
          assert.equal(await change('trash'), 'unchanged');
          assert.deepEqual(await snapshot(), expired);
          assert.equal((await events()).length, eventCount);
          assert.ok(
            (await store.listTrash(vault.patientId)).some(
              (row) => row.documentId === upload.documentId,
            ),
            'Expired metadata remains visible without claiming physical purge',
          );
          await query(
            owner,
            'UPDATE fmv.documents SET deleted_at=clock_timestamp() WHERE id=$1::uuid',
            [upload.documentId],
          );
          assert.equal(await change('restore'), 'changed');
          // A read holds the same row lock as a trash transition while bytes are
          // in flight; after it commits, subsequent reads see the hidden state.
          const entered = deferred(),
            release = deferred();
          objects.beforeGet = async () => {
            entered.resolve();
            await release.promise;
          };
          const reading = core.read(
            vault.patientId,
            upload.documentId,
            'view',
            authorize,
          );
          await within(entered.promise, 5000);
          let transitioned = false;
          const trashing = change('trash', edit, other).then((value) => {
            transitioned = true;
            return value;
          });
          try {
            await delay(100);
            assert.equal(
              transitioned,
              false,
              'Trash waits for the active read row lock',
            );
          } finally {
            release.resolve();
          }
          assert.deepEqual((await within(reading, 5000)).bytes, bytes);
          assert.equal(await within(trashing, 5000), 'changed');
          objects.beforeGet = undefined;
          await assert.rejects(
            core.read(
              vault.patientId,
              upload.documentId,
              'view',
              async () => {},
            ),
            hidden,
          );
          const beforeRace = (await events()).length;
          const restored = await Promise.all([
            change('restore'),
            change('restore', edit, other),
          ]);
          assert.deepEqual(restored.sort(), ['changed', 'unchanged']);
          assert.equal((await events()).length, beforeRace + 1);
          const gate = deferred(),
            unlock = deferred();
          const rename = store.rename(
            vault.patientId,
            upload.documentId,
            'Serialized title',
            vault.ownerAccountId,
            async () => {
              gate.resolve();
              await unlock.promise;
            },
          );
          await within(gate.promise, 5000);
          let trashFinished = false;
          const afterRename = change('trash', edit, other).then((value) => {
            trashFinished = true;
            return value;
          });
          try {
            await delay(100);
            assert.equal(trashFinished, false);
          } finally {
            unlock.resolve();
          }
          assert.equal(await within(rename, 5000), true);
          assert.equal(await within(afterRename, 5000), 'changed');
          assert.equal((await snapshot()).display_title, 'Serialized title');
          assert.equal(await change('restore'), 'changed');
          assert.equal(
            await store.changeTrash(
              vault.strangerPersonId,
              upload.documentId,
              'trash',
              vault.ownerAccountId,
              async () => assert.fail('Wrong patient must not authorize'),
            ),
            'missing',
          );
        } finally {
          await store.onModuleDestroy();
          await other.onModuleDestroy();
          await access.onModuleDestroy();
        }
      },
    );

    await stage(
      'generation backfill preserves a FORCE-RLS legacy document under its non-superuser non-bypass owner',
      async () => {
        const admin = await connect(ownerUrl);
        const suffix = randomUUID().replaceAll('-', '');
        const probeSchema = `fmv_probe_${suffix}`,
          probeRole = `fmv_owner_probe_${suffix}`;
        assert.match(probeSchema, /^fmv_probe_[a-f0-9]{32}$/);
        assert.match(probeRole, /^fmv_owner_probe_[a-f0-9]{32}$/);
        assert.ok(
          probeSchema.length <= 63 &&
            probeRole.length <= 63 &&
            probeSchema !== 'fmv',
        );
        const documentId = randomUUID(),
          objectKey = randomUUID().replaceAll('-', '');
        const createdAt = new Date('2026-11-10T03:04:05.678Z');
        let schemaCreated = false,
          roleCreated = false;
        const history = await query(
          admin,
          'SELECT migration_name,checksum,finished_at,rolled_back_at FROM fmv._prisma_migrations ORDER BY migration_name',
        );
        try {
          await query(
            admin,
            `CREATE ROLE "${probeRole}" NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`,
          );
          roleCreated = true;
          await query(
            admin,
            `CREATE SCHEMA "${probeSchema}" AUTHORIZATION "${probeRole}"`,
          );
          schemaCreated = true;
          await query(
            admin,
            `CREATE TABLE "${probeSchema}".documents(id UUID PRIMARY KEY,object_key TEXT NOT NULL UNIQUE,created_at TIMESTAMPTZ(3) NOT NULL,state TEXT NOT NULL)`,
          );
          await query(
            admin,
            `INSERT INTO "${probeSchema}".documents(id,object_key,created_at,state) VALUES($1::uuid,$2,$3,'ready')`,
            [documentId, objectKey, createdAt],
          );
          await query(
            admin,
            `ALTER TABLE "${probeSchema}".documents ENABLE ROW LEVEL SECURITY`,
          );
          await query(
            admin,
            `ALTER TABLE "${probeSchema}".documents FORCE ROW LEVEL SECURITY`,
          );
          await query(
            admin,
            `ALTER TABLE "${probeSchema}".documents OWNER TO "${probeRole}"`,
          );
          const trustedSql = await readFile(
            path.join(
              server,
              'prisma/migrations/20261111000100_object_generations/migration.sql',
            ),
            'utf8',
          );
          const probeSql = trustedSql.replaceAll('fmv.', `${probeSchema}.`);
          assert.ok(!probeSql.includes('fmv.'));
          try {
            await query(admin, `SET ROLE "${probeRole}"`);
            const identity = await query(
              admin,
              'SELECT current_user AS name,rolsuper,rolbypassrls,rolinherit,rolcanlogin FROM pg_roles WHERE rolname=current_user',
            );
            assert.deepEqual(identity.rows, [
              {
                name: probeRole,
                rolsuper: false,
                rolbypassrls: false,
                rolinherit: false,
                rolcanlogin: false,
              },
            ]);
            const hiddenBefore = await query(
              admin,
              `SELECT count(*)::integer AS n FROM "${probeSchema}".documents`,
            );
            assert.equal(
              hiddenBefore.rows[0].n,
              0,
              'The FORCE-RLS owner must see no legacy rows without a SELECT policy',
            );
            // Execute the actual migration, changing only its trusted schema prefix.
            // Its temporary CURRENT_USER policy must make the hidden row available
            // to the backfill and disappear before that transaction commits.
            await query(admin, probeSql);
            const hiddenAfter = await query(
              admin,
              `SELECT count(*)::integer AS n FROM "${probeSchema}".documents`,
            );
            assert.equal(hiddenAfter.rows[0].n, 0);
          } finally {
            try {
              await query(admin, 'ROLLBACK');
            } finally {
              await query(admin, 'RESET ROLE');
            }
          }
          const backfilled = await query(
            admin,
            `SELECT object_key,document_id,created_at,retired_at FROM "${probeSchema}".document_object_attempts`,
          );
          assert.deepEqual(backfilled.rows, [
            {
              object_key: objectKey,
              document_id: documentId,
              created_at: createdAt,
              retired_at: null,
            },
          ]);
          const policies = await query(
            admin,
            'SELECT count(*)::integer AS n FROM pg_policies WHERE schemaname=$1 AND policyname=$2',
            [probeSchema, 'migration_object_backfill'],
          );
          assert.equal(
            policies.rows[0].n,
            0,
            'The temporary backfill policy must never remain after commit',
          );
          const flags = await query(
            admin,
            'SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=ANY($2::text[])',
            [probeSchema, ['documents', 'document_object_attempts']],
          );
          assert.equal(flags.rowCount, 2);
          assert.ok(
            flags.rows.every(
              (row) => row.relrowsecurity && row.relforcerowsecurity,
            ),
          );
          const after = await query(
            admin,
            'SELECT migration_name,checksum,finished_at,rolled_back_at FROM fmv._prisma_migrations ORDER BY migration_name',
          );
          assert.deepEqual(
            after.rows,
            history.rows,
            'The probe must not modify the application migration ledger',
          );
        } finally {
          try {
            await query(admin, 'ROLLBACK');
          } finally {
            await query(admin, 'RESET ROLE');
          }
          // Both identifiers were generated and validated above. Cleanup cannot
          // target fmv, provider schemas, or a pre-existing role.
          if (schemaCreated)
            await query(admin, `DROP SCHEMA "${probeSchema}" CASCADE`);
          if (roleCreated) await query(admin, `DROP ROLE "${probeRole}"`);
        }
      },
    );

    await stage('wrong password is rejected', async () => {
      const wrong = new URL(runtimeUrl);
      wrong.password = `${runtimeUrl.password}_deliberately_incorrect`;
      const client = new pg.Client({
        connectionString: wrong.href,
        connectionTimeoutMillis: 10_000,
      });
      clients.push(client);
      client.on('error', () => {});
      let code;
      try {
        await client.connect();
      } catch (error) {
        code = error.code;
      }
      assert.ok(code === '28P01', 'Wrong password must fail authentication');
    });

    await stage(
      'failed migration rolls back and can be resolved and retried',
      async () => {
        temporary = await mkdtemp(path.join(tmpdir(), 'fmv-db-integration-'));
        const migrations = path.join(temporary, 'migrations');
        await cp(path.join(server, 'prisma/migrations'), migrations, {
          recursive: true,
        });
        const probe = path.join(migrations, failureMigration);
        await mkdir(probe);
        const migration = path.join(probe, 'migration.sql');
        await writeFile(
          migration,
          'BEGIN;\nCREATE TABLE fmv.integration_probe(id integer);\nSELECT nonexistent_probe_function();\nCOMMIT;\n',
        );
        const config = path.join(temporary, 'prisma.config.mjs');
        const configModule = pathToFileURL(
          createRequire(import.meta.url).resolve('prisma/config'),
        ).href;
        await writeFile(
          config,
          `import { defineConfig, env } from ${JSON.stringify(configModule)};\nexport default defineConfig({ schema: ${JSON.stringify(path.join(server, 'prisma/schema.prisma'))}, migrations: { path: ${JSON.stringify(migrations)} }, datasource: { url: env('DATABASE_MIGRATION_URL') } });\n`,
        );
        assert.notEqual(
          prisma(ownerUrl, ['migrate', 'deploy', '--config', config]),
          0,
          'Deliberately invalid migration must fail',
        );
        const rolledBack = await query(
          owner,
          "SELECT to_regclass('fmv.integration_probe') IS NULL AS absent",
        );
        assert.equal(
          rolledBack.rows[0].absent,
          true,
          'Failed migration must roll back its table',
        );
        assert.equal(
          prisma(ownerUrl, [
            'migrate',
            'resolve',
            '--rolled-back',
            failureMigration,
            '--config',
            config,
          ]),
          0,
          'Failed migration must be resolvable',
        );
        await writeFile(
          migration,
          'BEGIN;\nCREATE TABLE fmv.integration_probe(id integer);\nCOMMIT;\n',
        );
        assert.equal(
          prisma(ownerUrl, ['migrate', 'deploy', '--config', config]),
          0,
          'Corrected migration must retry successfully',
        );
        const retried = await query(
          owner,
          "SELECT to_regclass('fmv.integration_probe') IS NOT NULL AS present",
        );
        assert.equal(
          retried.rows[0].present,
          true,
          'Retry must create its disposable table',
        );
        const completed = await query(
          owner,
          'SELECT count(*)::integer AS count FROM fmv._prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL',
          [failureMigration],
        );
        assert.equal(
          completed.rows[0].count,
          1,
          'Retry must have one successful migration record',
        );
      },
    );
  } finally {
    for (const client of clients.reverse()) {
      try {
        await client.end();
      } catch {
        /* Cleanup must never expose connection details. */
      }
    }
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
});
