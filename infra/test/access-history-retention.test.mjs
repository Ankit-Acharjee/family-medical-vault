import { URL } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  retentionConfig,
  retainOrdinaryAccess,
} from '../scripts/access-history-retention.mjs';
// Deliberately fake, configuration-only fixtures: no network or .env reads.
// Use explicit non-secret fields instead of realistic credentialed URI literals.
function fixtureUrl(base, username) {
  const url = new URL(base);
  url.username = username;
  url.password = 'synthetic';
  return url.href;
}
const local = {
  DATABASE_MAINTENANCE_URL: fixtureUrl(
    'postgresql://127.0.0.1:5544/fmv_dev?schema=fmv',
    'fmv_owner',
  ),
};
test('ordinary retention defaults to dry-run and requires an exact development target and apply confirmation', () => {
  assert.equal(retentionConfig(['--target=local'], local).apply, false);
  assert.equal(
    retentionConfig(
      ['--target=local', '--apply', '--confirm=purge-ordinary-access-history'],
      local,
    ).apply,
    true,
  );
  for (const args of [
    [],
    ['--target=local', '--apply'],
    ['--target=local', '--confirm=purge-ordinary-access-history'],
    ['--target=local', '--target=local'],
    ['--target=local', '--batch=999999'],
    ['--target=local', '--target=nyjkrcznezyrgntwvpjj'],
  ])
    assert.throws(() => retentionConfig(args, local));
  for (const connection of [
    fixtureUrl('postgresql://localhost:5544/fmv_dev', 'fmv_owner'),
    fixtureUrl('postgresql://127.0.0.1:5544/fmv_dev', 'fmv_app'),
    fixtureUrl('postgresql://127.0.0.1:5544/production', 'fmv_owner'),
  ])
    assert.throws(() =>
      retentionConfig(['--target=local'], {
        DATABASE_MAINTENANCE_URL: connection,
      }),
    );
  assert.throws(() =>
    retentionConfig(['--target=local'], {
      DATABASE_MIGRATION_URL: local.DATABASE_MAINTENANCE_URL,
    }),
  );
});
test('hosted configuration rejects wrong projects, insecure TLS and relative certificates', () => {
  const value = fixtureUrl(
      'postgresql://aws-0-ap-south-1.pooler.supabase.com:5432/postgres?schema=fmv&sslmode=verify-full&sslrootcert=/synthetic/ca.crt',
      'postgres.nyjkrcznezyrgntwvpjj',
    ),
    args = ['--target=nyjkrcznezyrgntwvpjj'];
  assert.equal(
    retentionConfig(args, { DATABASE_MAINTENANCE_URL: value }).local,
    false,
  );
  for (const url of [
    value.replace('verify-full', 'require'),
    value.replace('nyjkrcznezyrgntwvpjj', 'otherproject'),
    value.replace('/synthetic/ca.crt', 'relative.crt'),
    value.replace('postgres.nyjk', 'fmv_app.nyjk'),
    value + '&sslmode=disable',
    value + '&host=other.example.test',
    value + '&options=-c%20search_path=public',
  ])
    assert.throws(() =>
      retentionConfig(args, { DATABASE_MAINTENANCE_URL: url }),
    );
});
test('retention batch bounds fail before opening a transaction', async () => {
  for (const batchSize of [0, 1001, 1.5, '500'])
    await assert.rejects(
      retainOrdinaryAccess({ query: () => assert.fail() }, { batchSize }),
    );
});
test('runtime or incomplete maintenance authority fails before deletion and rolls back', async () => {
  for (const role of [
    {
      name: 'fmv_app',
      rolsuper: false,
      rolbypassrls: false,
      document_privileges: true,
      link_privileges: true,
    },
    {
      name: 'restricted_maintenance',
      rolsuper: false,
      rolbypassrls: true,
      document_privileges: true,
      link_privileges: false,
    },
  ]) {
    const calls = [];
    const client = {
      query: async (sql) => {
        calls.push(sql);
        return { rows: [role] };
      },
    };
    await assert.rejects(
      retainOrdinaryAccess(client, { apply: true }),
      /maintenance connection/,
    );
    assert.equal(calls.at(-1), 'ROLLBACK');
    assert.ok(!calls.some((sql) => sql.startsWith('WITH candidates')));
  }
});
test('busy maintenance exits without deleting and a second-class failure rolls back the whole pass', async () => {
  const role = {
    name: 'synthetic_maintenance',
    rolsuper: false,
    rolbypassrls: true,
    document_privileges: true,
    link_privileges: true,
  };
  let calls = [];
  const busy = {
    query: async (sql) => {
      calls.push(sql);
      return {
        rows: [sql.includes('pg_try_advisory') ? { acquired: false } : role],
      };
    },
  };
  assert.equal((await retainOrdinaryAccess(busy, { apply: true })).busy, true);
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.ok(!calls.some((sql) => sql.startsWith('WITH candidates')));
  calls = [];
  let deletes = 0;
  const failed = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.startsWith('WITH candidates') && ++deletes === 2)
        throw Error('synthetic failure');
      return {
        rowCount: 1,
        rows: [sql.includes('pg_try_advisory') ? { acquired: true } : role],
      };
    },
  };
  await assert.rejects(
    retainOrdinaryAccess(failed, { apply: true }),
    /synthetic failure/,
  );
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.ok(!calls.includes('COMMIT'));
});
