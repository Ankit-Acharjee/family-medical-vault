// Optional disposable verification using an already-installed PostgreSQL binary.
// Never reads project/cloud credentials or touches a retained database cluster.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { createRequire } from 'node:module';
import net from 'node:net';
const root = fileURLToPath(new URL('../../', import.meta.url));
const { Client } = createRequire(
  new URL('../../apps/server/package.json', import.meta.url),
)('pg');
const bin = path.join(
  homedir(),
  'Applications/Postgres.app/Contents/Versions/latest/bin',
);
const temporary = await mkdtemp(path.join(tmpdir(), 'fmv-db-verification-'));
const data = path.join(temporary, 'data');
let started = false;
function command(name, args) {
  const r = spawnSync(path.join(bin, name), args, {
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error || r.status !== 0)
    throw new Error(`Disposable PostgreSQL ${name} failed`);
}
try {
  const port = await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close((error) => (error ? reject(error) : resolve(p)));
    });
  });
  const ownerPassword = randomBytes(32).toString('hex'),
    appPassword = randomBytes(32).toString('hex');
  const passwordFile = path.join(temporary, 'owner-password');
  await writeFile(passwordFile, ownerPassword, { mode: 0o600 });
  command('initdb', [
    '-D',
    data,
    '--username=fmv_owner',
    '--auth-local=trust',
    '--auth-host=scram-sha-256',
    '--pwfile=' + passwordFile,
    '--encoding=UTF8',
    '--locale=C',
  ]);
  command('pg_ctl', [
    '-D',
    data,
    '-l',
    path.join(temporary, 'postgres.log'),
    '-o',
    `-h 127.0.0.1 -p ${port} -k ${temporary} -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse`,
    '-w',
    'start',
  ]);
  started = true;
  const base = `postgresql://fmv_owner:${ownerPassword}@127.0.0.1:${port}`;
  const client = new Client({
    connectionString: base + '/postgres',
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    await client.query('CREATE DATABASE fmv_dev');
    await client.query(
      `CREATE ROLE fmv_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
  } finally {
    await client.end();
  }
  const result = spawnSync(
    process.execPath,
    ['--test', 'test/integration/database.test.mjs'],
    {
      cwd: path.join(root, 'apps/server'),
      env: {
        ...process.env,
        TEST_NATIVE_POSTGRES: '1',
        TEST_DATABASE_URL: base + '/fmv_dev?schema=fmv',
        TEST_RUNTIME_URL: `postgresql://fmv_app:${appPassword}@127.0.0.1:${port}/fmv_dev?schema=fmv`,
      },
      stdio: 'inherit',
      timeout: 180000,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error('Disposable database checks failed');
} finally {
  if (started) command('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
  await rm(temporary, { recursive: true, force: true });
}
