import process from 'node:process';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import test from 'node:test';
import pg from 'pg';
import { PrismaAuthStore } from '../../dist/auth/auth.store.js';
import { PrismaPersonStore } from '../../dist/identity/person.store.js';
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
  assert.ok(
    ['postgres:', 'postgresql:'].includes(url.protocol) &&
      url.hostname === 'postgres' &&
      ['', '5432'].includes(url.port) &&
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

test('disposable PostgreSQL migration and runtime security lifecycle', async (t) => {
  const ownerUrl = localUrl('TEST_DATABASE_URL', 'fmv_owner');
  const runtimeUrl = localUrl('TEST_RUNTIME_URL', 'fmv_app');
  const clients = [];
  let temporary;
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
          3,
          'Foundation, auth and identity migrations must exist',
        );
        assert.equal(
          result.rows
            .map((row) => row.migration_name)
            .sort()
            .join(','),
          '20261105000100_foundation,20261105000300_auth_sessions,20261105000400_person_identity',
        );
        assert.equal(result.rows[0].finished, true);
        assert.equal(result.rows[0].active, true);
      }
      await baseline();
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
        'app_accounts,auth_rate_limits,auth_sessions,persons',
        'Only reviewed authentication and identity tables may exist',
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
          const limits = await Promise.all(
            Array.from({ length: 10 }, () =>
              first.limit(
                'synthetic-shared-bucket',
                new Date(Date.now() + 60_000),
                3,
              ),
            ),
          );
          assert.equal(
            limits.filter(Boolean).length,
            3,
            'Concurrent rate limits must be atomic',
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
            'SELECT count(*)::integer AS n FROM fmv.persons',
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
