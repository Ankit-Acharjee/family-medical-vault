import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  lstatSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const script = fileURLToPath(new URL('../tools/r2-smoke.mjs', import.meta.url));
const env = {
  ...process.env,
  R2_ENABLED: 'false',
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_BUCKET: 'fmv-private-fixture',
  R2_ACCESS_KEY_ID: 'fixture-access',
  R2_SECRET_ACCESS_KEY: 'fixture-secret',
};
for (const name of Object.keys(env))
  if (
    name.startsWith('VITE_R2_') ||
    ['R2_ENDPOINT', 'R2_PUBLIC_URL'].includes(name)
  )
    delete env[name];
function run(args, values = env, scriptPath = script) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    env: values,
    encoding: 'utf8',
    timeout: 5000,
  });
}
test('R2 smoke target inspection hashes only configured identity and requires no network or write', () => {
  const result = run(['--show-target']);
  assert.equal(result.status, 0);
  const digest = createHash('sha256')
    .update(JSON.stringify([env.R2_ACCOUNT_ID, env.R2_BUCKET]))
    .digest('hex');
  assert.equal(
    result.stdout.trim(),
    `Development R2 target fingerprint: ${digest}`,
  );
  assert.ok(!result.stdout.includes(env.R2_SECRET_ACCESS_KEY));
});

// Run a temporary copy with only its adapter import replaced. This exercises
// real journal/permission/fsync behavior while making provider IO impossible.
function isolatedProbe(work) {
  const temporary = mkdtempSync(path.join(tmpdir(), 'fmv-smoke-cli-'));
  const root = path.join(temporary, 'project'),
    tool = path.join(root, 'apps/server/tools/r2-smoke.mjs'),
    adapter = path.join(temporary, 'fake-adapter.mjs');
  mkdirSync(path.dirname(tool), { recursive: true });
  const fake = `import {readFileSync,readdirSync} from 'node:fs';import path from 'node:path';
 export class R2ObjectStore {
  async put(key,bytes){const d=path.join(${JSON.stringify(root)},'.local/r2-probes');const found=readdirSync(d).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(path.join(d,f),'utf8'))).some(r=>r.objectKey===key);if(!found)throw Error('missing reservation');this.bytes=bytes;if(process.env.FMV_SMOKE_TEST_FAILURE==='put')throw Error('synthetic provider failure');}
  async get(){if(process.env.FMV_SMOKE_TEST_FAILURE==='get')throw Error('synthetic provider failure');return this.bytes;}
  async remove(){if(process.env.FMV_SMOKE_TEST_FAILURE==='delete')throw Error('synthetic provider failure');}
  destroy(){}
 }`;
  writeFileSync(adapter, fake);
  const config = fileURLToPath(
    new URL('../dist/documents/storage.config.js', import.meta.url),
  );
  let source = readFileSync(script, 'utf8');
  assert.ok(source.includes("'../dist/documents/r2-object-store.js'"));
  source = source
    .replace("'../dist/documents/storage.config.js'", JSON.stringify(config))
    .replace("'../dist/documents/r2-object-store.js'", JSON.stringify(adapter));
  writeFileSync(tool, source);
  try {
    return work({ root, tool });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
const confirmedArgs = [
  '--confirm-private-development-write',
  '--expect-target=' +
    createHash('sha256')
      .update(JSON.stringify([env.R2_ACCOUNT_ID, env.R2_BUCKET]))
      .digest('hex'),
];
test('confirmed smoke flow reserves immutable private recovery data before IO and retains uncertain outcomes', () => {
  for (const failure of ['', 'put', 'get', 'delete'])
    isolatedProbe(({ root, tool }) => {
      const result = run(
        confirmedArgs,
        { ...env, FMV_SMOKE_TEST_FAILURE: failure },
        tool,
      );
      assert.equal(result.status, failure ? 1 : 0);
      const directory = path.join(root, '.local/r2-probes');
      assert.equal(lstatSync(directory).mode & 0o077, 0);
      const files = readdirSync(directory),
        reservation = files.find((f) => f.endsWith('.json'));
      assert.ok(reservation);
      assert.equal(
        lstatSync(path.join(directory, reservation)).mode & 0o077,
        0,
      );
      const immutable = JSON.parse(
        readFileSync(path.join(directory, reservation), 'utf8'),
      );
      assert.deepEqual(Object.keys(immutable).sort(), [
        'createdAt',
        'objectKey',
        'target',
        'version',
      ]);
      assert.match(immutable.objectKey, /^[a-f0-9]{32}$/);
      const statuses = readFileSync(
        path.join(directory, reservation + '.status'),
        'utf8',
      )
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(statuses[0].putAttempted, true);
      const last = statuses.at(-1);
      assert.equal(last.uncertain, !!failure);
      assert.equal(last.roundtripVerified, !['put', 'get'].includes(failure));
      assert.equal(last.cleanupAcknowledged, failure !== 'delete');
      assert.ok(!result.stdout.includes(immutable.objectKey));
      assert.ok(!result.stderr.includes(env.R2_SECRET_ACCESS_KEY));
    });
});
test('confirmed smoke refuses insecure or symlinked recovery directories before provider IO', () => {
  for (const kind of ['insecure', 'symlink'])
    isolatedProbe(({ root, tool }) => {
      const local = path.join(root, '.local');
      if (kind === 'insecure') mkdirSync(local, { mode: 0o755 });
      else {
        const other = path.join(root, 'other');
        mkdirSync(other, { mode: 0o700 });
        symlinkSync(other, local);
      }
      const result = run(confirmedArgs, env, tool);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.ok(!readdirSync(root).includes('r2-probes'));
    });
});
test('R2 smoke refuses absent write approval, wrong target and unknown arguments before provider IO', () => {
  for (const args of [
    [],
    ['--confirm-private-development-write'],
    ['--confirm-private-development-write', '--expect-target=wrong'],
    ['--show-target', '--confirm-private-development-write'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes(env.R2_SECRET_ACCESS_KEY));
  }
});
test('R2 smoke refuses incomplete configuration without printing values or attempting provider IO', () => {
  const result = run(['--show-target'], { ...env, R2_ACCESS_KEY_ID: '' });
  assert.equal(result.status, 1);
  assert.ok(!result.stderr.includes(env.R2_SECRET_ACCESS_KEY));
  assert.equal(result.stdout, '');
});
