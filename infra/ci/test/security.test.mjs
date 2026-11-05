import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import {
  CheckError,
  runSecretScan,
  runWorkflowCheck,
  verifyArchive,
  withTool,
} from '../tools.mjs';

test('tampered CI tool archives are rejected before execution', () => {
  assert.throws(
    () => verifyArchive(Buffer.from('tampered archive'), '0'.repeat(64)),
    /checksum verification failed/,
  );
});

test('secret detection accepts clean source and blocks generated synthetic credentials without exposing findings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fmv-secret-gate-test-'));
  try {
    await writeFile(
      join(directory, 'fixture.txt'),
      'Synthetic source without credentials.\n',
    );
    await withTool('gitleaks', async (executable) => {
      runSecretScan(executable, ['dir', directory]);
      const synthetic = ['gh', 'p_', randomBytes(18).toString('hex')].join('');
      await writeFile(
        join(directory, 'fixture.txt'),
        `GITHUB_TOKEN=${synthetic}\n`,
      );
      assert.throws(
        () => runSecretScan(executable, ['dir', directory]),
        (error) => {
          assert.ok(error instanceof CheckError);
          assert.ok(
            error.message ===
              'Secret detection blocked this change. Review locally with redaction.',
          );
          assert.ok(!error.message.includes(synthetic));
          assert.ok(!error.message.includes(directory));
          return true;
        },
      );
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a scanner execution failure blocks the gate and hides captured output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fmv-scanner-failure-test-'));
  try {
    const executable = join(directory, 'scanner');
    await writeFile(
      executable,
      '#!/bin/sh\necho synthetic-private-content\necho synthetic-private-content >&2\nexit 2\n',
      { mode: 0o700 },
    );
    assert.throws(
      () => runSecretScan(executable, ['dir', directory]),
      (error) => {
        assert.ok(
          error.message ===
            'Secret detection could not complete; the gate failed closed.',
        );
        assert.ok(!error.message.includes('synthetic-private-content'));
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('workflow validation rejects malformed workflows', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fmv-workflow-gate-test-'));
  try {
    const workflow = join(directory, 'invalid.yml');
    await writeFile(workflow, 'name: invalid\non: push\njobs: []\n');
    await withTool('actionlint', async (executable) => {
      assert.throws(
        () => runWorkflowCheck(executable, [workflow], directory),
        /Workflow validation failed/,
      );
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
