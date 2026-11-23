import process from 'node:process';
import {
  restoreLedgerProducerConfig,
  checkRestoreLedgerProducer,
} from '../backup/b2-preflight.mjs';

try {
  if (process.argv.length !== 2) throw Error();
  const result = await checkRestoreLedgerProducer(
    restoreLedgerProducerConfig(process.env),
  );
  process.stdout.write(JSON.stringify(result) + '\n');
} catch {
  process.stderr.write(
    'Ledger producer authorization preflight failed. Check separate producer credentials, exact ledger bucket/prefix and writeFiles-only scope. No provider publishing attempted or credential values printed.\n',
  );
  process.exitCode = 1;
}
