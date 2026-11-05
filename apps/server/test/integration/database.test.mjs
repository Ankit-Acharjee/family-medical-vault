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
        ([key, value]) => key === 'schema' && value === 'vault',
      ) &&
      (user !== 'fmv_owner' || url.searchParams.get('schema') === 'vault'),
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
        "SELECT to_regclass('vault._prisma_migrations') IS NULL AS fresh",
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
          'SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NULL AS active FROM vault._prisma_migrations',
        );
        assert.equal(
          result.rowCount,
          1,
          'Exactly one baseline migration must exist',
        );
        assert.equal(
          result.rows[0].migration_name,
          '20261105000100_foundation',
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
        "SELECT tablename FROM pg_tables WHERE schemaname = 'vault' AND tablename <> '_prisma_migrations'",
      );
      assert.equal(
        tables.rowCount,
        0,
        'Baseline must contain no business tables',
      );
      const permissions = await query(
        owner,
        "SELECT EXISTS (SELECT 1 FROM pg_namespace n, LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a WHERE n.nspname = 'vault' AND a.grantee = 0 AND a.privilege_type IN ('USAGE', 'CREATE')) AS public_access",
      );
      assert.equal(
        permissions.rows[0].public_access,
        false,
        'PUBLIC must have no vault schema access',
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
      await denied(runtime, 'CREATE TABLE vault.probe (id integer)');
      await denied(runtime, 'SELECT * FROM vault._prisma_migrations');
    });

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
          'BEGIN;\nCREATE TABLE vault.integration_probe(id integer);\nSELECT nonexistent_probe_function();\nCOMMIT;\n',
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
          "SELECT to_regclass('vault.integration_probe') IS NULL AS absent",
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
          'BEGIN;\nCREATE TABLE vault.integration_probe(id integer);\nCOMMIT;\n',
        );
        assert.equal(
          prisma(ownerUrl, ['migrate', 'deploy', '--config', config]),
          0,
          'Corrected migration must retry successfully',
        );
        const retried = await query(
          owner,
          "SELECT to_regclass('vault.integration_probe') IS NOT NULL AS present",
        );
        assert.equal(
          retried.rows[0].present,
          true,
          'Retry must create its disposable table',
        );
        const completed = await query(
          owner,
          'SELECT count(*)::integer AS count FROM vault._prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL',
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
