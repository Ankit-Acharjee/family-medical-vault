/** Supplied only inside the medication service's currently authorized, locked transaction. */
export type MedicationRecordContext = {
  patientId: string;
  medicationId: string;
  medicationRevision: number;
  medicationEntryId: string;
  accountId: string;
  owner: boolean;
  sourceState: 'current-source' | 'source-review-required';
};
