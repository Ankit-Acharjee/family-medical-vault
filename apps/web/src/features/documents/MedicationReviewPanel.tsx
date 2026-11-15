import type { SavedExtraction } from '@fmv/contracts';
import type { SourceDraftRef } from './sourceReviewDraft';
import { SourceReviewPanel } from './SourceReviewPanel';
export function MedicationReviewPanel(props: {
  patientName: string;
  patientId: string;
  documentId: string;
  snapshot: SavedExtraction;
  draft: SourceDraftRef;
  onDenied: () => void;
  onReloadSource: () => void;
  onShowSource: (v: { page: number; excerpt: string }) => void;
}) {
  return <SourceReviewPanel {...props} kind="medication" />;
}
