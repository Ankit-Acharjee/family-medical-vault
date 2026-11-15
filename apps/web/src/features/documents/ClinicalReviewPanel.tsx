import { useEffect, useId, useRef, useState } from 'react';
import { isSaveClinicalReview, labFieldKeys } from '@fmv/contracts';
import type {
  ClinicalReviewResult,
  LabFieldKey,
  ReviewedLabFields,
  SavedExtraction,
} from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import { ClinicalHistory } from './ClinicalHistory';
import { ClinicalLabFields } from './ClinicalLabFields';
import { useClinicalReview } from './useClinicalReview';
import {
  clinicalDraftKey,
  type ClinicalDraftRef,
  type ClinicalSaveState,
} from './clinicalReviewDraft';
function ReviewForm({
  data,
  saveState,
  onSave,
  onReload,
  onShowSource,
  draft,
  contextKey,
}: {
  data: ClinicalReviewResult;
  saveState: ClinicalSaveState;
  draft: ClinicalDraftRef;
  contextKey: string;
  onSave: (body: string) => void;
  onReload: () => void;
  onShowSource: (t: { page: number; excerpt: string }) => void;
}) {
  const id = useId();
  const [drafts, setDrafts] = useState(() =>
    draft.current?.key === contextKey
      ? draft.current.entries
      : data.candidates.map((c) => {
          const prior =
            data.context.canVerify &&
            data.snapshot?.sourceRevision === data.context.sourceRevision
              ? data.snapshot.items.find((item) => item.source.id === c.id)
              : null;
          return {
            candidateId: c.id,
            selected: false,
            fields: prior
              ? { ...prior.fields }
              : (Object.fromEntries(
                  labFieldKeys.map((k) => [k, c.fields[k]?.value ?? null]),
                ) as ReviewedLabFields),
          };
        }),
  );
  const [confirmed, setConfirmed] = useState(
      draft.current?.key === contextKey && draft.current.confirmed,
    ),
    [invalid, setInvalid] = useState(false);
  const body = useRef<string | null>(
    draft.current?.key === contextKey ? draft.current.body : null,
  );
  useEffect(() => {
    if (data.context.canVerify)
      draft.current = {
        key: contextKey,
        entries: drafts,
        confirmed,
        body: body.current,
        saveState,
      };
  }, [draft, contextKey, data.context.canVerify, drafts, confirmed, saveState]);
  const locked = saveState !== 'idle';
  const change = (i: number, k: LabFieldKey, v: string) =>
    setDrafts((all) =>
      all.map((d, n) =>
        n === i
          ? {
              ...d,
              fields: {
                ...d.fields,
                [k]: v === '' && k !== 'analyte' && k !== 'result' ? null : v,
              },
            }
          : d,
      ),
    );
  const submit = () => {
    if (body.current) {
      if (saveState === 'uncertain') onSave(body.current);
      return;
    }
    const payload = {
      requestId: crypto.randomUUID(),
      expectedRevision: data.context.revision,
      sourceRevision: data.context.sourceRevision,
      sourceSha256: data.context.sourceSha256,
      lifecycleVersion: data.context.lifecycleVersion,
      confirmed,
      selections: drafts
        .filter((d) => d.selected)
        .map(({ candidateId, fields }) => ({ candidateId, fields })),
    };
    if (!isSaveClinicalReview(payload)) {
      setInvalid(true);
      return;
    }
    body.current = JSON.stringify(payload);
    setInvalid(false);
    onSave(body.current);
  };
  return (
    <div className="min-w-0 space-y-4">
      {data.snapshot && (
        <section
          aria-label="Owner-confirmed lab fields"
          className="space-y-3 border-b border-border pb-3"
        >
          <h4 className="text-sm font-semibold">Verified by profile owner</h4>
          <p className="text-sm text-muted-foreground">
            Set revision {data.snapshot.revision} · Updated{' '}
            {new Date(data.snapshot.verifiedAt).toLocaleString()} · saved text
            revision {data.snapshot.sourceRevision}. Earlier confirmations are
            retained in history.
          </p>
          <p className="text-sm text-muted-foreground">
            Confirmed source:{' '}
            {data.snapshot.extraction.method === 'pdf-text'
              ? 'embedded PDF text'
              : 'OCR'}
            {data.snapshot.extraction.partial ? ' · partial extraction' : ''}.
          </p>
          {data.snapshot.sourceRevision !== data.context.sourceRevision && (
            <p className="text-sm text-muted-foreground">
              The saved text has changed since confirmation. These confirmed
              values have not been replaced by the new extraction.
            </p>
          )}
          {data.snapshot.items.map((item) => (
            <details key={item.source.id}>
              <summary className="min-h-11 cursor-pointer content-center break-words text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
                {item.fields.analyte} · {item.fields.result}{' '}
                {item.fields.unit ?? ''}
              </summary>
              <ClinicalLabFields
                candidate={item.source}
                fields={item.fields}
                editable={false}
                verified
                sourceAvailable={
                  data.snapshot!.sourceRevision === data.context.sourceRevision
                }
                onChange={() => {}}
                onShowSource={onShowSource}
              />
            </details>
          ))}
        </section>
      )}
      <p className="text-sm text-muted-foreground">
        Automatic extraction may be inaccurate. Compare selected values and
        units with the original document before confirming.
      </p>
      {data.candidates.length === 20 && (
        <p className="text-sm text-muted-foreground">
          Up to 20 entries are shown. Other results may not be listed; check the
          full original report.
        </p>
      )}
      {!data.candidates.length ? (
        <p role="status" className="text-sm text-muted-foreground">
          No lab fields could be identified. The original and saved text remain
          available.
        </p>
      ) : (
        <>
          {data.context.canVerify ? (
            <Button
              variant="secondary"
              disabled={locked}
              onClick={() =>
                setDrafts((all) =>
                  all.map((d) => ({
                    ...d,
                    selected: !all.every((x) => x.selected),
                  })),
                )
              }
            >
              {drafts.every((d) => d.selected)
                ? 'Clear selection'
                : 'Select all entries'}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Only the profile owner may verify clinical fields. You may review
              the unverified source.
            </p>
          )}
          {data.candidates.map((c, i) => (
            <section
              key={c.id}
              aria-label={`Lab candidate ${i + 1}`}
              className="min-w-0 space-y-3 rounded-xl border border-border p-3"
            >
              <div className="flex items-start gap-2">
                {data.context.canVerify && (
                  <input
                    id={`${id}-${i}`}
                    type="checkbox"
                    checked={drafts[i]!.selected}
                    disabled={locked}
                    className="mt-1 size-5 shrink-0 accent-primary"
                    onChange={(e) =>
                      setDrafts((all) =>
                        all.map((d, n) =>
                          n === i ? { ...d, selected: e.target.checked } : d,
                        ),
                      )
                    }
                  />
                )}
                <label
                  htmlFor={data.context.canVerify ? `${id}-${i}` : undefined}
                  className="min-h-11 content-center break-words text-sm font-semibold"
                >
                  {c.fields.analyte.value} · Unverified · Page {c.page}
                </label>
              </div>
              {data.context.canVerify &&
                data.snapshot?.sourceRevision === data.context.sourceRevision &&
                data.snapshot.items.some((item) => item.source.id === c.id) && (
                  <p className="text-sm text-muted-foreground">
                    Uses your confirmed corrections from this saved text.
                  </p>
                )}
              <ClinicalLabFields
                candidate={c}
                fields={drafts[i]!.fields}
                editable={data.context.canVerify}
                disabled={locked}
                onChange={(k, v) => change(i, k, v)}
                onShowSource={onShowSource}
              />
            </section>
          ))}
          {data.context.canVerify && (
            <>
              {data.snapshot && (
                <p className="text-sm text-muted-foreground">
                  {data.snapshot.sourceRevision === data.context.sourceRevision
                    ? 'Selected entries update the confirmed set; existing confirmed entries remain. Earlier sets stay in history.'
                    : 'The saved source has changed. Verification creates a new set from selected entries in the current source; earlier sets stay in history. Review the selection before continuing.'}
                </p>
              )}
              <label className="flex min-h-11 items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={locked}
                  className="mt-1 size-5 shrink-0 accent-primary"
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  I checked all selected values and units against the original
                  document.
                </span>
              </label>
              {invalid && (
                <p role="alert" className="text-sm text-destructive">
                  Select at least one entry, complete its test and result, and
                  confirm the source check. Fields must contain at most 120
                  characters.
                </p>
              )}
              <p role="status" className="text-sm text-muted-foreground">
                {saveState === 'saved'
                  ? 'Selected fields verified. Reload review to see the confirmed set.'
                  : saveState === 'uncertain'
                    ? 'Verification could not be confirmed. Retry the same request or reload the current review.'
                    : saveState === 'conflict'
                      ? 'The document, source or review changed. Reload saved text before verifying.'
                      : saveState === 'failed'
                        ? 'Verification failed. Reload review before trying again.'
                        : 'You can close this view and review later; nothing is verified until you explicitly confirm.'}
              </p>
              <Button
                disabled={!['idle', 'uncertain'].includes(saveState)}
                onClick={submit}
              >
                {saveState === 'pending'
                  ? 'Verifying…'
                  : saveState === 'uncertain'
                    ? 'Retry verification'
                    : saveState === 'saved'
                      ? 'Verified'
                      : 'Verify selected lab fields'}
              </Button>
              {['saved', 'uncertain', 'failed'].includes(saveState) && (
                <Button variant="secondary" onClick={onReload}>
                  Reload clinical review
                </Button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
export function ClinicalReviewPanel({
  patientId,
  patientName,
  documentId,
  snapshot,
  onDenied,
  onReloadSource,
  onShowSource,
  draft,
}: {
  patientId: string;
  patientName: string;
  documentId: string;
  snapshot: SavedExtraction;
  draft: ClinicalDraftRef;
  onDenied: () => void;
  onReloadSource: () => void;
  onShowSource: (t: { page: number; excerpt: string }) => void;
}) {
  const { state, saveState, reload, save } = useClinicalReview(
    patientId,
    documentId,
    snapshot,
    onDenied,
    draft,
  );
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (saveState === 'saved') heading.current?.focus();
  }, [saveState]);
  const refresh = () => {
    heading.current?.focus();
    reload();
  };
  return (
    <section
      aria-label="Clinical lab review"
      className="min-w-0 rounded-xl border border-border px-4 py-1"
    >
      <details>
        <summary className="min-h-11 cursor-pointer content-center rounded-sm text-sm font-semibold focus-visible:outline-2 focus-visible:outline-ring">
          Lab fields · Review
        </summary>
        <div className="min-w-0 space-y-3 pb-3 pt-2">
          <h3
            ref={heading}
            tabIndex={-1}
            className="break-words text-sm font-semibold"
          >
            Patient: {patientName}
          </h3>
          {snapshot.partial && (
            <p className="text-sm text-muted-foreground">
              Partial extraction: pages or values may be missing. Confirming
              selected entries does not establish that the report is complete.
            </p>
          )}
          {snapshot.method !== 'pdf-text' && (
            <p className="text-sm text-muted-foreground">
              OCR may misread values, units or handwriting. Compare selected
              fields with the original.
            </p>
          )}
          {state === 'loading' ? (
            <p role="status">Loading clinical review…</p>
          ) : state === 'failed' ? (
            <>
              <p role="status" className="text-sm text-muted-foreground">
                Clinical review could not be loaded. The original and saved text
                remain available.
              </p>
              <Button variant="secondary" onClick={refresh}>
                Retry clinical review
              </Button>
            </>
          ) : state === 'conflict' || saveState === 'conflict' ? (
            <>
              <p role="status" className="text-sm text-muted-foreground">
                The saved source or review changed. Reload saved text before
                verifying.
              </p>
              <Button variant="secondary" onClick={onReloadSource}>
                Reload saved text
              </Button>
            </>
          ) : (
            <>
              <ReviewForm
                key={`${state.context.revision}:${state.context.sourceRevision}:${state.context.lifecycleVersion}`}
                data={state}
                draft={draft}
                contextKey={clinicalDraftKey(patientId, documentId, state)}
                saveState={saveState}
                onSave={(body) => void save(body)}
                onReload={refresh}
                onShowSource={onShowSource}
              />
              {state.context.revision > 1 && (
                <ClinicalHistory
                  key={clinicalDraftKey(patientId, documentId, state)}
                  patientId={patientId}
                  documentId={documentId}
                  context={state.context}
                  onReloadSource={onReloadSource}
                  onDenied={onDenied}
                />
              )}
            </>
          )}
        </div>
      </details>
    </section>
  );
}
