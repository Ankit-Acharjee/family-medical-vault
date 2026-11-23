import assert from 'node:assert/strict';
import test from 'node:test';
import { URL } from 'node:url';
import {
  developmentLedgerStagingUrl,
  prepareLedgerEvents,
} from '../backup/prepare-ledger-events.mjs';
import {
  developmentLedgerTarget,
  initialLedgerPolicyPlan,
} from '../backup/ledger-policy.mjs';

const failure =
  /^Error: Ledger preparation failed; some events may already be staged\. Retry is safe\. No provider publishing was attempted\.$/;
const address = () => {
  // Public URL shape only; this fixture is never connected and contains no key.
  const url = new URL('postgresql://example.invalid/postgres');
  url.hostname = 'aws-0-ap-south-1.pooler.supabase.com';
  url.port = '5432';
  url.password = 'synthetic-test-only';
  url.username = `fmv_ledger_worker.${developmentLedgerTarget}`;
  url.searchParams.set('schema', 'fmv');
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set('sslrootcert', '/synthetic/public-root-ca.crt');
  return url;
};
const plan = () =>
  initialLedgerPolicyPlan({
    recipient: `age1${'q'.repeat(58)}`,
    policyId: '00000000-0000-4000-8000-000000000001',
    ledgerId: 'a'.repeat(32),
  });

test('staging URL pins the dedicated development worker and verified TLS envelope', () => {
  const raw = address().href;
  const checked = developmentLedgerStagingUrl(raw);
  assert.ok(checked instanceof URL);
  assert.equal(checked.href, raw);
  assert.equal(
    checked.username,
    `fmv_ledger_worker.${developmentLedgerTarget}`,
  );
  assert.equal(checked.searchParams.get('sslmode'), 'verify-full');
});

test('staging URL rejects owner, application and substituted worker authority', () => {
  for (const username of [
    `postgres.${developmentLedgerTarget}`,
    `fmv_app.${developmentLedgerTarget}`,
    'postgres',
    'fmv_app',
    'fmv_ledger_stager',
    'fmv_ledger_worker',
    'fmv_ledger_worker.anotherproject',
  ]) {
    const url = address();
    url.username = username;
    assert.throws(() => developmentLedgerStagingUrl(url.href), failure);
  }
});

test('staging URL rejects unsupported transport, destination, database and TLS policy', () => {
  for (const [field, value] of [
    ['protocol', 'postgres:'],
    ['protocol', 'https:'],
    ['hostname', '127.0.0.1'],
    ['hostname', `db.${developmentLedgerTarget}.supabase.co`],
    ['hostname', 'aws-0.pooler.supabase.com.unapproved.example.test'],
    ['port', '6543'],
    ['port', ''],
    ['pathname', '/another'],
    ['password', ''],
    ['hash', '#substitution'],
  ]) {
    const url = address();
    if (field === 'protocol')
      assert.throws(
        () =>
          developmentLedgerStagingUrl(url.href.replace(/^postgresql:/, value)),
        failure,
      );
    else {
      url[field] = value;
      assert.throws(() => developmentLedgerStagingUrl(url.href), failure);
    }
  }
  for (const [key, value] of [
    ['schema', 'public'],
    ['sslmode', 'require'],
    ['sslmode', 'disable'],
    ['sslmode', 'verify-ca'],
    ['sslrootcert', ''],
  ]) {
    const url = address();
    url.searchParams.set(key, value);
    assert.throws(() => developmentLedgerStagingUrl(url.href), failure);
  }
  for (const key of ['schema', 'sslmode', 'sslrootcert']) {
    const missing = address();
    missing.searchParams.delete(key);
    assert.throws(() => developmentLedgerStagingUrl(missing.href), failure);
    const duplicate = address();
    duplicate.searchParams.append(key, duplicate.searchParams.get(key));
    assert.throws(() => developmentLedgerStagingUrl(duplicate.href), failure);
  }
});

test('staging URL rejects every query override outside the fixed TLS envelope', () => {
  for (const key of [
    'host',
    'port',
    'user',
    'password',
    'dbname',
    'options',
    'ssl',
    'sslcert',
    'sslkey',
    'connect_timeout',
    'channel_binding',
  ]) {
    const url = address();
    url.searchParams.append(key, 'synthetic');
    assert.throws(() => developmentLedgerStagingUrl(url.href), failure);
  }
  for (const raw of [undefined, null, '', 'not a URL'])
    assert.throws(() => developmentLedgerStagingUrl(raw), failure);
});

test('invalid apply flags and missing encryption callbacks fail before database access', async () => {
  const queries = [],
    client = {
      query: async (...args) => {
        queries.push(args);
        throw Error('Unexpected database access');
      },
    };
  for (const apply of ['true', 'false', null, 0, 1, [], {}])
    await assert.rejects(
      prepareLedgerEvents(client, plan(), { apply, encrypt: async () => {} }),
      failure,
    );
  for (const encrypt of [undefined, null, false, 'age', [], {}])
    await assert.rejects(
      prepareLedgerEvents(client, plan(), { apply: true, encrypt }),
      failure,
    );
  assert.deepEqual(queries, []);
});
