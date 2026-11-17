import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractMedicationFields,
  isMedicationReviewResult,
  projectReviewedMedicationSources,
} from '@fmv/contracts';
const p = '11111111-1111-4111-8111-111111111111',
  d = '22222222-2222-4222-8222-222222222222',
  sha = 'a'.repeat(64);
const fence = () => ({
  sourceRevision: 3,
  sourceSha256: sha,
  lifecycleVersion: 2,
  reviewRevision: 4,
  reviewLifecycleVersion: 2,
});
function review() {
  const candidates = extractMedicationFields([
    {
      page: 1,
      text: 'Medication: SYNTHETIC historical/stopped?\nDose: as written only\nFrequency: if needed (uncertain)\n\nMedication: SYNTHETIC other\nDose: see original',
    },
  ]);
  assert.equal(candidates.length, 2);
  return {
    context: {
      sourceRevision: 3,
      sourceSha256: sha,
      lifecycleVersion: 2,
      revision: 4,
      canVerify: true,
    },
    candidates,
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
      statements: candidates,
      withdrawnStatements: [],
    },
  };
}
test('MED-01/02 projects exact reviewed source fields without creating regimens or filling unknowns', () => {
  const input = review();
  assert.equal(isMedicationReviewResult(input), true);
  const result = projectReviewedMedicationSources(p, d, input, fence());
  assert.equal(result.length, 2);
  assert.equal(
    result[0].source.fields.medication.value,
    'SYNTHETIC historical/stopped?',
  );
  assert.equal(
    result[0].source.fields.frequency.value,
    'if needed (uncertain)',
  );
  assert.equal(result[1].source.fields.frequency, null);
  assert.equal(result[0].source.unverified, true);
  assert.deepEqual(result[0].reconciliation, { status: 'unreconciled' });
  assert.equal(result[0].meaning, 'source-fields-only');
  assert.deepEqual(result[0].provenance, {
    patientId: p,
    documentId: d,
    sourceRevision: 3,
    sourceSha256: sha,
    lifecycleVersion: 2,
    reviewRevision: 4,
    confirmedAt: '2026-11-17T00:00:00.000Z',
  });
  assert.equal('schedule' in result[0], false);
  assert.equal('status' in result[0], false);
  input.context.canVerify = false;
  assert.equal(
    projectReviewedMedicationSources(p, d, input, fence()).length,
    2,
    'Source projection is not current-user write authority',
  );
});
test('provisional, stale and restored-source reviews cannot become eligible by stamping current metadata', () => {
  const base = review();
  for (const input of [
    null,
    {},
    { ...base, snapshot: null },
    { ...base, context: { ...base.context, sourceRevision: 4 } },
    { ...base, snapshot: { ...base.snapshot, sourceRevision: 2 } },
    { ...base, context: { ...base.context, revision: 5 } },
    { ...base, snapshot: { ...base.snapshot, meaning: 'active-regimen' } },
  ])
    assert.deepEqual(
      projectReviewedMedicationSources(p, d, input, fence()),
      [],
    );
  for (const patch of [
    { reviewRevision: 5 },
    { sourceRevision: 4 },
    { sourceSha256: 'b'.repeat(64) },
    { lifecycleVersion: 3 },
    { reviewLifecycleVersion: 1 },
    { reviewRevision: 0 },
    { sourceRevision: 2147483648 },
    { extra: true },
    { sourceSha256: sha + '\n' },
  ])
    assert.deepEqual(
      projectReviewedMedicationSources(p, d, base, { ...fence(), ...patch }),
      [],
    );
  const restored = review();
  restored.context.lifecycleVersion = 3;
  assert.equal(isMedicationReviewResult(restored), true);
  assert.deepEqual(
    projectReviewedMedicationSources(p, d, restored, {
      ...fence(),
      lifecycleVersion: 3,
    }),
    [],
    'Review ledger lifecycle must match restored original lifecycle',
  );
  assert.deepEqual(
    projectReviewedMedicationSources(p + '\n', d, base, fence()),
    [],
  );
  assert.deepEqual(
    projectReviewedMedicationSources(p, 'bad', base, fence()),
    [],
  );
});
test('partial withdrawal keeps only still-attested sources; full withdrawal supplies none', () => {
  const input = review(),
    all = input.snapshot.statements;
  input.snapshot.action = 'withdrawal';
  input.snapshot.statements = [all[0]];
  input.snapshot.withdrawnStatements = [all[1]];
  assert.equal(isMedicationReviewResult(input), true);
  assert.deepEqual(
    projectReviewedMedicationSources(p, d, input, fence()).map(
      (v) => v.source.id,
    ),
    [all[0].id],
  );
  input.snapshot.statements = [];
  input.snapshot.withdrawnStatements = all;
  assert.deepEqual(projectReviewedMedicationSources(p, d, input, fence()), []);
});
test('source projection owns its nested copies and accepts frozen ordinary JSON without mutation', () => {
  const input = review(),
    before = JSON.stringify(input);
  const output = projectReviewedMedicationSources(p, d, input, fence());
  output[0].source.fields.medication.value = 'SYNTHETIC mutation';
  output[0].source.fields.dose.excerpt = 'SYNTHETIC changed';
  assert.equal(JSON.stringify(input), before);
  const freeze = (v) => {
    if (v && typeof v === 'object') {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
    return v;
  };
  assert.equal(
    projectReviewedMedicationSources(p, d, freeze(review()), freeze(fence()))
      .length,
    2,
  );
});
