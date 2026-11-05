import process from 'node:process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const localDirectory = join(root, '.local');
const composeFile = join(root, 'infra/compose.yaml');
const developmentProject = 'family-medical-vault-dev';

class LocalConfigError extends Error {}

export function readLocalEnvironment(directory = localDirectory) {
  if (!existsSync(directory))
    throw new LocalConfigError('Run pnpm local:setup first.');
  const directoryStat = lstatSync(directory);
  if (
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink() ||
    (directoryStat.mode & 0o077) !== 0
  ) {
    throw new LocalConfigError(
      'Local state directory must be private (chmod 700) and not a symlink.',
    );
  }
  const path = join(directory, 'compose.env');
  if (!existsSync(path))
    throw new LocalConfigError('Run pnpm local:setup first.');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new LocalConfigError(
      'Local configuration must be a private regular file (chmod 600).',
    );
  }
  const entries = readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('='));
  const values = Object.fromEntries(entries);
  if (
    entries.length !== 3 ||
    entries.some((entry) => entry.length !== 2) ||
    Object.keys(values).sort().join(',') !==
      'LOCAL_API_PORT,LOCAL_DB_APP_PASSWORD,LOCAL_DB_OWNER_PASSWORD' ||
    !/^[a-f0-9]{64}$/.test(values['LOCAL_DB_OWNER_PASSWORD']) ||
    !/^[a-f0-9]{64}$/.test(values['LOCAL_DB_APP_PASSWORD']) ||
    values['LOCAL_DB_OWNER_PASSWORD'] === values['LOCAL_DB_APP_PASSWORD'] ||
    !/^\d+$/.test(values['LOCAL_API_PORT']) ||
    Number(values['LOCAL_API_PORT']) < 1 ||
    Number(values['LOCAL_API_PORT']) > 65535
  ) {
    throw new LocalConfigError(
      'Local configuration is invalid; preserve existing database passwords when repairing it.',
    );
  }
  return values;
}

export function setupLocalEnvironment(directory = localDirectory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStat = lstatSync(directory);
  if (
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink() ||
    (directoryStat.mode & 0o077) !== 0
  ) {
    throw new LocalConfigError(
      'Local state directory must be private (chmod 700) and not a symlink.',
    );
  }
  const path = join(directory, 'compose.env');
  if (!existsSync(path)) {
    writeFileSync(
      path,
      `LOCAL_DB_OWNER_PASSWORD=${randomBytes(32).toString('hex')}\nLOCAL_DB_APP_PASSWORD=${randomBytes(32).toString('hex')}\nLOCAL_API_PORT=3000\n`,
      { mode: 0o600, flag: 'wx' },
    );
  }
  readLocalEnvironment(directory);
}

function compose(arguments_, values, project = developmentProject) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      project,
      '--env-file',
      join(localDirectory, 'compose.env'),
      '--file',
      composeFile,
      ...arguments_,
    ],
    {
      cwd: root,
      // Explicit local values override shell variables; no cloud URL is accepted by this runner.
      env: { ...process.env, ...values },
      stdio: 'inherit',
    },
  );
  if (result.error || result.status !== 0)
    throw new LocalConfigError(
      'Docker command failed; inspect the preceding output.',
    );
}

export async function main(command, args = []) {
  if (command === 'setup' || command === 'up') setupLocalEnvironment();
  const values = readLocalEnvironment();
  switch (command) {
    case 'setup':
      process.stdout.write(
        'Local credentials are ready in ignored .local/compose.env.\n',
      );
      break;
    case 'up':
      compose(['build', 'migrate', 'api'], values);
      compose(['up', '--detach', '--wait', 'api'], values);
      process.stdout.write(
        `Local API: http://127.0.0.1:${values['LOCAL_API_PORT']}/health\n`,
      );
      break;
    case 'down':
      // Keep the development volume and its matching credentials.
      compose(['down'], values);
      break;
    case 'status':
      compose(['ps', '--all'], values);
      break;
    case 'migrate':
      compose(['run', '--rm', 'migrate'], values);
      break;
    case 'db-status':
      compose(['run', '--rm', 'migration-dev', 'pnpm', 'db:status'], values);
      break;
    case 'migration': {
      const name = args.filter((argument) => argument !== '--')[0];
      if (
        args.filter((argument) => argument !== '--').length !== 1 ||
        !/^[a-z][a-z0-9_]{1,63}$/.test(name ?? '')
      ) {
        throw new LocalConfigError(
          'Supply one snake_case migration name: pnpm db:migration -- add_example.',
        );
      }
      compose(
        [
          'run',
          '--rm',
          'migration-dev',
          'pnpm',
          'db:migration',
          '--name',
          name,
        ],
        values,
      );
      break;
    }
    case 'test': {
      // Only this generated, disposable project is ever removed with --volumes.
      const project = `family-medical-vault-test-${randomBytes(8).toString('hex')}`;
      compose(['build', 'migrate'], values);
      try {
        compose(['up', '--detach', '--wait', 'postgres'], values, project);
        compose(['run', '--rm', 'db-tests'], values, project);
      } finally {
        compose(['down', '--volumes'], values, project);
      }
      break;
    }
    default:
      throw new LocalConfigError('Unknown local environment command.');
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv[2], process.argv.slice(3)).catch((error) => {
    process.stderr.write(
      `${error instanceof LocalConfigError ? error.message : 'Local environment operation failed.'}\n`,
    );
    process.exitCode = 1;
  });
}
