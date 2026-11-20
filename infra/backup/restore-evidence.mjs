import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
const fail = () =>
  new Error('Restore evidence validation failed; services must remain closed');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const opaque = /^[a-f0-9]{32}$/;
const digest = /^[a-f0-9]{64}$/;
const kinds = new Set([
  'document.trashed',
  'document.restored',
  'grant.revoked',
  'link.revoked',
]);
const topFields = [
  'format',
  'ledgerId',
  'afterSequence',
  'throughSequence',
  'events',
];
const eventFields = [
  'sequence',
  'eventId',
  'patientId',
  'resourceId',
  'kind',
  'lifecycle',
  'occurredAt',
];
const exact = (value, fields) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...fields].sort().join(',');
const sequence = (value) => Number.isSafeInteger(value) && value >= 0;
function normalize(value) {
  if (
    !exact(value, topFields) ||
    value.format !== 'fmv-restore-evidence-v1' ||
    typeof value.ledgerId !== 'string' ||
    !opaque.test(value.ledgerId) ||
    !sequence(value.afterSequence) ||
    !sequence(value.throughSequence) ||
    value.throughSequence < value.afterSequence ||
    !Array.isArray(value.events) ||
    value.events.length > 1000 ||
    value.events.length !== value.throughSequence - value.afterSequence
  )
    throw fail();
  const ids = new Set();
  const events = Array.from(value.events, (event, index) => {
    if (
      !exact(event, eventFields) ||
      event.sequence !== value.afterSequence + index + 1 ||
      ![event.eventId, event.patientId, event.resourceId].every(
        (id) => typeof id === 'string' && uuid.test(id),
      ) ||
      ids.has(event.eventId) ||
      !kinds.has(event.kind) ||
      !sequence(event.occurredAt) ||
      (event.kind.startsWith('document.')
        ? !Number.isSafeInteger(event.lifecycle) || event.lifecycle < 1
        : event.lifecycle !== null)
    )
      throw fail();
    ids.add(event.eventId);
    return Object.fromEntries(
      eventFields.map((field) => [field, event[field]]),
    );
  });
  return {
    format: value.format,
    ledgerId: value.ledgerId,
    afterSequence: value.afterSequence,
    throughSequence: value.throughSequence,
    events,
  };
}

/** Private plaintext evidence: encrypt before independent storage. No signing or
 * storage authority here; this encoding alone does not authenticate anything.
 */
export function encodeRestoreEvidence(value) {
  try {
    const bytes = Buffer.from(JSON.stringify(normalize(value)), 'utf8');
    if (bytes.length > 524288) throw fail();
    return bytes;
  } catch {
    throw fail();
  }
}

/** Both anchors must be authenticated outside the restored database/bucket list.
 * A trusted head commits the EXACT complete batch after the snapshot anchor.
 * This returns a private advisory plan, never a reopen/purge authorization.
 */
export function planRestoreReconciliation({
  evidence,
  snapshotAnchor,
  trustedHead,
  now,
} = {}) {
  try {
    if (
      !Buffer.isBuffer(evidence) ||
      evidence.length < 1 ||
      evidence.length > 524288 ||
      !sequence(now) ||
      !exact(snapshotAnchor, ['ledgerId', 'sequence']) ||
      !sequence(snapshotAnchor.sequence) ||
      !exact(trustedHead, [
        'ledgerId',
        'afterSequence',
        'throughSequence',
        'evidenceSha256',
      ]) ||
      typeof trustedHead.ledgerId !== 'string' ||
      !opaque.test(trustedHead.ledgerId) ||
      trustedHead.ledgerId !== snapshotAnchor.ledgerId ||
      trustedHead.afterSequence !== snapshotAnchor.sequence ||
      !sequence(trustedHead.throughSequence) ||
      trustedHead.throughSequence < trustedHead.afterSequence ||
      typeof trustedHead.evidenceSha256 !== 'string' ||
      !digest.test(trustedHead.evidenceSha256)
    )
      throw fail();
    const bytes = Buffer.from(evidence);
    if (
      createHash('sha256').update(bytes).digest('hex') !==
      trustedHead.evidenceSha256
    )
      throw fail();
    const value = normalize(JSON.parse(bytes.toString('utf8')));
    if (
      !encodeRestoreEvidence(value).equals(bytes) ||
      value.ledgerId !== trustedHead.ledgerId ||
      value.afterSequence !== trustedHead.afterSequence ||
      value.throughSequence !== trustedHead.throughSequence
    )
      throw fail();
    const documents = new Map(),
      grants = new Map(),
      links = new Map();
    for (const event of value.events) {
      if (event.occurredAt > now) throw fail();
      const target = event.kind.startsWith('document.')
        ? documents
        : event.kind === 'grant.revoked'
          ? grants
          : links;
      const previous = target.get(event.resourceId);
      if (
        previous &&
        (previous.patientId !== event.patientId ||
          (target === documents &&
            (event.lifecycle !== previous.lifecycle + 1 ||
              event.kind === previous.kind)))
      )
        throw fail();
      target.set(event.resourceId, {
        patientId: event.patientId,
        resourceId: event.resourceId,
        kind: event.kind,
        lifecycle: event.lifecycle,
        occurredAt: event.occurredAt,
      });
    }
    const sorted = (map) =>
      [...map.values()].sort((a, b) =>
        a.resourceId.localeCompare(b.resourceId),
      );
    return {
      ledgerId: value.ledgerId,
      throughSequence: value.throughSequence,
      documentFences: sorted(documents),
      revokedGrants: sorted(grants),
      revokedLinks: sorted(links),
      automaticReopenAllowed: false,
      automaticLedgerDeletionAllowed: false,
    };
  } catch {
    throw fail();
  }
}
