import { createApplication } from './application.js';

async function bootstrap(): Promise<void> {
  const value = process.env['PORT'] ?? '3000';
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error('Invalid port configuration');
  }
  const { app } = await createApplication();
  await app.listen(Number(value), process.env['HOST'] ?? '127.0.0.1');
  process.stdout.write(`${JSON.stringify({ event: 'server_started' })}\n`);
}

bootstrap().catch(() => {
  // Never print raw startup errors: they may contain credentials or provider URIs.
  process.stderr.write(`${JSON.stringify({ event: 'server_start_failed' })}\n`);
  process.exitCode = 1;
});
