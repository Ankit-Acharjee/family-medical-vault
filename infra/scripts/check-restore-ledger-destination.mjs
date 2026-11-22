import process from 'node:process';
import {
  restoreLedgerDestinationConfig,
  checkRestoreLedgerDestination,
} from '../backup/b2-preflight.mjs';
try {
  if (process.argv.length !== 2) throw Error();
  const result = await checkRestoreLedgerDestination(
    restoreLedgerDestinationConfig(process.env),
  );
  process.stdout.write(JSON.stringify(result) + '\n');
} catch {
  process.stderr.write(
    'Ledger read-only preflight failed. Check private ledger configuration, separate private bucket, read-only key scope and absent lifecycle rules. No provider details printed.\n',
  );
  process.exitCode = 1;
}
