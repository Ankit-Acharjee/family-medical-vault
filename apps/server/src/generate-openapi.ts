import { mkdir, writeFile } from 'node:fs/promises';
import { createApplication } from './application.js';

const { app, document } = await createApplication({
  docs: false,
  log: () => {},
});
try {
  await mkdir('dist', { recursive: true });
  await writeFile(
    'dist/openapi.json',
    `${JSON.stringify(document, null, 2)}\n`,
  );
} finally {
  await app.close();
}
