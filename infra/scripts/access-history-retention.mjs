import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import console from 'node:console';
import { resolve } from 'node:path';

// SEC-04: only these ordinary access classes have an approved purge policy.
// Clinical, permission, account, sharing-creation and activation history is excluded.
const classes = [
  {
    key: 'documentAccess',
    table: 'document_events',
    time: 'occurred_at',
    kinds: "'document.viewed','document.exported'",
  },
  {
    key: 'anonymousLinkAccess',
    table: 'temporary_link_access_events',
    time: 'recorded_at',
    kinds: "'link.opened','original.accessed'",
  },
];
export class RetentionError extends Error {}
export function retentionConfig(args, environment = process.env) {
  const allowed = new Set([
    '--apply',
    '--target=local',
    '--target=nyjkrcznezyrgntwvpjj',
    '--confirm=purge-ordinary-access-history',
  ]);
  if (new Set(args).size !== args.length || args.some((a) => !allowed.has(a)))
    throw new RetentionError('Unsupported retention arguments.');
  const targets = args.filter((a) => a.startsWith('--target='));
  if (targets.length !== 1)
    throw new RetentionError('Choose exactly one explicit development target.');
  const apply = args.includes('--apply'),
    confirmed = args.includes('--confirm=purge-ordinary-access-history');
  if (apply !== confirmed)
    throw new RetentionError(
      'Apply requires the exact ordinary-history confirmation.',
    );
  let url;
  try {
    url = new URL(environment.DATABASE_MAINTENANCE_URL);
  } catch {
    throw new RetentionError(
      'Configure a separate private maintenance connection.',
    );
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.password ||
    url.hash
  )
    throw new RetentionError('Invalid maintenance connection.');
  const local = targets[0] === '--target=local';
  const keys = [...url.searchParams.keys()],
    allowedKeys = new Set(
      local ? ['schema'] : ['schema', 'sslmode', 'sslrootcert'],
    );
  if (
    new Set(keys).size !== keys.length ||
    keys.some((key) => !allowedKeys.has(key)) ||
    (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'fmv')
  )
    throw new RetentionError('Unsupported connection parameters.');
  if (local) {
    if (
      url.hostname !== '127.0.0.1' ||
      url.pathname !== '/fmv_dev' ||
      url.username !== 'fmv_owner' ||
      !url.port
    )
      throw new RetentionError(
        'Local target must be the explicit disposable development database.',
      );
  } else if (
    url.hostname !== 'aws-0-ap-south-1.pooler.supabase.com' ||
    url.username !== 'postgres.nyjkrcznezyrgntwvpjj' ||
    url.pathname !== '/postgres' ||
    url.port !== '5432' ||
    url.searchParams.get('schema') !== 'fmv' ||
    url.searchParams.get('sslmode') !== 'verify-full' ||
    !url.searchParams.get('sslrootcert')?.startsWith('/')
  )
    throw new RetentionError(
      'Hosted target must be the approved development project with verified TLS.',
    );
  return { connectionString: url.href, apply, local };
}
/** One atomic bounded pass; callers own and close the dedicated connection. */
export async function retainOrdinaryAccess(
  client,
  { apply = false, batchSize = 500 } = {},
) {
  if (
    typeof apply !== 'boolean' ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 1000
  )
    throw new RetentionError('Invalid retention batch.');
  let transaction = false;
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    transaction = true;
    await client.query("SET LOCAL statement_timeout='8s'");
    await client.query("SET LOCAL lock_timeout='2s'");
    const role = (
      await client.query(
        "SELECT current_user name,rolsuper,rolbypassrls,(has_table_privilege(current_user,'fmv.document_events','SELECT') AND has_table_privilege(current_user,'fmv.document_events','DELETE')) document_privileges,(has_table_privilege(current_user,'fmv.temporary_link_access_events','SELECT') AND has_table_privilege(current_user,'fmv.temporary_link_access_events','DELETE')) link_privileges FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0];
    if (
      !role ||
      role.name === 'fmv_app' ||
      !(role.rolsuper || role.rolbypassrls) ||
      !role.document_privileges ||
      !role.link_privileges
    )
      throw new RetentionError(
        'A separate privileged maintenance connection is required.',
      );
    if (apply) {
      const lock = (
        await client.query(
          "SELECT pg_try_advisory_xact_lock(hashtextextended('fmv-ordinary-access-retention-v1',0)) acquired",
        )
      ).rows[0];
      if (!lock?.acquired) {
        await client.query('ROLLBACK');
        transaction = false;
        return {
          mode: 'apply',
          busy: true,
          documentAccess: 0,
          anonymousLinkAccess: 0,
        };
      }
    }
    const result = { mode: apply ? 'apply' : 'dry-run', busy: false };
    for (const entry of classes) {
      // Identifiers/kinds come only from the fixed allowlist above, never config.
      // Honor BOTH minimum age and stored deadline; malformed early deadlines
      // cannot delete recent records, and future deadlines are never shortened.
      const eligible = `FROM fmv.${entry.table} WHERE kind IN (${entry.kinds}) AND ${entry.time}<=transaction_timestamp()-interval '90 days' AND retention_until<=transaction_timestamp()`;
      if (apply) {
        const deleted = await client.query(
          `WITH candidates AS (SELECT id ${eligible} ORDER BY retention_until,id LIMIT $1 FOR UPDATE SKIP LOCKED) DELETE FROM fmv.${entry.table} e USING candidates c WHERE e.id=c.id`,
          [batchSize],
        );
        result[entry.key] = deleted.rowCount;
      } else {
        const rows = await client.query(
          `SELECT count(*)::int eligible FROM (SELECT 1 ${eligible} LIMIT $1) candidates`,
          [batchSize + 1],
        );
        result[entry.key] = {
          eligible: Math.min(rows.rows[0].eligible, batchSize),
          limited: rows.rows[0].eligible > batchSize,
        };
      }
    }
    await client.query('COMMIT');
    transaction = false;
    return result;
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
async function main() {
  let client;
  try {
    const config = retentionConfig(process.argv.slice(2));
    const { Client } = createRequire(
      new URL('../../apps/server/package.json', import.meta.url),
    )('pg');
    client = new Client({
      connectionString: config.connectionString,
      connectionTimeoutMillis: 8000,
      options: '-c timezone=UTC',
    });
    await client.connect();
    if (!config.local && client.connection.stream.authorized !== true)
      throw new RetentionError('Verified TLS required.');
    console.log(
      JSON.stringify(
        await retainOrdinaryAccess(client, { apply: config.apply }),
      ),
    );
  } catch (error) {
    // Never print URLs, arguments, SQL diagnostics or record values.
    const code =
      typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code)
        ? error.code
        : 'unavailable';
    console.error(JSON.stringify({ event: 'access_retention_failed', code }));
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => {});
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
