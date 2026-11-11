import process from 'node:process';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
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
          6,
          'Foundation, auth, identity, permissions, intake and approval migrations must exist',
        );
        assert.equal(
          result.rows
            .map((row) => row.migration_name)
            .sort()
            .join(','),
          '20261105000100_foundation,20261105000300_auth_sessions,20261105000400_person_identity,20261110000100_patient_permissions,20261110000200_document_intake,20261110000300_caregiver_approvals',
        );
        assert.ok(result.rows.every((row) => row.finished && row.active));
      }
      await baseline();
      const retained = await query(
        owner,
        'SELECT id,owner_account_id,display_name FROM fmv.persons WHERE id=$1::uuid',
        [upgradePerson],
      );
      assert.deepEqual(retained.rows, [
        {
          id: upgradePerson,
          owner_account_id: upgradeAccount,
          display_name: 'Retained upgrade fixture',
        },
      ]);
      assert.equal(
        prisma(ownerUrl, ['migrate', 'deploy']),
        0,
        'Repeated migration must succeed',
      );
      await baseline();
      const tables = await query(
        owner,
        "SELECT tablename FROM pg_tables WHERE schemaname = 'fmv' AND tablename <> '_prisma_migrations'",
      );
      assert.equal(
        tables.rows
          .map((row) => row.tablename)
          .sort()
          .join(','),
        'access_events,access_grant_dependencies,access_grants,access_invitations,app_accounts,auth_rate_limits,auth_sessions,document_categories,document_events,documents,persons',
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
          assert.deepEqual(
            await right.create(principal, 'Different name'),
            person,
          );
          const other = { ...principal, subject: 'person-b' };
          assert.equal(await right.find(other), null);
          const second = await right.create(other, 'Fixture Person');
          assert.notEqual(second.id, person.id);
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
          "UPDATE fmv.documents SET object_key='ffffffffffffffffffffffffffffffff'",
          'DELETE FROM fmv.documents',
          "INSERT INTO fmv.document_categories(slug,name) VALUES ('forbidden','Forbidden')",
          "UPDATE fmv.document_categories SET name='Forbidden'",
          'UPDATE fmv.document_events SET occurred_at=statement_timestamp()',
          'DELETE FROM fmv.document_events',
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
          assert.match(read.record.objectKey, /^[a-f0-9]{32}$/);
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
