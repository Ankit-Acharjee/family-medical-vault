import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { URL } from 'node:url';
import {
  configureInitialLedgerPolicy,
  developmentLedgerTarget,
  developmentLedgerMigrationUrl,
  initialLedgerPolicyPlan,
  validateInitialLedgerPolicyPlan,
} from '../backup/ledger-policy.mjs';

// Syntax-only public fixtures, intentionally not checksum-validated age keys.
// The operator CLI must check the actual public recipient with pinned age.
const recipient = `age1${'q'.repeat(58)}`,
  otherRecipient = `age1${'p'.repeat(58)}`,
  policyId = '00000000-0000-4000-8000-000000000001',
  ledgerId = 'a'.repeat(32),
  fingerprint = (value) => createHash('sha256').update(value).digest('hex'),
  input = () => ({ recipient, policyId, ledgerId }),
  plan = () => initialLedgerPolicyPlan(input()),
  failure = /^Error: Initial ledger policy configuration failed$/,
  reject = (action) => assert.throws(action, failure);

test('initial plan pins canonical public identity and development destination without mutating input', () => {
  const value = input(),
    before = JSON.parse(JSON.stringify(value)),
    result = initialLedgerPolicyPlan(value);
  assert.deepEqual(result, {
    format: 'fmv-development-ledger-policy-v1',
    target: developmentLedgerTarget,
    environment: 'development',
    policyId,
    ledgerId,
    recipient,
    recipientSha256: fingerprint(recipient),
  });
  assert.equal(result.target, 'nyjkrcznezyrgntwvpjj');
  assert.deepEqual(value, before);
  const validated = validateInitialLedgerPolicyPlan(result, recipient);
  assert.deepEqual(validated, result);
  assert.notEqual(validated, result);
  assert.deepEqual(
    validateInitialLedgerPolicyPlan(
      JSON.parse(JSON.stringify(result)),
      recipient,
    ),
    result,
  );
});

test('rejects malformed, private, padded or unsupported public recipient strings', () => {
  for (const bad of [
    undefined,
    null,
    1,
    {},
    [],
    '',
    'AGE-SECRET-KEY-1SYNTHETIC-NOT-A-REAL-KEY',
    `ssh-ed25519 ${'A'.repeat(60)}`,
    recipient.toUpperCase(),
    ` ${recipient}`,
    `${recipient}\n`,
    `${recipient}\r\n`,
    `age1${'q'.repeat(57)}`,
    `age1${'q'.repeat(59)}`,
    `age1${'b'.repeat(58)}`,
    `${recipient},${otherRecipient}`,
    `${recipient}\n${otherRecipient}`,
  ])
    reject(() => initialLedgerPolicyPlan({ ...input(), recipient: bad }));
});

test('policy and ledger identifiers require exact lowercase string syntax without coercion', () => {
  for (const bad of [
    undefined,
    null,
    '',
    1,
    [],
    [policyId],
    { toString: () => policyId },
    policyId.toUpperCase().replace('00000000', 'AAAAAAAA'),
    `${policyId}\n`,
    ` ${policyId}`,
    policyId.replaceAll('-', ''),
  ])
    reject(() => initialLedgerPolicyPlan({ ...input(), policyId: bad }));
  for (const bad of [
    undefined,
    null,
    '',
    1,
    [],
    [ledgerId],
    { toString: () => ledgerId },
    ledgerId.toUpperCase(),
    'g'.repeat(32),
    'a'.repeat(31),
    'a'.repeat(33),
    `${ledgerId}\n`,
  ])
    reject(() => initialLedgerPolicyPlan({ ...input(), ledgerId: bad }));
});

test('validation rejects changes to format, destination, environment, recipient or fingerprint', () => {
  for (const patch of [
    { format: 'fmv-development-ledger-policy-v2' },
    { format: null },
    { target: 'another-development-project' },
    { target: null },
    { environment: 'production' },
    { environment: null },
    { recipient: otherRecipient },
    { recipient: otherRecipient, recipientSha256: fingerprint(otherRecipient) },
    { recipientSha256: '0'.repeat(64) },
    { recipientSha256: null },
    { recipientSha256: fingerprint(recipient).toUpperCase() },
    { policyId: 'bad' },
    { ledgerId: 'bad' },
  ])
    reject(() =>
      validateInitialLedgerPolicyPlan({ ...plan(), ...patch }, recipient),
    );
  reject(() => validateInitialLedgerPolicyPlan(plan(), otherRecipient));
  reject(() =>
    validateInitialLedgerPolicyPlan(plan(), 'AGE-SECRET-KEY-1SYNTHETIC'),
  );
});

test('validation rejects missing fields, unknown fields and serialization tricks', () => {
  const valid = plan();
  for (const key of Object.keys(valid)) {
    const missing = { ...valid };
    delete missing[key];
    reject(() => validateInitialLedgerPolicyPlan(missing, recipient));
  }
  for (const value of [
    undefined,
    null,
    [],
    true,
    1,
    JSON.stringify(valid),
    { ...valid, enabled: true },
    { ...valid, operatorLoginEnabled: true },
    { ...valid, unknown: undefined },
    { ...valid, toJSON: () => valid },
  ])
    reject(() => validateInitialLedgerPolicyPlan(value, recipient));
});

test('invalid configuration plans fail before any database query', async () => {
  const queries = [],
    client = {
      query: async (...args) => {
        queries.push(args);
        throw Error('Unexpected database query');
      },
    };
  for (const apply of [false, true]) {
    await assert.rejects(
      configureInitialLedgerPolicy(
        client,
        { ...plan(), target: 'unapproved' },
        { apply },
      ),
      failure,
    );
    await assert.rejects(
      configureInitialLedgerPolicy(
        client,
        { ...plan(), recipientSha256: '0'.repeat(64) },
        { apply },
      ),
      failure,
    );
  }
  assert.deepEqual(queries, []);
});

test('configuration requires a boolean apply flag and a callable prerequisite check before database access', async () => {
  const queries = [],
    client = {
      query: async (...args) => {
        queries.push(args);
        throw Error('Unexpected database query');
      },
    };
  for (const apply of ['true', 'false', 0, 1, null, [], {}])
    await assert.rejects(
      configureInitialLedgerPolicy(client, plan(), { apply }),
      failure,
    );
  for (const verifyPrerequisites of [null, true, 'verify', [], {}])
    await assert.rejects(
      configureInitialLedgerPolicy(client, plan(), { verifyPrerequisites }),
      failure,
    );
  assert.deepEqual(queries, []);
});

function migrationUrl() {
  const value = new URL('postgresql://example.invalid/postgres');
  value.hostname = 'aws-0-ap-south-1.pooler.supabase.com';
  value.port = '5432';
  value.username = `postgres.${developmentLedgerTarget}`;
  value.password = 'not-a-real-password';
  value.searchParams.set('schema', 'fmv');
  value.searchParams.set('sslmode', 'verify-full');
  value.searchParams.set('sslrootcert', '/tmp/synthetic-ca.crt');
  return value;
}
test('development connection accepts only the exact scoped TLS parameter envelope', () => {
  const value = migrationUrl();
  assert.equal(developmentLedgerMigrationUrl(value.href).href, value.href);
  assert.throws(() =>
    developmentLedgerMigrationUrl(value.href.replace('postgresql:', 'https:')),
  );
  for (const mutation of [
    (v) => {
      v.hostname = 'example.invalid';
    },
    (v) => {
      v.username = 'other';
    },
    (v) => {
      v.password = '';
    },
    (v) => {
      v.port = '6543';
    },
    (v) => {
      v.pathname = '/other';
    },
    (v) => {
      v.hash = 'fragment';
    },
    (v) => {
      v.searchParams.set('sslmode', 'disable');
    },
    (v) => {
      v.searchParams.set('schema', 'public');
    },
    (v) => {
      v.searchParams.delete('sslrootcert');
    },
    (v) => {
      v.searchParams.set('host', 'example.invalid');
    },
    (v) => {
      v.searchParams.set('ssl', 'false');
    },
    (v) => {
      v.searchParams.set('options', '-c role=other');
    },
  ]) {
    const changed = migrationUrl();
    mutation(changed);
    assert.throws(() => developmentLedgerMigrationUrl(changed.href));
  }
  for (const key of ['schema', 'sslmode', 'sslrootcert']) {
    const changed = migrationUrl();
    changed.searchParams.append(key, changed.searchParams.get(key));
    assert.throws(() => developmentLedgerMigrationUrl(changed.href));
  }
});
