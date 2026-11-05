import process from 'node:process';
import { spawnSync } from 'node:child_process';

async function verify() {
  const response = await globalThis.fetch('http://127.0.0.1:3000/health', {
    signal: globalThis.AbortSignal.timeout(5_000),
  });
  if (
    !response.ok ||
    JSON.stringify(await response.json()) !== JSON.stringify({ status: 'ok' })
  )
    throw new Error();
  if (
    !response.headers.get('x-request-id') ||
    response.headers.get('cache-control') !== 'no-store'
  )
    throw new Error();
  const result = spawnSync(
    'docker',
    [
      'exec',
      'family-medical-vault-dev-api-1',
      'node',
      '-e',
      `
    const fs = require('node:fs');
    if (process.getuid() === 0) process.exit(1);
    if (fs.existsSync('/app/prisma') || fs.existsSync('/app/.env')) process.exit(1);
    try { require.resolve('prisma'); process.exit(1); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') process.exit(1); }
    try { fs.writeFileSync('/app/write-probe', 'probe'); process.exit(1); } catch (error) { if (error.code !== 'EROFS' && error.code !== 'EACCES') process.exit(1); }
  `,
    ],
    { encoding: 'utf8', timeout: 10_000 },
  );
  if (result.error || result.status !== 0) throw new Error();
  process.stdout.write(
    'Container health, non-root runtime, restricted filesystem and excluded migration tooling verified.\n',
  );
}

verify().catch(() => {
  process.stderr.write(
    'Local container verification failed; no response or environment content was logged.\n',
  );
  process.exitCode = 1;
});
