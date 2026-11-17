import { isReconciledMedicationFields } from '@fmv/contracts';
import type {
  MedicationCandidate,
  MedicationReconciliationEntry,
  ReconciledMedicationFields,
} from '@fmv/contracts';
export const medicationFieldLabels = {
  medication: 'Medication name',
  strength: 'Strength',
  dose: 'Dose',
  frequency: 'Frequency',
  route: 'Route',
  duration: 'Duration',
  start: 'Start as recorded',
  end: 'End as recorded',
  instructions: 'Instructions',
} as const;
export type MedicationDraft = {
  status: '' | 'current' | 'historical';
  fields: Record<keyof ReconciledMedicationFields, string>;
};
export const emptyMedicationDraft = (): MedicationDraft => ({
  status: '',
  fields: {
    medication: '',
    strength: '',
    dose: '',
    frequency: '',
    route: '',
    duration: '',
    start: '',
    end: '',
    instructions: '',
  },
});
export function sourceMedicationDraft(
  candidate: MedicationCandidate,
): MedicationDraft {
  const draft = emptyMedicationDraft();
  for (const key of Object.keys(
    medicationFieldLabels,
  ) as (keyof ReconciledMedicationFields)[])
    draft.fields[key] = candidate.fields[key]?.value ?? '';
  return draft;
}
export function recordedMedicationDraft(
  entry: MedicationReconciliationEntry,
): MedicationDraft {
  const draft = emptyMedicationDraft();
  draft.status = entry.recordedStatus;
  for (const key of Object.keys(
    medicationFieldLabels,
  ) as (keyof ReconciledMedicationFields)[])
    draft.fields[key] = entry.fields[key] ?? '';
  return draft;
}
export function medicationDraftFields(
  draft: MedicationDraft,
): ReconciledMedicationFields | null {
  if (draft.status !== 'current' && draft.status !== 'historical') return null;
  const fields: ReconciledMedicationFields = { ...draft.fields };
  for (const key of Object.keys(
    medicationFieldLabels,
  ) as (keyof ReconciledMedicationFields)[])
    if (key !== 'medication' && draft.fields[key] === '') fields[key] = null;
  return isReconciledMedicationFields(fields) ? fields : null;
}
