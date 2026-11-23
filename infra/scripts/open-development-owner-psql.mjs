// Run in the user's terminal. This opens psql; it executes no setup SQL itself.
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import {
  developmentLedgerTarget,
  developmentLedgerMigrationUrl,
} from '../backup/ledger-policy.mjs';
import { withOwnerPasswordFile } from '../backup/owner-psql-session.mjs';
let child, pendingSignal, killTimer;
const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const handlers = new Map(
  signals.map((signal) => [
    signal,
    () => {
      if (signal === 'SIGINT' && child) {
        child.kill(signal);
        return;
      }
      pendingSignal = signal;
      if (child) {
        child.kill(signal);
        if (signal !== 'SIGINT' && !killTimer)
          killTimer = setTimeout(() => child?.kill('SIGKILL'), 5000);
      }
    },
  ]),
);
try {
  const [target, mode, ...extra] = process.argv.slice(2);
  if (
    target !== `--target=${developmentLedgerTarget}` ||
    extra.length ||
    (mode !== undefined && mode !== '--check') ||
    process.env.BACKUP_ENABLED !== 'false' ||
    process.env.BACKUP_LEDGER_ENABLED !== 'false'
  )
    throw Error();
  developmentLedgerMigrationUrl(process.env.DATABASE_MIGRATION_URL);
  const psql = path.join(
    homedir(),
    'Applications/Postgres.app/Contents/Versions/latest/bin/psql',
  );
  await access(psql, constants.X_OK);
  if (mode === '--check')
    process.stdout.write(
      JSON.stringify({
        developmentTargetValidated: true,
        psqlAvailable: true,
        sessionOpened: false,
        passwordFileCreated: false,
      }) + '\n',
    );
  else {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error();
    for (const [signal, handler] of handlers) process.on(signal, handler);
    process.exitCode = await withOwnerPasswordFile(
      process.env.DATABASE_MIGRATION_URL,
      async ({ args, env }) => {
        if (pendingSignal) throw Error();
        child = spawn(psql, args, { stdio: 'inherit', env });
        return await new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code) => resolve(code ?? 1));
        });
      },
    );
  }
} catch {
  if (!pendingSignal)
    process.stderr.write(
      'Private owner session unavailable. Use the explicit development target and an interactive terminal with installed Postgres.app. No credential values printed.\n',
    );
  process.exitCode = 1;
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler);
  if (killTimer) clearTimeout(killTimer);
  if (pendingSignal)
    process.exitCode = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[
      pendingSignal
    ];
}
