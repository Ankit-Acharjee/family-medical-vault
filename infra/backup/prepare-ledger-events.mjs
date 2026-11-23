import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import {
  developmentLedgerTarget,
  developmentLedgerMigrationUrl,
  validateInitialLedgerPolicyPlan,
} from './ledger-policy.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const header = Buffer.from('age-encryption.org/v1\n');
const fail = () =>
  new Error(
    'Ledger preparation failed; some events may already be staged. Retry is safe. No provider publishing was attempted.',
  );
/** Bounded local staging, never independent confirmation. Caller supplies a
 * verified dedicated connection already SET ROLE fmv_ledger_stager.
 */
export async function prepareLedgerEvents(
  client,
  input,
  { apply = false, encrypt } = {},
) {
  if (typeof apply !== 'boolean' || (apply && typeof encrypt !== 'function'))
    throw fail();
  const plan = validateInitialLedgerPolicyPlan(input, input?.recipient);
  let transaction = false;
  try {
    await client.query('BEGIN READ ONLY');
    transaction = true;
    await client.query("SET LOCAL statement_timeout='8s'");
    if (
      (await client.query('SELECT current_user AS name')).rows[0].name !==
      'fmv_ledger_stager'
    )
      throw fail();
    const policy = (
      await client.query(
        'SELECT id,ledger_id,environment,recipient,recipient_sha256,enabled FROM fmv.restore_ledger_policies WHERE id=$1::uuid',
        [plan.policyId],
      )
    ).rows[0];
    if (
      !policy ||
      !policy.enabled ||
      policy.ledger_id !== plan.ledgerId ||
      policy.environment !== plan.environment ||
      policy.recipient !== plan.recipient ||
      policy.recipient_sha256 !== plan.recipientSha256
    )
      throw fail();
    const events = (
      await client.query(
        'SELECT e.id,e.patient_id,e.resource_id,e.kind,e.occurred_at,fmv.prepare_restore_event(e.id,$1::uuid) AS payload FROM fmv.restore_ledger_events e WHERE NOT EXISTS(SELECT 1 FROM fmv.restore_ledger_publications p WHERE p.event_id=e.id) ORDER BY e.recorded_at,e.id LIMIT 10',
        [plan.policyId],
      )
    ).rows;
    if (events.length > 10) throw fail();
    const pending = events.map((event) => {
      if (
        event.kind !== 'link.revoked' ||
        !(event.occurred_at instanceof Date) ||
        !Number.isSafeInteger(event.occurred_at.getTime()) ||
        !Buffer.isBuffer(event.payload) ||
        event.payload.length > 4096
      )
        throw fail();
      const source = {
        eventId: event.id,
        patientId: event.patient_id,
        resourceId: event.resource_id,
        kind: event.kind,
        lifecycle: null,
        occurredAt: event.occurred_at.getTime(),
      };
      const expected = Buffer.from(
        JSON.stringify({
          format: 'fmv-restore-event-v1',
          environment: plan.environment,
          ledgerId: plan.ledgerId,
          recipientSha256: plan.recipientSha256,
          event: source,
        }),
      );
      if (!expected.equals(event.payload)) throw fail();
      return {
        id: event.id,
        payload: expected,
        digest: hash(expected),
        sourceDigest: hash(JSON.stringify(source)),
      };
    });
    await client.query('ROLLBACK');
    transaction = false;
    let staged = 0;
    if (apply)
      for (const event of pending) {
        // No source/database lock is held while age encrypts the bounded payload.
        const encrypted = await encrypt(
          Buffer.from(event.payload),
          plan.recipient,
        );
        if (
          !Buffer.isBuffer(encrypted) ||
          encrypted.length < 128 ||
          encrypted.length > 65536 ||
          !encrypted.subarray(0, header.length).equals(header)
        )
          throw fail();
        const ciphertext = Buffer.from(encrypted);
        await client.query('BEGIN');
        transaction = true;
        await client.query("SET LOCAL statement_timeout='8s'");
        const row = (
          await client.query(
            'SELECT * FROM fmv.stage_restore_event($1::uuid,$2::uuid,$3::text,$4::bytea)',
            [event.id, plan.policyId, event.digest, ciphertext],
          )
        ).rows[0];
        if (
          !row ||
          row.event_id !== event.id ||
          row.policy_id !== plan.policyId ||
          row.payload_sha256 !== event.digest ||
          row.source_sha256 !== event.sourceDigest ||
          !Buffer.isBuffer(row.ciphertext) ||
          row.ciphertext_bytes !== row.ciphertext.length ||
          row.ciphertext_sha256 !== hash(row.ciphertext)
        )
          throw fail();
        await client.query('COMMIT');
        transaction = false;
        staged++;
      }
    return {
      candidateEvents: pending.length,
      stagedEvents: staged,
      readOnly: !apply,
      scanExhaustivenessVerified: false,
      independentConfirmation: false,
      providerPublishingAttempted: false,
      sourceLossCoverageVerified: false,
    };
  } catch {
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    throw fail();
  }
}

export function developmentLedgerStagingUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.username !== `fmv_ledger_worker.${developmentLedgerTarget}`)
      throw fail();
    const probe = new URL(url.href);
    probe.username = `postgres.${developmentLedgerTarget}`;
    developmentLedgerMigrationUrl(probe.href);
    return url;
  } catch {
    throw fail();
  }
}
