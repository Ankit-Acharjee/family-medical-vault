import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { developmentLedgerMigrationUrl } from './ledger-policy.mjs';
const fail = () =>
  new Error('Private development owner session is unavailable');
export function ownerPasswordEntry(raw) {
  try {
    const url = developmentLedgerMigrationUrl(raw);
    const password = decodeURIComponent(url.password);
    if (/[\r\n\0]/.test(password)) throw fail();
    return (
      [url.hostname, url.port, 'postgres', url.username, password]
        .map((value) => value.replaceAll('\\', '\\\\').replaceAll(':', '\\:'))
        .join(':') + '\n'
    );
  } catch {
    throw fail();
  }
}
/** A private libpq password file, never a password in command arguments/env.
 * The trusted local psql child consumes it; delete it on normal/error exit.
 */
export async function withOwnerPasswordFile(raw, action) {
  let directory;
  try {
    const url = developmentLedgerMigrationUrl(raw),
      entry = ownerPasswordEntry(raw);
    directory = await mkdtemp(path.join(tmpdir(), 'fmv-owner-psql-'));
    const passfile = path.join(directory, 'pgpass');
    await writeFile(passfile, entry, { mode: 0o600, flag: 'wx' });
    return await action(
      Object.freeze({
        args: [
          '--no-psqlrc',
          '--set=ON_ERROR_STOP=1',
          '--host=' + url.hostname,
          '--port=' + url.port,
          '--dbname=postgres',
          '--username=' + url.username,
        ],
        env: {
          PATH: '/usr/bin:/bin',
          PGPASSFILE: passfile,
          PGSSLMODE: 'verify-full',
          PGSSLROOTCERT: url.searchParams.get('sslrootcert'),
          PGOPTIONS: '-c timezone=UTC',
          PGAPPNAME: 'fmv-development-private-owner-session',
        },
      }),
    );
  } catch {
    throw fail();
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
