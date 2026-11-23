// Operator-only initial public-recipient pin. Never reads a recovery private key.
import { readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import process from 'node:process';
import { withTool } from '../ci/tools.mjs';
import {
  developmentLedgerTarget,
  developmentLedgerMigrationUrl,
  initialLedgerPolicyPlan,
  validateInitialLedgerPolicyPlan,
  configureInitialLedgerPolicy,
} from '../backup/ledger-policy.mjs';
const root = new URL('../../', import.meta.url);
const { Client } = createRequire(
  new URL('../../apps/server/package.json', import.meta.url),
)('pg');
let client;
try {
  const [mode, target, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    !['--prepare-plan', '--check', '--apply'].includes(mode) ||
    (mode === '--prepare-plan'
      ? target !== undefined
      : target !== `--target=${developmentLedgerTarget}`)
  )
    throw Error();
  if (
    process.env.BACKUP_ENABLED !== 'false' ||
    process.env.BACKUP_LEDGER_ENABLED !== 'false'
  )
    throw Error();
  const publicFile = new URL('secrets/development-backup-recipient.txt', root);
  const stat = await lstat(publicFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128) throw Error();
  const raw = await readFile(publicFile, 'utf8'),
    recipient = raw.trim();
  if (raw !== recipient && raw !== recipient + '\n') throw Error();
  initialLedgerPolicyPlan({
    recipient,
    policyId: randomUUID(),
    ledgerId: randomUUID().replaceAll('-', ''),
  });
  // age validates the actual public-recipient checksum, without a private key.
  await withTool('age', async (age) => {
    const result = spawnSync(age, ['-r', recipient], {
      input: Buffer.from('SYNTHETIC ledger recipient validation'),
      timeout: 10000,
      maxBuffer: 65536,
      env: { PATH: '/usr/bin:/bin' },
    });
    if (result.error || result.status !== 0 || !result.stdout.length)
      throw Error();
  });
  const planFile = new URL('.local/development-ledger-policy-plan.json', root);
  let plan;
  try {
    const metadata = await lstat(planFile);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 2048)
      throw Error();
    const text = await readFile(planFile, 'utf8');
    plan = validateInitialLedgerPolicyPlan(JSON.parse(text), recipient);
    if (text !== JSON.stringify(plan) + '\n') throw Error();
  } catch (error) {
    if (error.code !== 'ENOENT' || mode !== '--prepare-plan') throw error;
    plan = initialLedgerPolicyPlan({
      recipient,
      policyId: randomUUID(),
      ledgerId: randomUUID().replaceAll('-', ''),
    });
    await writeFile(planFile, JSON.stringify(plan) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
  }
  if (mode === '--prepare-plan') {
    process.stdout.write(
      JSON.stringify({
        localPlanReady: true,
        publicRecipientValidated: true,
        privateRecoveryKeyRead: false,
        hostedWrites: false,
      }) + '\n',
    );
  } else {
    const url = developmentLedgerMigrationUrl(
      process.env.DATABASE_MIGRATION_URL,
    );
    client = new Client({
      connectionString: url.href,
      connectionTimeoutMillis: 8000,
      options: '-c timezone=UTC',
    });
    await client.connect();
    if (client.connection.stream.authorized !== true) throw Error();
    const verifyPrerequisites = async (client) => {
      if (
        (await client.query('SELECT current_database() AS name')).rows[0]
          .name !== 'postgres' ||
        (await client.query('SELECT current_user AS name')).rows[0].name !==
          'postgres' ||
        (await client.query('SHOW timezone')).rows[0].TimeZone !== 'UTC'
      )
        throw Error();
      const folders = (
        await readdir(new URL('apps/server/prisma/migrations/', root), {
          withFileTypes: true,
        })
      )
        .filter((f) => f.isDirectory())
        .map((f) => f.name);
      const migrations = (
        await client.query(
          'SELECT migration_name,checksum,finished_at,rolled_back_at FROM fmv._prisma_migrations',
        )
      ).rows;
      if (
        folders.length !== 34 ||
        migrations.length !== 34 ||
        new Set(migrations.map((row) => row.migration_name)).size !== 34 ||
        folders.slice().sort().join(',') !==
          migrations
            .map((row) => row.migration_name)
            .sort()
            .join(',')
      )
        throw Error();
      for (const row of migrations) {
        if (
          !folders.includes(row.migration_name) ||
          !row.finished_at ||
          row.rolled_back_at
        )
          throw Error();
        const bytes = await readFile(
          new URL(
            `apps/server/prisma/migrations/${row.migration_name}/migration.sql`,
            root,
          ),
        );
        if (createHash('sha256').update(bytes).digest('hex') !== row.checksum)
          throw Error();
      }
      const role = (
        await client.query(
          "SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit,rolreplication FROM pg_roles WHERE rolname='fmv_ledger_stager'",
        )
      ).rows[0];
      if (!role || Object.values(role).some(Boolean)) throw Error();
      const memberships = (
        await client.query(
          "SELECT count(*)::int n FROM pg_auth_members m WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname='fmv_ledger_stager') OR (m.roleid=(SELECT oid FROM pg_roles WHERE rolname='fmv_ledger_stager') AND NOT(m.member=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option))",
        )
      ).rows[0].n;
      if (memberships !== 0) throw Error();
      if (
        (
          await client.query(
            "SELECT has_function_privilege('fmv_app','fmv.stage_restore_event(uuid,uuid,text,bytea)','EXECUTE') allowed",
          )
        ).rows[0].allowed
      )
        throw Error();
      for (const table of [
        'restore_ledger_policies',
        'restore_ledger_publications',
      ]) {
        const flags = (
          await client.query(
            "SELECT relrowsecurity,relforcerowsecurity,has_table_privilege('fmv_app',oid,'SELECT') app_read,has_table_privilege('fmv_ledger_stager',oid,'INSERT') stage_write FROM pg_class WHERE oid=$1::regclass",
            ['fmv.' + table],
          )
        ).rows[0];
        if (
          !flags?.relrowsecurity ||
          !flags.relforcerowsecurity ||
          flags.app_read ||
          flags.stage_write
        )
          throw Error();
      }
    };
    const result = await configureInitialLedgerPolicy(client, plan, {
      apply: mode === '--apply',
      verifyPrerequisites,
    });
    process.stdout.write(
      JSON.stringify({
        publicRecipientValidated: true,
        privateRecoveryKeyRead: false,
        ...result,
      }) + '\n',
    );
  }
} catch {
  process.stderr.write(
    'Initial ledger policy check failed. No configuration values or key material printed. Review the fixed public-recipient file, local plan, explicit mode/target and verified development connection.\n',
  );
  process.exitCode = 1;
} finally {
  if (client) {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}
