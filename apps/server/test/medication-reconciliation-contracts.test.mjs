import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractMedicationFields,
  isMedicationReconciliationEntry,
  isMedicationReconciliationHistory,
  isMedicationReconciliationsPage,
  isMedicationReconciliationCursor,
  isMedicationSourceOptions,
  isMedicationSourceBinding,
  isReconciledMedicationFields,
  isSaveMedicationReconciliation,
  medicationReconciliationSourceCurrent,
} from '@fmv/contracts';
const patientId = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';
const medicationId = '33333333-3333-4333-8333-333333333333';
const sha = 'a'.repeat(64);
function fixture() {
  const statements = extractMedicationFields([
    {
      page: 1,
      text: 'Medication: SYNTHETIC historical?\nDose: as written\nFrequency: uncertain',
    },
  ]);
  const source = {
    documentId,
    candidateId: statements[0].id,
    sourceRevision: 3,
    sourceSha256: sha,
    lifecycleVersion: 2,
    reviewRevision: 4,
  };
  const fields = {
    medication: 'SYNTHETIC historical?',
    strength: null,
    dose: 'as written',
    frequency: 'uncertain',
    route: null,
    duration: null,
    start: null,
    end: null,
    instructions: null,
  };
  const entry = {
    medicationId,
    patientId,
    revision: 1,
    action: 'reconciliation',
    recordedAt: '2026-11-17T00:00:00.000Z',
    meaning: 'owner-recorded-medication-context',
    source,
    recordedStatus: 'current',
    fields,
  };
  const input = {
    requestId: medicationId,
    expectedRevision: 0,
    confirmed: true,
    meaning: entry.meaning,
    source,
    recordedStatus: 'current',
    fields,
  };
  const review = {
    context: {
      sourceRevision: 3,
      sourceSha256: sha,
      lifecycleVersion: 2,
      revision: 4,
      canVerify: false,
    },
    candidates: [],
    snapshot: {
      revision: 4,
      sourceRevision: 3,
      sourceSha256: sha,
      confirmedAt: '2026-11-17T00:00:00.000Z',
      action: 'confirmation',
      meaning: 'source-fields-only',
      ruleVersion: 'labeled-medication-blocks-v1',
      extraction: {
        method: 'pdf-text',
        engineVersion: 'pdfjs-6.5.438',
        partial: false,
        partialReason: null,
        downsized: false,
      },
      statements,
      withdrawnStatements: [],
    },
  };
  const fence = {
    sourceRevision: 3,
    sourceSha256: sha,
    lifecycleVersion: 2,
    reviewRevision: 4,
    reviewLifecycleVersion: 2,
  };
  return { entry, input, review, fence };
}
test('MED-01/02 requires a separate explicit owner-context reconciliation intent', () => {
  const { input } = fixture();
  assert.equal(isSaveMedicationReconciliation(input), true);
  assert.equal(
    isSaveMedicationReconciliation({ ...input, recordedStatus: 'historical' }),
    true,
  );
  for (const patch of [
    { confirmed: false },
    { meaning: 'source-fields-only' },
    { recordedStatus: 'active' },
    { expectedRevision: -1 },
    { expectedRevision: 2147483647 },
    { expectedRevision: 1.5 },
    { requestId: 'invalid' },
    { schedule: {} },
    { prescribed: true },
  ])
    assert.equal(
      isSaveMedicationReconciliation({ ...input, ...patch }),
      false,
      JSON.stringify(patch),
    );
  assert.equal(
    isSaveMedicationReconciliation({ ...input, expectedRevision: 2147483646 }),
    true,
  );
  for (const key of Object.keys(input)) {
    const v = { ...input };
    delete v[key];
    assert.equal(isSaveMedicationReconciliation(v), false, key);
  }
});
test('literal fields preserve unknowns, uncertainty and exact values without dose or date interpretation', () => {
  const {
    input: { fields },
  } = fixture();
  const unusual = {
    ...fields,
    medication: '  SYNTHETIC stopped?  ',
    dose: '0.00000000000000000000001 unclear units',
    frequency: 'as needed?',
    start: 'unknown date',
    end: 'historical?',
    instructions: '<script>literal text only</script>',
  };
  const before = JSON.stringify(unusual);
  assert.equal(isReconciledMedicationFields(unusual), true);
  assert.equal(JSON.stringify(unusual), before);
  for (const value of [
    '',
    '  ',
    'x'.repeat(121),
    'a\nb',
    'a\rb',
    'a\u0000b',
    5,
    {},
    [],
  ])
    assert.equal(
      isReconciledMedicationFields({ ...fields, dose: value }),
      false,
    );
  assert.equal(
    isReconciledMedicationFields({ ...fields, medication: null }),
    false,
  );
  assert.equal(
    isReconciledMedicationFields({ ...fields, dose: 'x'.repeat(120) }),
    true,
  );
  assert.equal(
    isReconciledMedicationFields({ ...fields, unknown: null }),
    false,
  );
});
test('exact source fences reject malformed IDs, bounds and forged lifecycle fields', () => {
  const {
    entry: { source },
  } = fixture();
  assert.equal(isMedicationSourceBinding(source), true);
  for (const patch of [
    { candidateId: 'page-51-medication-0' },
    { candidateId: 'page-01-medication-0' },
    { candidateId: 'page-1-medication-500000' },
    { candidateId: source.candidateId + '\n' },
    { sourceSha256: sha + '\n' },
    { documentId: 'bad' },
    { sourceRevision: 0 },
    { reviewRevision: 0 },
    { lifecycleVersion: -1 },
    { reviewLifecycleVersion: 2 },
  ])
    assert.equal(isMedicationSourceBinding({ ...source, ...patch }), false);
});
test('entries preserve current/historical status independently of source freshness', () => {
  const { entry, review, fence } = fixture();
  assert.equal(isMedicationReconciliationEntry(entry), true);
  assert.equal(
    medicationReconciliationSourceCurrent(entry, review, fence),
    true,
  );
  const before = JSON.stringify(entry);
  for (const changed of [
    { ...fence, sourceRevision: 4 },
    { ...fence, sourceSha256: 'b'.repeat(64) },
    { ...fence, reviewRevision: 5 },
    { ...fence, lifecycleVersion: 3 },
    { ...fence, reviewLifecycleVersion: 3 },
  ])
    assert.equal(
      medicationReconciliationSourceCurrent(entry, review, changed),
      false,
    );
  assert.equal(JSON.stringify(entry), before);
  const historical = { ...entry, recordedStatus: 'historical' };
  assert.equal(
    medicationReconciliationSourceCurrent(historical, review, fence),
    true,
  );
  assert.equal(historical.recordedStatus, 'historical');
  assert.equal(
    medicationReconciliationSourceCurrent(
      {
        ...entry,
        source: { ...entry.source, candidateId: 'page-1-medication-999' },
      },
      review,
      fence,
    ),
    false,
  );
});
test('withdrawal, new review and Restore never silently reactivate an old reconciliation', () => {
  const { entry, review, fence } = fixture();
  const withdrawn = JSON.parse(JSON.stringify(review));
  withdrawn.snapshot.action = 'withdrawal';
  withdrawn.snapshot.withdrawnStatements = withdrawn.snapshot.statements;
  withdrawn.snapshot.statements = [];
  assert.equal(
    medicationReconciliationSourceCurrent(entry, withdrawn, fence),
    false,
  );
  const renewed = JSON.parse(JSON.stringify(review));
  renewed.context.revision = 5;
  renewed.snapshot.revision = 5;
  assert.equal(
    medicationReconciliationSourceCurrent(entry, renewed, {
      ...fence,
      reviewRevision: 5,
    }),
    false,
  );
  renewed.context.lifecycleVersion = 3;
  assert.equal(
    medicationReconciliationSourceCurrent(entry, renewed, {
      ...fence,
      lifecycleVersion: 3,
      reviewRevision: 5,
      reviewLifecycleVersion: 2,
    }),
    false,
  );
  assert.equal(
    medicationReconciliationSourceCurrent(entry, renewed, {
      ...fence,
      lifecycleVersion: 3,
      reviewRevision: 5,
      reviewLifecycleVersion: 3,
    }),
    false,
  );
  const reconciled = {
    ...entry,
    revision: 2,
    action: 'correction',
    source: { ...entry.source, lifecycleVersion: 3, reviewRevision: 5 },
  };
  assert.equal(
    medicationReconciliationSourceCurrent(reconciled, renewed, {
      ...fence,
      lifecycleVersion: 3,
      reviewRevision: 5,
      reviewLifecycleVersion: 3,
    }),
    true,
  );
});
test('history entries enforce canonical action, timestamp and revision without accepting guessed dates', () => {
  const { entry } = fixture();
  for (const patch of [
    { revision: 0 },
    { revision: 2 },
    { action: 'correction' },
    { recordedAt: '2026-02-30T00:00:00.000Z' },
    { recordedAt: '2026-11-17' },
    { recordedAt: '2026-11-17T00:00:00.000Z\n' },
    { trusted: true },
  ])
    assert.equal(
      isMedicationReconciliationEntry({ ...entry, ...patch }),
      false,
    );
  assert.equal(
    isMedicationReconciliationEntry({
      ...entry,
      revision: 2,
      action: 'correction',
    }),
    true,
  );
  for (const v of [null, [], false, 1, 'record']) {
    assert.equal(isMedicationReconciliationEntry(v), false);
    assert.equal(isSaveMedicationReconciliation(v), false);
    assert.equal(isMedicationSourceBinding(v), false);
    assert.equal(isReconciledMedicationFields(v), false);
  }
});

test('bounded list and history guards reject cross-patient, duplicate, misordered and contradictory responses', () => {
  const { entry } = fixture(),
    view = { entry, sourceState: 'current-source' };
  const page = { patientId, canWrite: true, entries: [view], nextCursor: null };
  assert.equal(isMedicationReconciliationsPage(page), true);
  for (const patch of [
    { entries: [view, view] },
    { patientId: documentId },
    { nextCursor: { recordedAt: entry.recordedAt, medicationId } },
    { entries: [{ ...view, sourceState: 'verified' }] },
    { entries: new Array(21).fill(view) },
  ])
    assert.equal(isMedicationReconciliationsPage({ ...page, ...patch }), false);
  assert.equal(
    isMedicationReconciliationCursor({
      medicationId,
      recordedAt: entry.recordedAt,
    }),
    true,
  );
  assert.equal(
    isMedicationReconciliationCursor({
      medicationId,
      recordedAt: entry.recordedAt + '\n',
    }),
    false,
  );
  const history = {
    current: view,
    canWrite: true,
    history: [view],
    nextBeforeRevision: null,
  };
  assert.equal(isMedicationReconciliationHistory(history), true);
  for (const patch of [
    { history: [] },
    { history: [view, view] },
    { nextBeforeRevision: 1 },
    {
      history: [
        {
          entry: { ...entry, recordedStatus: 'historical' },
          sourceState: 'current-source',
        },
      ],
    },
    { history: [{ ...view, sourceState: 'source-review-required' }] },
  ])
    assert.equal(
      isMedicationReconciliationHistory({ ...history, ...patch }),
      false,
    );
  assert.equal(
    isReconciledMedicationFields({ ...entry.fields, dose: '\ud800' }),
    false,
  );
  assert.equal(
    isReconciledMedicationFields({ ...entry.fields, dose: '🧊'.repeat(60) }),
    true,
  );
  assert.equal(
    isReconciledMedicationFields({ ...entry.fields, dose: '🧊'.repeat(61) }),
    false,
  );
});

test('source choices are owner-only, bounded and exact without inventing a recorded regimen', () => {
  const { entry, review } = fixture();
  const option = {
    title: 'SYNTHETIC prescription',
    existingRecord: null,
    source: review.snapshot.statements[0],
    binding: entry.source,
  };
  const value = {
    patientId,
    canWrite: true,
    options: [option],
    limited: false,
  };
  assert.equal(isMedicationSourceOptions(value), true);
  assert.equal(
    isMedicationSourceOptions({
      ...value,
      options: [{ ...option, existingRecord: { medicationId, revision: 3 } }],
    }),
    true,
  );
  for (const existingRecord of [
    { medicationId, revision: 0 },
    { medicationId: 'wrong', revision: 1 },
    { medicationId, revision: 1, fields: {} },
    {},
  ])
    assert.equal(
      isMedicationSourceOptions({
        ...value,
        options: [{ ...option, existingRecord }],
      }),
      false,
    );

  for (const patch of [
    { canWrite: false },
    { patientId: 'wrong' },
    { options: [option, option] },
    { options: new Array(51).fill(option) },
    { options: [{ ...option, title: '' }] },
    {
      options: [
        {
          ...option,
          binding: { ...option.binding, candidateId: 'page-1-medication-99' },
        },
      ],
    },
    {
      options: [{ ...option, source: { ...option.source, unverified: false } }],
    },
    { options: [{ ...option, recordedStatus: 'current' }] },
  ])
    assert.equal(isMedicationSourceOptions({ ...value, ...patch }), false);
  assert.equal(
    isMedicationSourceOptions({ ...value, options: [], limited: false }),
    true,
  );
  assert.equal(isMedicationSourceOptions({ ...value, limited: true }), true);
});
