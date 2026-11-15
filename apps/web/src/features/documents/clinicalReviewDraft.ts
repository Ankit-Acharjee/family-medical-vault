import type { ClinicalReviewResult, ReviewedLabFields } from '@fmv/contracts';

export type ClinicalOperation = 'confirmation' | 'withdrawal';
export type ClinicalSaveState =
  'idle' | 'pending' | 'uncertain' | 'failed' | 'conflict' | 'saved';
// Dialog-local memory only. Reuse requires a fresh source and authority check.
export type ClinicalDraft = {
  key: string;
  entries: {
    candidateId: string;
    selected: boolean;
    fields: ReviewedLabFields;
  }[];
  confirmed: boolean;
  body: string | null;
  operation: ClinicalOperation;
  withdrawIds: string[];
  withdrawConfirmed: boolean;
  saveState: ClinicalSaveState;
};
export type ClinicalDraftRef = { current: ClinicalDraft | null };
export function clinicalDraftKey(
  patientId: string,
  documentId: string,
  data: ClinicalReviewResult,
) {
  const c = data.context;
  return JSON.stringify([
    patientId,
    documentId,
    c.sourceRevision,
    c.sourceSha256,
    c.lifecycleVersion,
    c.revision,
    c.canVerify,
  ]);
}
