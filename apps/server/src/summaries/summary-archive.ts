import { zipBuffers } from '../archives/zip.js';
import { Buffer } from 'node:buffer';
import { PayloadTooLargeException } from '@nestjs/common';
import { isGroundedSummary, maximumSummaryExportBytes } from '@fmv/contracts';
import type { GroundedSummary } from '@fmv/contracts';
const escape = (value: unknown) =>
  String(value ?? 'Unknown').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const text = (v: unknown) => `<bdi>${escape(v)}</bdi>`;
const fields = (pairs: [string, unknown][]) =>
  `<dl>${pairs.map(([name, value]) => `<div><dt>${escape(name)}</dt><dd>${text(value)}</dd></div>`).join('')}</dl>`;
export function summaryHtml(summary: GroundedSummary, patientName: string) {
  if (!isGroundedSummary(summary))
    throw Error('Invalid summary representation');
  const lab = (row: GroundedSummary['laboratory']['dated'][number]) =>
    `<article><h3>${text(row.measurement.fields.analyte)}</h3><p>Owner-confirmed laboratory value</p>${fields(Object.entries(row.measurement.fields))}<p>Source: ${text(row.title)} · page ${row.measurement.source.page} · document ${text(row.member.documentId)} · source revision ${row.member.sourceRevision} · review revision ${row.member.reviewRevision} · lifecycle ${row.member.lifecycleVersion}</p><p>Original fingerprint: ${text(row.member.sourceSha256)}</p><p>Original extracted evidence (may differ from owner corrections):</p><blockquote>${text(row.measurement.source.fields.result.excerpt)}</blockquote></article>`;
  const labs = summary.scope === 'patient' || summary.scope === 'laboratory';
  const manual = summary.scope === 'patient' || summary.scope === 'manual';
  const meds = summary.scope === 'patient' || summary.scope === 'medication';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Family Medical Vault — patient summary</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#0f1724;background:white;max-width:850px;margin:32px auto;padding:0 20px}h1{font-size:26px}h2{font-size:20px;border-top:1px solid #c8d6e6;padding-top:20px}h3{font-size:16px}article{border:1px solid #c8d6e6;border-radius:10px;padding:16px;margin:16px 0;break-inside:avoid}p,dd,blockquote{white-space:pre-wrap;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}dt{font-weight:600}dd{margin:2px 0}blockquote{border-left:3px solid #c8d6e6;padding-left:12px;margin-left:0}footer{border-top:1px solid #c8d6e6;margin-top:24px;padding-top:16px}@media print{body{margin:0;max-width:none}article{box-shadow:none}@page{margin:18mm}}</style></head><body><header><h1>Patient summary</h1><p>${text(patientName)}</p><p>Person ID: ${text(summary.patientId)}</p><p>Generated: ${text(summary.generatedAt)} · scope: ${text(summary.scope)}</p><p>${summary.period ? `Reported dates: ${text(summary.period.fromDate)} through ${text(summary.period.toDate)}, inclusive. Undated laboratory records remain separate.` : 'No reported-date period selected.'}</p></header><p>This is a bounded record window, not a complete medical history. Unverified, withdrawn and invalid-source records are excluded. Missing data is unknown, never evidence that a condition or treatment is absent.</p>${labs ? `<section><h2>Owner-confirmed laboratory results</h2>${summary.coverage.laboratoryLimited ? '<p>Incomplete source window: older results may match this period.</p>' : ''}${summary.laboratory.dated.map(lab).join('') || '<p>No dated results in this available window.</p>'}<h3>Unknown or imprecise collection dates</h3>${summary.laboratory.undated.map(lab).join('') || '<p>No undated results in this available window.</p>'}<p>Results are not merged or compared. No units, dates or reference intervals are inferred or converted.</p></section>` : ''}${manual ? `<section><h2>Manual / user-reported readings</h2>${summary.coverage.manualLimited ? '<p>Latest 20-record window: older matching readings may be omitted.</p>' : ''}${summary.manual.map((row) => `<article><h3>${text(row.reading.kind)}</h3><p>Manual / user-reported, not a laboratory verification</p>${fields([['Observed as recorded', row.reading.observedAt], ['Unit', row.reading.unit], ...Object.entries(row.reading.values), ['Reading ID', row.readingId], ['Revision', row.revision]])}</article>`).join('') || '<p>No active user-reported readings in this available window.</p>'}</section>` : ''}${meds ? `<section><h2>Medication context — current record snapshot</h2><p>Current/historical labels were explicitly recorded by the owner. This snapshot does not reconstruct treatment during the requested period or recommend starting/stopping medication.</p>${summary.coverage.medicationsLimited ? '<p>Latest 20-record window: additional medication records are omitted.</p>' : ''}${summary.medications.map(({ entry }) => `<article><h3>${text(entry.fields.medication)}</h3><p>Owner-recorded status: ${text(entry.recordedStatus)}</p>${fields(Object.entries(entry.fields))}<p>Medication ID: ${text(entry.medicationId)} · revision ${entry.revision}</p><p>Source document: ${text(entry.source.documentId)} · source block ${text(entry.source.candidateId)} · text revision ${entry.source.sourceRevision} · review revision ${entry.source.reviewRevision} · lifecycle ${entry.source.lifecycleVersion}</p><p>Original fingerprint: ${text(entry.source.sourceSha256)}</p></article>`).join('') || '<p>No source-current medication records in this available window.</p>'}</section>` : ''}<footer><p>Reported collection/observation calendar dates are preserved, including manual offsets. Upload and verification dates are not substituted. The source window contains up to 50 laboratory results from 25 recent reports and the latest 20 manual and medication records; older matching records may be missing.</p><p>Source IDs, versions and fingerprints enable traceability. Original files are not included in this summary archive. The JSON file additionally preserves structured provenance and clearly labeled extracted source evidence.</p><p>This private export contains medical information. Downloaded copies cannot be revoked by Family Medical Vault. No diagnosis, interpretation or prescribing recommendation is generated.</p></footer></body></html>`;
}
export async function summaryArchive(
  summary: GroundedSummary,
  patientName: string,
  signal: AbortSignal,
): Promise<Buffer> {
  signal.throwIfAborted();
  const files = [
    ['summary.html', Buffer.from(summaryHtml(summary, patientName), 'utf8')],
    ['summary.json', Buffer.from(JSON.stringify(summary, null, 2), 'utf8')],
    [
      'README.txt',
      Buffer.from(
        'Private Family Medical Vault summary export. Open summary.html for a readable report; summary.json preserves exact structured provenance. Originals are not included. Missing data remains unknown. The summary is bounded and is not a complete history. Downloaded copies cannot be revoked. No scripts, remote assets or external processing are used.\n',
        'utf8',
      ),
    ],
  ] as const;
  if (files.reduce((n, [, b]) => n + b.length, 0) > 8 * 1024 * 1024)
    throw new PayloadTooLargeException();
  return zipBuffers(files, maximumSummaryExportBytes, signal);
}
