import { createHash } from 'node:crypto';
import { URL } from 'node:url';
export const developmentLedgerTarget = 'nyjkrcznezyrgntwvpjj';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail = () => new Error('Initial ledger policy configuration failed');
const fingerprint = (recipient) =>
  createHash('sha256').update(recipient).digest('hex');
export function initialLedgerPolicyPlan({ recipient, policyId, ledgerId }) {
  if (
    typeof recipient !== 'string' ||
    !/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(recipient) ||
    typeof policyId !== 'string' ||
    !uuid.test(policyId) ||
    typeof ledgerId !== 'string' ||
    !/^[a-f0-9]{32}$/.test(ledgerId)
  )
    throw fail();
  return {
    format: 'fmv-development-ledger-policy-v1',
    target: developmentLedgerTarget,
    environment: 'development',
    policyId,
    ledgerId,
    recipient,
    recipientSha256: fingerprint(recipient),
  };
}
export function validateInitialLedgerPolicyPlan(value, recipient) {
  try {
    if (
      !value ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).length !== 7 ||
      Reflect.ownKeys(value).sort().join(',') !==
        [
          'format',
          'target',
          'environment',
          'policyId',
          'ledgerId',
          'recipient',
          'recipientSha256',
        ]
          .sort()
          .join(',') ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(
        (field) => !Object.hasOwn(field, 'value'),
      )
    )
      throw fail();
    const normalized = initialLedgerPolicyPlan({
      recipient,
      policyId: value.policyId,
      ledgerId: value.ledgerId,
    });
    if (JSON.stringify(value) !== JSON.stringify(normalized)) throw fail();
    return normalized;
  } catch {
    throw fail();
  }
}
/** Caller verifies dedicated target/TLS/owner and obtains hosted-write approval.
 * Initial pin only. No rotation, activation of disabled history, login or grants.
 */
export async function configureInitialLedgerPolicy(
  client,
  input,
  { apply = false, verifyPrerequisites = async () => {} } = {},
) {
  if (typeof apply !== 'boolean' || typeof verifyPrerequisites !== 'function')
    throw fail();
  const plan = validateInitialLedgerPolicyPlan(input, input?.recipient);
  let transaction = false;
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    transaction = true;
    await client.query("SET LOCAL statement_timeout='5s'");
    if (apply)
      await client.query(
        'LOCK TABLE fmv.restore_ledger_policies IN SHARE ROW EXCLUSIVE MODE',
      );
    await verifyPrerequisites(client);
    const rows = (
      await client.query(
        'SELECT id,ledger_id,environment,recipient,recipient_sha256,enabled FROM fmv.restore_ledger_policies LIMIT 2',
      )
    ).rows;
    const matches = (row) =>
      row.id === plan.policyId &&
      row.ledger_id === plan.ledgerId &&
      row.environment === plan.environment &&
      row.recipient === plan.recipient &&
      row.recipient_sha256 === plan.recipientSha256 &&
      row.enabled === true;
    if (rows.length > 1 || (rows.length === 1 && !matches(rows[0])))
      throw fail();
    const present = rows.length === 1;
    if (apply && !present) {
      await client.query(
        'INSERT INTO fmv.restore_ledger_policies(id,ledger_id,environment,recipient,recipient_sha256,enabled) VALUES($1::uuid,$2,$3,$4,$5,true)',
        [
          plan.policyId,
          plan.ledgerId,
          plan.environment,
          plan.recipient,
          plan.recipientSha256,
        ],
      );
      const verified = (
        await client.query(
          'SELECT id,ledger_id,environment,recipient,recipient_sha256,enabled FROM fmv.restore_ledger_policies LIMIT 2',
        )
      ).rows;
      if (verified.length !== 1 || !matches(verified[0])) throw fail();
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    transaction = false;
    return {
      initialPolicyMatches: present || apply,
      hostedPolicyWritten: apply && !present,
      readOnly: !apply,
      operatorLoginEnabled: false,
      cloudPublishingEnabled: false,
    };
  } catch {
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    throw fail();
  }
}

export function developmentLedgerMigrationUrl(raw) {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'postgresql:' ||
      url.hash ||
      !url.password ||
      ['schema', 'sslmode', 'sslrootcert'].some(
        (key) => url.searchParams.getAll(key).length !== 1,
      ) ||
      [...url.searchParams.keys()].some(
        (key) => !['schema', 'sslmode', 'sslrootcert'].includes(key),
      ) ||
      url.username !== `postgres.${developmentLedgerTarget}` ||
      !url.hostname.endsWith('.pooler.supabase.com') ||
      url.port !== '5432' ||
      url.pathname !== '/postgres' ||
      url.searchParams.get('schema') !== 'fmv' ||
      url.searchParams.get('sslmode') !== 'verify-full' ||
      !url.searchParams.get('sslrootcert')
    )
      throw fail();
    return url;
  } catch {
    throw fail();
  }
}
