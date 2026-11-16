import type { ConfirmedMeasurement, MeasurementSource } from '@fmv/contracts';
import { OriginalComparison } from '../documents/OriginalComparison';
import { labFieldKeys } from '@fmv/contracts';
import { clinicalFieldLabels } from '../documents/ClinicalLabFields';
export function MeasurementDetails({
  measurement,
  source,
  enabled,
  onDenied,
  onReload,
}: {
  measurement: ConfirmedMeasurement;
  source?: MeasurementSource | undefined;
  enabled: boolean;
  onDenied: () => void;
  onReload: () => void;
}) {
  if (!enabled) return null;
  const f = measurement.fields;
  return (
    <div className="flex min-w-0 flex-col gap-4 pt-2 text-sm">
      <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
        {[
          ['Collection date as written', f.date],
          ['Reference interval', f.reference],
          ['Specimen', f.specimen],
          ['Method', f.method],
          ['Laboratory', f.laboratory],
        ].map(([name, value]) => (
          <div className="min-w-0" key={name}>
            <dt className="text-muted-foreground">{name}</dt>
            <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">
              {value ?? 'Unknown'}
            </dd>
          </div>
        ))}
      </dl>
      <div className="min-w-0 rounded-lg border-l-2 border-border pl-3">
        <p className="font-medium">Source · page {measurement.source.page}</p>
        <blockquote className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {measurement.source.fields.result.excerpt}
        </blockquote>
        <p className="mt-2 text-muted-foreground">
          Reviewed values may include owner corrections. Source evidence is
          preserved.
        </p>
        <details className="mt-2">
          <summary className="min-h-11 cursor-pointer content-center rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
            All extracted source fields
          </summary>
          <dl className="flex min-w-0 flex-col gap-3">
            {labFieldKeys.map((key) =>
              measurement.source.fields[key] ? (
                <div className="min-w-0" key={key}>
                  <dt className="text-muted-foreground">
                    {clinicalFieldLabels[key]}
                  </dt>
                  <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {measurement.source.fields[key]!.excerpt}
                  </dd>
                </div>
              ) : null,
            )}
          </dl>
        </details>
      </div>
      {source && (
        <OriginalComparison
          source={{
            patientId: measurement.provenance.patientId,
            documentId: source.documentId,
            title: source.title,
            bytes: source.bytes,
            mime: source.mimeType,
            sha256: measurement.provenance.sourceSha256,
          }}
          onDenied={onDenied}
          onReloadSource={onReload}
        />
      )}
    </div>
  );
}
