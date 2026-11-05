import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const environment = fileURLToPath(new URL('../../.env', import.meta.url));

if (existsSync(environment)) process.loadEnvFile(environment);

const child = spawn(
  'pnpm',
  [
    '--parallel',
    '--filter',
    '@fmv/server',
    '--filter',
    '@fmv/web',
    'run',
    'dev',
  ],
  { cwd: root, env: process.env, stdio: 'inherit' },
);

child.once('error', () => {
  process.stderr.write('Unable to start development services.\n');
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
