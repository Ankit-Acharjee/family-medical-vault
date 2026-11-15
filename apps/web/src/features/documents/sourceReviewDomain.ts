import {
  isDiagnosisReviewResult,
  isMedicationReviewResult,
  isDiagnosisHistoryResult,
  isMedicationHistoryResult,
  isSaveDiagnosisReview,
  isSaveMedicationReview,
  isWithdrawDiagnosisReview,
  isWithdrawMedicationReview,
} from '@fmv/contracts';
import type {
  DiagnosisReviewResult,
  MedicationReviewResult,
  DiagnosisHistoryResult,
  MedicationHistoryResult,
  DiagnosisCandidate,
  MedicationCandidate,
} from '@fmv/contracts';
export type SourceReviewKind = 'diagnosis' | 'medication';
export type SourceReviewResult = DiagnosisReviewResult | MedicationReviewResult;
export type SourceHistoryResult =
  DiagnosisHistoryResult | MedicationHistoryResult;
export type SourceCandidate = DiagnosisCandidate | MedicationCandidate;
export function isSourceReviewResult(
  kind: SourceReviewKind,
  value: unknown,
): value is SourceReviewResult {
  return kind === 'diagnosis'
    ? isDiagnosisReviewResult(value)
    : isMedicationReviewResult(value);
}
export function isSourceHistoryResult(
  kind: SourceReviewKind,
  value: unknown,
): value is SourceHistoryResult {
  return kind === 'diagnosis'
    ? isDiagnosisHistoryResult(value)
    : isMedicationHistoryResult(value);
}
export function isSourceReviewInput(
  kind: SourceReviewKind,
  value: unknown,
  withdrawal: boolean,
) {
  return kind === 'diagnosis'
    ? withdrawal
      ? isWithdrawDiagnosisReview(value)
      : isSaveDiagnosisReview(value)
    : withdrawal
      ? isWithdrawMedicationReview(value)
      : isSaveMedicationReview(value);
}
export function sourceCandidateLabel(candidate: SourceCandidate) {
  return 'field' in candidate
    ? candidate.field.value
    : candidate.fields.medication.value;
}
/** Each field remains separate evidence; canonical field order is not claimed as source line order. */
export function sourceCandidateExcerpts(candidate: SourceCandidate) {
  return 'field' in candidate
    ? [candidate.field.excerpt]
    : Object.values(candidate.fields).flatMap((field) =>
        field ? [field.excerpt] : [],
      );
}
