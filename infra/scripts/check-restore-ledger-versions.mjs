import process from 'node:process';
import {
  restoreLedgerDestinationConfig,
  checkRestoreLedgerVersionDiscovery,
} from '../backup/b2-preflight.mjs';
try {
  if (process.argv.length !== 2) throw Error();
  const flags = await checkRestoreLedgerVersionDiscovery(
    restoreLedgerDestinationConfig(process.env),
  );
  process.stdout.write(JSON.stringify(flags) + '\n');
} catch {
  process.stderr.write(
    'Ledger version metadata verification failed; no complete history, immutability or restore readiness is claimed. No provider details printed.\n',
  );
  process.exitCode = 1;
}
