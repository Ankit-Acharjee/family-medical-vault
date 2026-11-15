import type {
  SourceReviewResult,
  SourceReviewKind,
} from './sourceReviewDomain';
import type {
  ClinicalOperation,
  ClinicalSaveState,
} from './clinicalReviewDraft';
export type SourceDraft = {
  key: string;
  selected: string[];
  attested: boolean;
  withdrawSelected: string[];
  withdrawAttested: boolean;
  body: string | null;
  operation: ClinicalOperation;
  saveState: ClinicalSaveState;
};
export type SourceDraftRef = { current: SourceDraft | null };
export function sourceDraftKey(
  p: string,
  d: string,
  data: SourceReviewResult,
  kind: SourceReviewKind,
) {
  const c = data.context;
  return JSON.stringify([
    kind,
    p,
    d,
    c.sourceRevision,
    c.sourceSha256,
    c.lifecycleVersion,
    c.revision,
    c.canVerify,
  ]);
}
