import { useId } from 'react';
import { labFieldKeys } from '@fmv/contracts';
import type {
  LabFieldCandidate,
  LabFieldKey,
  ReviewedLabFields,
} from '@fmv/contracts';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
export const clinicalFieldLabels: Record<LabFieldKey, string> = {
  analyte: 'Test / analyte',
  result: 'Result as written',
  unit: 'Unit',
  reference: 'Reference interval',
  specimen: 'Specimen',
  method: 'Method',
  date: 'Collection date as written',
  laboratory: 'Laboratory',
};
export function ClinicalLabFields({
  candidate,
  fields,
  editable,
  disabled,
  verified,
  sourceAvailable = true,
  onChange,
  onShowSource,
}: {
  candidate: LabFieldCandidate;
  fields: ReviewedLabFields;
  editable: boolean;
  disabled?: boolean | undefined;
  verified?: boolean | undefined;
  sourceAvailable?: boolean;
  onChange: (key: LabFieldKey, value: string) => void;
  onShowSource: (target: { page: number; excerpt: string }) => void;
}) {
  const id = useId();
  const render = (key: LabFieldKey) => (
    <div key={key} className="min-w-0 space-y-1">
      <p className="text-sm font-medium">{clinicalFieldLabels[key]}</p>
      {editable ? (
        <Input
          aria-label={clinicalFieldLabels[key]}
          disabled={disabled}
          id={`${id}-${key}`}
          value={fields[key] ?? ''}
          maxLength={120}
          autoComplete="off"
          onChange={(e) => onChange(key, e.target.value)}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm">
          {fields[key] ?? 'Unknown'}
        </p>
      )}
      {verified && fields[key] !== (candidate.fields[key]?.value ?? null) && (
        <p className="text-sm text-muted-foreground">
          {candidate.fields[key]
            ? 'Corrected during owner review; the extracted representation is preserved below.'
            : 'Entered during owner review; no extracted value was available for this field.'}
        </p>
      )}
      {candidate.fields[key] && (
        <details className="min-w-0 text-sm">
          <summary className="min-h-11 cursor-pointer content-center rounded-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
            Source · Page {candidate.page}
          </summary>
          <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3">
            {candidate.fields[key]!.excerpt}
          </blockquote>
          {sourceAvailable && (
            <Button
              variant="secondary"
              className="mt-2"
              onClick={() =>
                onShowSource({
                  page: candidate.page,
                  excerpt: candidate.fields[key]!.excerpt,
                })
              }
            >
              Show in source
            </Button>
          )}
        </details>
      )}
    </div>
  );
  return (
    <div className="min-w-0 space-y-3">
      {labFieldKeys.slice(0, 3).map(render)}
      <details>
        <summary className="min-h-11 cursor-pointer content-center text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
          Additional source fields
        </summary>
        <div className="space-y-3">{labFieldKeys.slice(3).map(render)}</div>
      </details>
    </div>
  );
}
