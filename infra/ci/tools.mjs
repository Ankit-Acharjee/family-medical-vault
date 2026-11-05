import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  chmod,
} from 'node:fs/promises';
import { join, resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, URL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(
  await readFile(new URL('./tools.lock.json', import.meta.url), 'utf8'),
);

export class CheckError extends Error {}

export function verifyArchive(bytes, expected) {
  if (createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new CheckError(
      'CI tool checksum verification failed; nothing was executed.',
    );
  }
}

export async function withTool(name, run) {
  const spec = manifest[name];
  const asset = spec?.assets[`${process.platform}-${process.arch}`];
  if (!asset) throw new CheckError('CI tool is unsupported on this platform.');
  const cache = join(root, '.local', 'ci-tools');
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const archive = join(cache, asset.file);
  let bytes;
  try {
    if (!(await lstat(archive)).isFile())
      throw new CheckError('CI tool cache is not a regular file.');
    bytes = await readFile(archive);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await globalThis.fetch(
      `https://github.com/${spec.repo}/releases/download/v${spec.version}/${asset.file}`,
      { signal: globalThis.AbortSignal.timeout(120_000) },
    );
    if (!response.ok) throw new CheckError('CI tool download failed.');
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 64 * 1024 * 1024)
        throw new CheckError('CI tool download exceeded the size limit.');
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
    verifyArchive(bytes, asset.sha256);
    // An interrupted write cannot become a trusted archive on the next run.
    const temporary = `${archive}.${randomBytes(8).toString('hex')}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
    try {
      await copyFile(temporary, archive);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  verifyArchive(bytes, asset.sha256);
  const directory = await mkdtemp(join(tmpdir(), 'fmv-ci-tool-'));
  try {
    const extraction = spawnSync(
      'tar',
      ['-xzf', archive, '-C', directory, '--', name],
      { encoding: 'utf8' },
    );
    const executable = join(directory, name);
    if (
      extraction.error ||
      extraction.status !== 0 ||
      !(await lstat(executable)).isFile()
    ) {
      throw new CheckError('CI tool extraction failed.');
    }
    await chmod(executable, 0o700);
    return await run(executable);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function runSecretScan(executable, args, cwd = root) {
  const result = spawnSync(
    executable,
    [...args, '--redact=100', '--no-banner'],
    {
      cwd,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  // Scanner findings can contain health content or secrets even outside the match.
  // Never print captured lines, paths, snippets, errors, or a report artifact.
  if (result.error || result.signal || result.status !== 0) {
    throw new CheckError(
      result.status === 1
        ? 'Secret detection blocked this change. Review locally with redaction.'
        : 'Secret detection could not complete; the gate failed closed.',
    );
  }
}

export function runWorkflowCheck(executable, files = [], cwd = root) {
  const result = spawnSync(executable, ['-shellcheck=', ...files], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error || result.status !== 0)
    throw new CheckError(
      'Workflow validation failed. Review the workflow with actionlint locally.',
    );
}

async function scanSource(executable) {
  runSecretScan(executable, ['git', '--log-opts=--all']);
  const listed = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
  );
  if (listed.error || listed.status !== 0)
    throw new CheckError('Source enumeration failed.');
  const directory = await mkdtemp(join(tmpdir(), 'fmv-source-scan-'));
  try {
    for (const file of new Set(listed.stdout.split('\0').filter(Boolean))) {
      const source = resolve(root, file);
      const path = relative(root, source);
      if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`))
        throw new CheckError('Source path is outside the repository.');
      let stat;
      try {
        stat = await lstat(source);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      if (!stat.isFile())
        throw new CheckError(
          'Source scanner requires regular files; review symlinks or submodules.',
        );
      const destination = join(directory, path);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await copyFile(source, destination);
    }
    runSecretScan(executable, ['dir', directory]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main(command) {
  if (command === 'secrets') await withTool('gitleaks', scanSource);
  else if (command === 'lint') await withTool('actionlint', runWorkflowCheck);
  else throw new CheckError('Unknown CI tool command.');
  process.stdout.write(
    `${command === 'secrets' ? 'Secret detection' : 'Workflow validation'} passed.\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv[2]).catch((error) => {
    process.stderr.write(
      `${error instanceof CheckError ? error.message : 'CI tool check could not complete; the gate failed closed.'}\n`,
    );
    process.exitCode = 1;
  });
}
