import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { developmentLedgerTarget } from '../backup/ledger-policy.mjs';

const cli = fileURLToPath(
  new URL('../scripts/prepare-development-ledger-events.mjs', import.meta.url),
);

for (const mode of ['--check', '--prepare']) {
  for (const connection of [undefined, 'replace_with_dedicated_worker_url']) {
    test(`${mode} rejects ${connection === undefined ? 'missing' : 'placeholder'} staging connection before preparation`, () => {
      const env = {
        PATH: '/usr/bin:/bin',
        BACKUP_ENABLED: 'false',
        BACKUP_LEDGER_ENABLED: 'false',
      };
      if (connection !== undefined)
        env.DATABASE_LEDGER_STAGING_URL = connection;
      // No inherited environment, private files, credential URI or DB target.
      const result = spawnSync(
        process.execPath,
        [cli, mode, `--target=${developmentLedgerTarget}`],
        {
          env,
          encoding: 'utf8',
          timeout: 5000,
          maxBuffer: 65536,
        },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /Set DATABASE_LEDGER_STAGING_URL\b/);
      assert.match(result.stderr, /No changes were made\./);
      assert.doesNotMatch(result.stderr, /some events may already be staged/i);
      assert.doesNotMatch(
        result.stderr,
        /Ledger preparation unavailable during/,
      );
      if (connection !== undefined)
        assert.ok(!result.stderr.includes(connection));
    });
  }
}
