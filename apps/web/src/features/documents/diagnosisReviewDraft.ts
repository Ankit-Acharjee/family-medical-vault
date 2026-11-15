import type { DiagnosisReviewResult } from '@fmv/contracts';
import type {
  ClinicalOperation,
  ClinicalSaveState,
} from './clinicalReviewDraft';
export type DiagnosisDraft = {
  key: string;
  selected: string[];
  attested: boolean;
  withdrawSelected: string[];
  withdrawAttested: boolean;
  body: string | null;
  operation: ClinicalOperation;
  saveState: ClinicalSaveState;
};
export type DiagnosisDraftRef = { current: DiagnosisDraft | null };
export function diagnosisDraftKey(
  p: string,
  d: string,
  data: DiagnosisReviewResult,
) {
  const c = data.context;
  return JSON.stringify([
    p,
    d,
    c.sourceRevision,
    c.sourceSha256,
    c.lifecycleVersion,
    c.revision,
    c.canVerify,
  ]);
}
