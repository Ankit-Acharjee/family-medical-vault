import process from 'node:process';
import {
  backupDestinationConfig,
  checkBackupDestination,
} from '../backup/b2-preflight.mjs';
// Read-only metadata operations only; no files listed/read/written/deleted.
try {
  if (process.argv.length !== 2) throw Error();
  const result = await checkBackupDestination(
    backupDestinationConfig(process.env),
  );
  process.stdout.write(JSON.stringify(result) + '\n');
} catch {
  process.stderr.write(
    'B2 read-only preflight failed. Check private configuration, private bucket and bucket-restricted read-only key; no provider details printed.\n',
  );
  process.exitCode = 1;
}
