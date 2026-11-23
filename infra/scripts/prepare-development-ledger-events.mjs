// Explicit operator preparation only. No private recovery key or provider client.
import { readFile, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import process from 'node:process';
import {
  developmentLedgerTarget,
  validateInitialLedgerPolicyPlan,
} from '../backup/ledger-policy.mjs';
import {
  developmentLedgerStagingUrl,
  prepareLedgerEvents,
} from '../backup/prepare-ledger-events.mjs';
import { withTool } from '../ci/tools.mjs';
const root = new URL('../../', import.meta.url);
const { Client } = createRequire(
  new URL('../../apps/server/package.json', import.meta.url),
)('pg');
let client;
let phase = 'configuration';
let preparationStarted = false;
const missingConnection = new Error('Missing dedicated staging connection');
try {
  const [mode, target, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    !['--check', '--prepare'].includes(mode) ||
    target !== `--target=${developmentLedgerTarget}` ||
    process.env.BACKUP_ENABLED !== 'false' ||
    process.env.BACKUP_LEDGER_ENABLED !== 'false'
  )
    throw Error();
  if (
    !process.env.DATABASE_LEDGER_STAGING_URL ||
    process.env.DATABASE_LEDGER_STAGING_URL.startsWith('replace_')
  )
    throw missingConnection;
  const readSmall = async (name, maximum) => {
    const file = new URL(name, root),
      stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum)
      throw Error();
    return readFile(file, 'utf8');
  };
  const publicText = await readSmall(
      'secrets/development-backup-recipient.txt',
      128,
    ),
    recipient = publicText.trim();
  if (publicText !== recipient && publicText !== recipient + '\n')
    throw Error();
  const rawPlan = await readSmall(
    '.local/development-ledger-policy-plan.json',
    2048,
  );
  const plan = validateInitialLedgerPolicyPlan(JSON.parse(rawPlan), recipient);
  if (rawPlan !== JSON.stringify(plan) + '\n') throw Error();
  const url = developmentLedgerStagingUrl(
    process.env.DATABASE_LEDGER_STAGING_URL,
  );
  client = new Client({
    connectionString: url.href,
    connectionTimeoutMillis: 8000,
    options: '-c timezone=UTC',
    application_name: 'fmv-development-ledger-preparation',
  });
  phase = 'connection';
  await client.connect();
  phase = 'operator permissions';
  if (
    client.connection.stream.authorized !== true ||
    (
      await client.query(
        'SELECT current_database() AS name,current_user AS role',
      )
    ).rows[0].name !== 'postgres' ||
    (await client.query('SELECT current_user AS role')).rows[0].role !==
      'fmv_ledger_worker' ||
    (await client.query('SHOW timezone')).rows[0].TimeZone !== 'UTC'
  )
    throw Error();
  const worker = (
    await client.query(
      'SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolconnlimit FROM pg_roles WHERE rolname=current_user',
    )
  ).rows[0];
  if (
    !worker.rolcanlogin ||
    worker.rolsuper ||
    worker.rolbypassrls ||
    worker.rolcreatedb ||
    worker.rolcreaterole ||
    worker.rolinherit ||
    worker.rolreplication ||
    worker.rolconnlimit !== 2
  )
    throw Error();
  const memberships = (
    await client.query(
      'SELECT r.rolname,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname=current_user)',
    )
  ).rows;
  if (
    memberships.length !== 1 ||
    memberships[0].rolname !== 'fmv_ledger_stager' ||
    memberships[0].admin_option ||
    memberships[0].inherit_option ||
    !memberships[0].set_option ||
    (
      await client.query(
        "SELECT has_schema_privilege(current_user,'fmv','USAGE') allowed",
      )
    ).rows[0].allowed
  )
    throw Error();
  const capability = (
    await client.query(
      "SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit,rolreplication FROM pg_roles WHERE rolname='fmv_ledger_stager'",
    )
  ).rows[0];
  if (!capability || Object.values(capability).some(Boolean)) throw Error();
  const edges = (
    await client.query(
      "SELECT parent.rolname AS parent,member.rolname AS member,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles member ON member.oid=m.member WHERE parent.rolname IN ('fmv_ledger_stager','fmv_ledger_worker') OR member.rolname IN ('fmv_ledger_stager','fmv_ledger_worker')",
    )
  ).rows;
  if (
    edges.some(
      (edge) =>
        !(
          (edge.parent === 'fmv_ledger_stager' &&
            edge.member === 'fmv_ledger_worker' &&
            !edge.admin_option &&
            !edge.inherit_option &&
            edge.set_option) ||
          (edge.member === 'postgres' &&
            edge.admin_option &&
            !edge.inherit_option &&
            !edge.set_option)
        ),
    )
  )
    throw Error();
  const stageAccess = (
    await client.query(
      "SELECT has_function_privilege('fmv_app',p.oid,'EXECUTE') app_execute,has_function_privilege('fmv_ledger_stager',p.oid,'EXECUTE') stage_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='fmv' AND p.proname='stage_restore_event'",
    )
  ).rows;
  if (
    stageAccess.length !== 1 ||
    stageAccess[0].app_execute ||
    !stageAccess[0].stage_execute
  )
    throw Error();
  await client.query('SET ROLE fmv_ledger_stager');
  phase = mode === '--check' ? 'read-only pin check' : 'preparation';
  preparationStarted = mode === '--prepare';
  let result;
  if (mode === '--check') result = await prepareLedgerEvents(client, plan);
  else
    result = await withTool('age', (age) =>
      prepareLedgerEvents(client, plan, {
        apply: true,
        encrypt: async (payload, publicRecipient) => {
          const encrypted = spawnSync(age, ['-r', publicRecipient], {
            input: payload,
            timeout: 10000,
            maxBuffer: 65536,
            env: { PATH: '/usr/bin:/bin' },
          });
          if (
            encrypted.error ||
            encrypted.status !== 0 ||
            !Buffer.isBuffer(encrypted.stdout)
          )
            throw Error();
          return encrypted.stdout;
        },
      }),
    );
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  if (error === missingConnection) {
    process.stderr.write(
      'Set DATABASE_LEDGER_STAGING_URL in repository-root .env using the dedicated worker credentials. No changes were made. Never paste the URL or password in chat.\n',
    );
  } else {
    const code =
      typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code)
        ? ' (code ' + error.code + ')'
        : '';
    process.stderr.write(
      'Ledger preparation unavailable during ' +
        phase +
        code +
        '. ' +
        (preparationStarted
          ? 'Some events may already be staged; retry is safe. '
          : 'No event preparation was attempted. ') +
        'No provider publishing was attempted; no record or key values printed.\n',
    );
  }
  process.exitCode = 1;
} finally {
  if (client) {
    await client.query('ROLLBACK').catch(() => {});
    await client.query('RESET ROLE').catch(() => {});
    await client.end().catch(() => {});
  }
}
