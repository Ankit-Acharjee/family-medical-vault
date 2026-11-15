import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  isSaveProcessingConsent,
  isWithdrawProcessingConsent,
  isProcessingProviderPolicy,
  isProcessingConsentResult,
  isProcessingConsentHistoryResult,
} from '@fmv/contracts';
const grant = () => ({
  requestId: randomUUID(),
  expectedRevision: 0,
  sourceSha256: 'a'.repeat(64),
  sourceRevision: 0,
  lifecycleVersion: 0,
  providerId: 'synthetic-provider',
  policyVersion: 'policy-v1',
  purpose: 'document-extraction',
  dataCategories: ['original-document', 'saved-text'],
  expiresAt: '2026-11-16T00:00:00.000Z',
  confirmed: true,
});
const policy = () => ({
  providerId: 'synthetic-provider',
  policyVersion: 'policy-v1',
  purposes: ['document-extraction'],
  dataCategories: ['original-document', 'saved-text'],
  expiresAt: '2026-11-16T00:00:00.000Z',
});
test('consent grant accepts explicit bounded references, categories and expiry without authorizing processing', () => {
  assert.equal(isSaveProcessingConsent(grant()), true);
  for (const dataCategories of [['saved-text'], ['original-document']])
    assert.equal(isSaveProcessingConsent({ ...grant(), dataCategories }), true);
  assert.equal(
    isSaveProcessingConsent({
      ...grant(),
      expectedRevision: 2147483647,
      sourceRevision: 2147483647,
      lifecycleVersion: 2147483647,
      providerId: 'x'.repeat(64),
      policyVersion: 'x'.repeat(64),
    }),
    true,
  );
  // Valid expired/future instants are shapes; only server time determines use.
  assert.equal(
    isSaveProcessingConsent({
      ...grant(),
      expiresAt: '2000-01-01T00:00:00.000Z',
    }),
    true,
  );
  assert.equal(Object.hasOwn(grant(), 'allowed'), false);
});
test('consent grant rejects payloads, client authority/provider approval claims and missing references', () => {
  for (const extra of [
    { actorAccountId: randomUUID() },
    { canManageConsent: true },
    { approved: true },
    { allowed: true },
    { documentId: randomUUID() },
    { data: 'SYNTHETIC payload' },
    { accessToken: 'SYNTHETIC credential' },
    { scope: 'all-patients' },
  ])
    assert.equal(isSaveProcessingConsent({ ...grant(), ...extra }), false);
  for (const key of Object.keys(grant())) {
    const missing = grant();
    delete missing[key];
    assert.equal(isSaveProcessingConsent(missing), false, key);
  }
  for (const invalid of [null, [], true, 0, 'grant', {}])
    assert.equal(isSaveProcessingConsent(invalid), false);
});
test('consent grant rejects malformed revision, identity, purpose and category references', () => {
  for (const change of [
    { requestId: 'not-a-uuid' },
    { requestId: '00000000-0000-0000-0000-000000000000' },
    { sourceSha256: 'A'.repeat(64) },
    { sourceSha256: 'a'.repeat(63) },
    { confirmed: false },
    { confirmed: 1 },
    { purpose: 'training' },
    { dataCategories: [] },
    { dataCategories: ['saved-text', 'saved-text'] },
    { dataCategories: ['original-document', 'saved-text', 'all-records'] },
    { dataCategories: ['all-records'] },
    { dataCategories: 'saved-text' },
  ])
    assert.equal(isSaveProcessingConsent({ ...grant(), ...change }), false);
  for (const key of ['expectedRevision', 'sourceRevision', 'lifecycleVersion'])
    for (const value of [-1, 0.5, 2147483648, NaN, Infinity, '1', null])
      assert.equal(
        isSaveProcessingConsent({ ...grant(), [key]: value }),
        false,
      );
  for (const key of ['providerId', 'policyVersion'])
    for (const value of [
      '',
      'x'.repeat(65),
      'UPPER',
      'two words',
      '-leading',
      'trailing-',
      'double--dash',
      'path/name',
      'v1.0',
      '<literal>',
      '\u0000',
      null,
    ])
      assert.equal(
        isSaveProcessingConsent({ ...grant(), [key]: value }),
        false,
      );
});
test('consent expiry must be a real canonical UTC millisecond instant', () => {
  for (const expiresAt of [
    '2026-02-30T00:00:00.000Z',
    '2026-11-16T24:00:00.000Z',
    '2026-11-16T00:00:00Z',
    '2026-11-16T00:00:00.000+00:00',
    '2026-11-16',
    '2026-11-16T00:00:60.000Z',
    '2026-11-16T00:00:00.000z',
    ' 2026-11-16T00:00:00.000Z',
    null,
    0,
  ])
    assert.equal(isSaveProcessingConsent({ ...grant(), expiresAt }), false);
});
test('withdrawal targets only current consent revision and carries no new scope or source claims', () => {
  const value = { requestId: randomUUID(), expectedRevision: 1 };
  assert.equal(isWithdrawProcessingConsent(value), true);
  assert.equal(
    isWithdrawProcessingConsent({ ...value, expectedRevision: 2147483647 }),
    true,
  );
  for (const change of [
    { expectedRevision: 0 },
    { expectedRevision: -1 },
    { expectedRevision: 2147483648 },
    { requestId: 'bad' },
    { actorAccountId: randomUUID() },
    { sourceSha256: 'a'.repeat(64) },
    { confirmed: true },
    { consentId: randomUUID() },
    { providerId: 'synthetic-provider' },
  ])
    assert.equal(isWithdrawProcessingConsent({ ...value, ...change }), false);
  assert.equal(isWithdrawProcessingConsent(grant()), false);
  for (const invalid of [null, [], true, {}, { requestId: value.requestId }])
    assert.equal(isWithdrawProcessingConsent(invalid), false);
});
test('provider-policy shape is closed and never includes an approval or network endpoint', () => {
  assert.equal(isProcessingProviderPolicy(policy()), true);
  assert.equal(
    isProcessingProviderPolicy({ ...policy(), dataCategories: ['saved-text'] }),
    true,
  );
  assert.equal(
    isProcessingProviderPolicy({
      ...policy(),
      expiresAt: '2000-01-01T00:00:00.000Z',
    }),
    true,
  );
  for (const change of [
    { approved: true },
    { endpoint: 'https://invalid.example' },
    { apiKey: 'SYNTHETIC' },
    { purposes: [] },
    { purposes: ['training'] },
    { purposes: ['document-extraction', 'document-extraction'] },
    { purposes: 'document-extraction' },
    { dataCategories: [] },
    { dataCategories: ['saved-text', 'saved-text'] },
    { dataCategories: ['all-records'] },
    { providerId: 'x'.repeat(65) },
    { policyVersion: 'V1' },
    { expiresAt: '2026-02-30T00:00:00.000Z' },
  ])
    assert.equal(isProcessingProviderPolicy({ ...policy(), ...change }), false);
  for (const key of Object.keys(policy())) {
    const missing = policy();
    delete missing[key];
    assert.equal(isProcessingProviderPolicy(missing), false, key);
  }
  for (const invalid of [null, [], true, {}, grant()])
    assert.equal(isProcessingProviderPolicy(invalid), false);
});

test('category validation rejects sparse arrays and leaves frozen explicit consent unchanged', () => {
  assert.equal(
    isSaveProcessingConsent({ ...grant(), dataCategories: new Array(1) }),
    false,
  );
  assert.equal(
    isProcessingProviderPolicy({ ...policy(), dataCategories: new Array(1) }),
    false,
  );
  const value = Object.freeze({
    ...grant(),
    dataCategories: Object.freeze(['saved-text', 'original-document']),
  });
  const before = JSON.stringify(value);
  assert.equal(isSaveProcessingConsent(value), true);
  assert.equal(JSON.stringify(value), before);
});

const consentContext = () => ({
  sourceSha256: 'a'.repeat(64),
  sourceRevision: 3,
  lifecycleVersion: 2,
  revision: 4,
});
const consentSnapshot = () => ({
  revision: 4,
  action: 'grant',
  sourceSha256: 'a'.repeat(64),
  sourceRevision: 3,
  lifecycleVersion: 2,
  providerId: 'synthetic-provider',
  policyVersion: 'policy-v1',
  purpose: 'document-extraction',
  dataCategories: ['saved-text'],
  expiresAt: '2000-01-01T00:00:00.000Z',
  recordedAt: '1999-12-31T00:00:00.000Z',
});
const consentResult = () => ({
  context: consentContext(),
  snapshot: consentSnapshot(),
  policies: [policy()],
  effective: false,
  externalProcessingEnabled: false,
});
test('current consent results preserve exact historical references while processing stays disabled', () => {
  assert.equal(isProcessingConsentResult(consentResult()), true);
  assert.equal(
    isProcessingConsentResult({ ...consentResult(), effective: true }),
    true,
  );
  assert.equal(
    isProcessingConsentResult({
      ...consentResult(),
      snapshot: {
        ...consentSnapshot(),
        sourceSha256: 'b'.repeat(64),
        sourceRevision: 1,
        lifecycleVersion: 0,
      },
    }),
    true,
  );
  assert.equal(
    isProcessingConsentResult({
      ...consentResult(),
      snapshot: { ...consentSnapshot(), action: 'withdrawal' },
    }),
    true,
  );
  assert.equal(
    isProcessingConsentResult({
      context: { ...consentContext(), revision: 0 },
      snapshot: null,
      policies: [],
      effective: false,
      externalProcessingEnabled: false,
    }),
    true,
  );
  assert.equal(
    isProcessingConsentResult({
      ...consentResult(),
      snapshot: {
        ...consentSnapshot(),
        sourceRevision: 0,
        dataCategories: ['original-document'],
      },
    }),
    true,
  );
});
test('effective consent requires current exact source and lifecycle bindings without enabling external processing', () => {
  for (const snapshot of [
    { ...consentSnapshot(), action: 'withdrawal' },
    { ...consentSnapshot(), sourceSha256: 'b'.repeat(64) },
    { ...consentSnapshot(), sourceRevision: 2 },
    { ...consentSnapshot(), lifecycleVersion: 1 },
  ])
    assert.equal(
      isProcessingConsentResult({
        ...consentResult(),
        snapshot,
        effective: true,
      }),
      false,
    );
  for (const change of [
    { externalProcessingEnabled: true },
    { externalProcessingEnabled: 'false' },
    { effective: 1 },
    { snapshot: null },
    { approved: true },
    { policies: [policy(), policy()] },
    { policies: new Array(1) },
    {
      policies: Array.from({ length: 21 }, (_, i) => ({
        ...policy(),
        providerId: `provider-${i}`,
      })),
    },
  ])
    assert.equal(
      isProcessingConsentResult({ ...consentResult(), ...change }),
      false,
    );
  assert.equal(
    isProcessingConsentResult({
      context: { ...consentContext(), revision: 0 },
      snapshot: null,
      policies: [],
      effective: true,
      externalProcessingEnabled: false,
    }),
    false,
  );
});
test('consent result guards reject malformed contexts, snapshots, dates and category/source contradictions', () => {
  for (const context of [
    { ...consentContext(), sourceSha256: 'A'.repeat(64) },
    { ...consentContext(), sourceRevision: -1 },
    { ...consentContext(), lifecycleVersion: 2147483648 },
    { ...consentContext(), revision: '4' },
    { ...consentContext(), canManageConsent: true },
  ])
    assert.equal(
      isProcessingConsentResult({ ...consentResult(), context }),
      false,
    );
  for (const snapshot of [
    { ...consentSnapshot(), revision: 0 },
    { ...consentSnapshot(), revision: 3 },
    { ...consentSnapshot(), revision: 5 },
    { ...consentSnapshot(), action: 'active' },
    { ...consentSnapshot(), sourceRevision: 4 },
    { ...consentSnapshot(), lifecycleVersion: 3 },
    { ...consentSnapshot(), sourceRevision: 0 },
    { ...consentSnapshot(), actorAccountId: randomUUID() },
    { ...consentSnapshot(), dataCategories: ['saved-text', 'saved-text'] },
    { ...consentSnapshot(), expiresAt: '2026-02-30T00:00:00.000Z' },
    { ...consentSnapshot(), recordedAt: '2026-01-01T00:00:00Z' },
  ])
    assert.equal(
      isProcessingConsentResult({ ...consentResult(), snapshot }),
      false,
    );
  for (const key of Object.keys(consentSnapshot())) {
    const snapshot = consentSnapshot();
    delete snapshot[key];
    assert.equal(
      isProcessingConsentResult({ ...consentResult(), snapshot }),
      false,
      key,
    );
  }
});
test('consent history uses the same strict snapshot with bounded exclusive revision cursors', () => {
  const value = {
    context: consentContext(),
    snapshot: { ...consentSnapshot(), revision: 3 },
    nextBefore: 3,
  };
  assert.equal(isProcessingConsentHistoryResult(value), true);
  assert.equal(
    isProcessingConsentHistoryResult({ ...value, nextBefore: null }),
    true,
  );
  assert.equal(
    isProcessingConsentHistoryResult({
      ...value,
      snapshot: null,
      nextBefore: null,
    }),
    true,
  );
  assert.equal(
    isProcessingConsentHistoryResult({
      ...value,
      snapshot: { ...consentSnapshot(), revision: 1 },
      nextBefore: null,
    }),
    true,
  );
  for (const change of [
    { nextBefore: 2 },
    { nextBefore: 0 },
    { nextBefore: '3' },
    { snapshot: { ...consentSnapshot(), revision: 5 }, nextBefore: null },
    { snapshot: { ...consentSnapshot(), revision: 1 }, nextBefore: 1 },
    { snapshot: null },
    { effective: false },
  ])
    assert.equal(
      isProcessingConsentHistoryResult({ ...value, ...change }),
      false,
    );
  for (const invalid of [null, [], {}, true]) {
    assert.equal(isProcessingConsentResult(invalid), false);
    assert.equal(isProcessingConsentHistoryResult(invalid), false);
  }
});
