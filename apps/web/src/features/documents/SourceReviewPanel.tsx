import { useEffect, useRef, useState } from 'react';
import {
  isSourceReviewInput,
  sourceCandidateExcerpts,
  sourceCandidateLabel,
  type SourceReviewResult,
  type SourceReviewKind,
} from './sourceReviewDomain';
import type { SavedExtraction } from '@fmv/contracts';
import type {
  ClinicalOperation,
  ClinicalSaveState,
} from './clinicalReviewDraft';
import { Button } from '../../components/ui/button';
import { DiagnosisCandidates } from './DiagnosisCandidates';
import { SourceHistory } from './SourceHistory';
import { MedicationCandidates } from './MedicationCandidates';
import { sourceDraftKey } from './sourceReviewDraft';
import type { SourceDraftRef } from './sourceReviewDraft';
import { useSourceReview } from './useSourceReview';
function Review({
  kind,
  data,
  snapshot,
  draft,
  contextKey,
  saveState,
  onSave,
  onReload,
  onDenied,
  onReloadSource,
  onShowSource,
  patientName,
  patientId,
  documentId,
  opened,
  onOpenChange,
}: {
  kind: SourceReviewKind;
  data: SourceReviewResult;
  snapshot: SavedExtraction;
  draft: SourceDraftRef;
  contextKey: string;
  saveState: ClinicalSaveState;
  onSave: (body: string, op: ClinicalOperation) => void;
  onReload: () => void;
  onDenied: () => void;
  onReloadSource: () => void;
  onShowSource: (v: { page: number; excerpt: string }) => void;
  patientName: string;
  patientId: string;
  documentId: string;
  opened: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const cached = draft.current?.key === contextKey ? draft.current : null;
  const [selected, setSelected] = useState(cached?.selected ?? []),
    [attested, setAttested] = useState(cached?.attested ?? false),
    [withdrawSelected, setWithdrawSelected] = useState(
      cached?.withdrawSelected ?? [],
    ),
    [withdrawAttested, setWithdrawAttested] = useState(
      cached?.withdrawAttested ?? false,
    );
  const body = useRef<string | null>(cached?.body ?? null),
    op = useRef<ClinicalOperation>(cached?.operation ?? 'confirmation');
  useEffect(() => {
    if (data.context.canVerify)
      draft.current = {
        key: contextKey,
        selected,
        attested,
        withdrawSelected,
        withdrawAttested,
        body: body.current,
        operation: op.current,
        saveState,
      };
  }, [
    draft,
    contextKey,
    data.context.canVerify,
    selected,
    attested,
    withdrawSelected,
    withdrawAttested,
    saveState,
  ]);
  const locked = saveState !== 'idle';
  const send = (operation: ClinicalOperation) => {
    if (body.current) {
      if (saveState === 'uncertain' && operation === op.current)
        onSave(body.current, operation);
      return;
    }
    if (locked) return;
    const base = {
      requestId: crypto.randomUUID(),
      expectedRevision: data.context.revision,
      sourceSha256: data.context.sourceSha256,
      lifecycleVersion: data.context.lifecycleVersion,
      meaning:
        kind === 'diagnosis' ? 'source-statement-only' : 'source-fields-only',
      confirmed: operation === 'confirmation' ? attested : withdrawAttested,
      candidateIds: operation === 'confirmation' ? selected : withdrawSelected,
    };
    const payload =
      operation === 'confirmation'
        ? { ...base, sourceRevision: data.context.sourceRevision }
        : base;
    if (!isSourceReviewInput(kind, payload, operation === 'withdrawal')) return;
    op.current = operation;
    body.current = JSON.stringify(payload);
    onSave(body.current, operation);
  };
  const prior = data.snapshot;
  const review = prior && (
    <section
      aria-label={
        kind === 'diagnosis'
          ? 'Owner-confirmed diagnosis source statements'
          : 'Owner-confirmed medication source fields'
      }
      className="space-y-2 border-b border-border pb-3"
    >
      <h4 className="text-sm font-semibold">
        {kind === 'diagnosis'
          ? 'Owner-confirmed source statements'
          : 'Owner-confirmed prescription source fields'}
      </h4>
      <p className="text-pretty text-sm text-muted-foreground">
        {kind === 'diagnosis'
          ? 'Confirmation attests the wording, including negation, uncertainty, history and subject. It does not establish a current patient diagnosis.'
          : 'Confirmation attests all provided prescription fields exactly as written, including uncertainty and historical or stopped wording. Missing fields remain unknown. Separate reconciliation is required before creating an active regimen or schedule.'}
      </p>
      <p className="text-sm text-muted-foreground">
        Revision {prior.revision} ·{' '}
        {new Date(prior.confirmedAt).toLocaleString()} · saved text revision{' '}
        {prior.sourceRevision}
      </p>
      <p className="text-sm text-muted-foreground">
        Confirmed source:{' '}
        {prior.extraction.method === 'pdf-text' ? 'embedded PDF text' : 'OCR'}
        {prior.extraction.partial ? ' · partial text' : ''}
        {prior.extraction.downsized ? ' · image resized' : ''}.
      </p>
      {prior.sourceRevision !== data.context.sourceRevision && (
        <p className="text-sm text-muted-foreground">
          The saved text has changed; these statements retain their earlier
          source.
        </p>
      )}
      {!prior.statements.length && (
        <p role="status" className="text-sm">
          {kind === 'diagnosis'
            ? 'No active confirmed source statements.'
            : 'No currently confirmed prescription source blocks.'}
        </p>
      )}
      {prior.statements.map((s) => (
        <blockquote
          key={s.id}
          className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm [overflow-wrap:anywhere]"
        >
          {sourceCandidateExcerpts(s).map((excerpt, index) => (
            <p key={index}>{excerpt}</p>
          ))}
        </blockquote>
      ))}
      {prior.withdrawnStatements.map((s) => (
        <div key={s.id} className="text-sm">
          <p className="font-medium">
            {kind === 'diagnosis'
              ? 'Withdrawn source statement'
              : 'Withdrawn prescription source fields'}
          </p>
          <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 [overflow-wrap:anywhere]">
            {sourceCandidateExcerpts(s).map((excerpt, index) => (
              <p key={index}>{excerpt}</p>
            ))}
          </blockquote>
        </div>
      ))}
    </section>
  );
  const Candidates =
    kind === 'diagnosis' ? DiagnosisCandidates : MedicationCandidates;
  return (
    <Candidates
      snapshot={snapshot}
      open={opened}
      onOpenChange={onOpenChange}
      selected={selected}
      onSelection={data.context.canVerify ? setSelected : undefined}
      disabled={locked}
      review={
        <>
          <p className="break-words text-sm font-semibold">
            Patient: {patientName}
          </p>
          {review}
        </>
      }
      onShowSource={onShowSource}
    >
      {data.context.canVerify ? (
        <div className="space-y-3 border-t border-border pt-3">
          {data.candidates.length > 0 && (
            <>
              <Button
                variant="secondary"
                disabled={locked}
                onClick={() =>
                  setSelected(
                    selected.length === data.candidates.length
                      ? []
                      : data.candidates.map((c) => c.id),
                  )
                }
              >
                {selected.length === data.candidates.length
                  ? kind === 'diagnosis'
                    ? 'Clear source statement selection'
                    : 'Clear prescription block selection'
                  : kind === 'diagnosis'
                    ? 'Select all source statements'
                    : 'Select all prescription blocks'}
              </Button>
              <label className="flex min-h-11 items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={attested}
                  disabled={locked}
                  className="mt-1 size-5 shrink-0 accent-primary"
                  onChange={(e) => setAttested(e.target.checked)}
                />
                <span>
                  {kind === 'diagnosis'
                    ? 'I checked the selected statements against the original, including negation, uncertainty, history and who they refer to. I am confirming the wording only, not current patient diagnoses.'
                    : 'I checked every provided field in the selected blocks against the original, including medication, strength, dose, frequency and qualifiers. I confirm the source wording only, including historical, stopped or uncertain wording. This does not create an active regimen or schedule.'}
                </span>
              </label>
              <Button
                disabled={
                  !(
                    saveState === 'uncertain' && op.current === 'confirmation'
                  ) &&
                  (locked || !selected.length || !attested)
                }
                onClick={() => send('confirmation')}
              >
                {saveState === 'uncertain' && op.current === 'confirmation'
                  ? 'Retry source confirmation'
                  : saveState === 'pending' && op.current === 'confirmation'
                    ? kind === 'diagnosis'
                      ? 'Confirming source statements…'
                      : 'Confirming prescription source fields…'
                    : kind === 'diagnosis'
                      ? 'Confirm selected source statements'
                      : 'Confirm selected prescription fields'}
              </Button>
            </>
          )}
          {prior && prior.statements.length > 0 && (
            <section
              aria-label={`Withdraw ${kind} source confirmations`}
              className="space-y-2 rounded-lg border border-border p-3"
            >
              <h4 className="text-sm font-semibold">
                Withdraw a mistaken source confirmation
              </h4>
              <p className="text-pretty text-sm text-muted-foreground">
                History and evidence remain. Unsaved selections will reset after
                confirmation or withdrawal.
              </p>
              <fieldset disabled={locked} className="space-y-2">
                <legend className="sr-only">
                  Source confirmations to withdraw
                </legend>
                {prior.statements.map((s, i) => (
                  <label
                    key={s.id}
                    className="flex min-h-11 min-w-0 items-start gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      aria-label={`Withdraw ${kind} source confirmation ${i + 1}`}
                      className="mt-1 size-5 shrink-0 accent-primary"
                      checked={withdrawSelected.includes(s.id)}
                      onChange={(e) =>
                        setWithdrawSelected(
                          e.target.checked
                            ? [...withdrawSelected, s.id]
                            : withdrawSelected.filter((id) => id !== s.id),
                        )
                      }
                    />
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                      {sourceCandidateLabel(s)}
                    </span>
                  </label>
                ))}
                <label className="flex min-h-11 items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={withdrawAttested}
                    className="mt-1 size-5 shrink-0 accent-primary"
                    onChange={(e) => setWithdrawAttested(e.target.checked)}
                  />
                  <span>
                    I want to withdraw the selected source confirmations and
                    preserve their history.
                  </span>
                </label>
              </fieldset>
              <Button
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={
                  !(saveState === 'uncertain' && op.current === 'withdrawal') &&
                  (locked || !withdrawSelected.length || !withdrawAttested)
                }
                onClick={() => send('withdrawal')}
              >
                {saveState === 'uncertain' && op.current === 'withdrawal'
                  ? 'Retry source withdrawal'
                  : saveState === 'pending' && op.current === 'withdrawal'
                    ? 'Withdrawing source confirmations…'
                    : 'Withdraw selected source confirmations'}
              </Button>
            </section>
          )}
          {saveState === 'pending' && (
            <p role="status" className="text-sm text-muted-foreground">
              {kind === 'diagnosis'
                ? 'Recording the source statement action…'
                : 'Recording the prescription source action…'}
            </p>
          )}
          {saveState === 'uncertain' && (
            <p role="status" className="text-sm text-muted-foreground">
              The action could not be confirmed. Retry the same request or
              reload the current source review.
            </p>
          )}
          {saveState === 'failed' && (
            <p role="status" className="text-sm text-muted-foreground">
              The source action failed. Reload before trying again.
            </p>
          )}
          {['uncertain', 'failed'].includes(saveState) && (
            <Button variant="secondary" onClick={onReload}>
              Reload source review
            </Button>
          )}
        </div>
      ) : (
        <p className="text-pretty text-sm text-muted-foreground">
          {kind === 'diagnosis'
            ? 'Only the profile owner may confirm or withdraw source statements. You may review the unverified text.'
            : 'Only the profile owner may confirm or withdraw prescription source fields. You may review the unverified text.'}
        </p>
      )}
      {data.context.revision > 1 && (
        <SourceHistory
          kind={kind}
          key={contextKey}
          patientId={patientId}
          documentId={documentId}
          context={data.context}
          onDenied={onDenied}
          onReload={onReloadSource}
        />
      )}
    </Candidates>
  );
}
export function SourceReviewPanel({
  kind,
  patientName,
  patientId,
  documentId,
  snapshot,
  draft,
  onDenied,
  onReloadSource,
  onShowSource,
}: {
  kind: SourceReviewKind;
  patientName: string;
  patientId: string;
  documentId: string;
  snapshot: SavedExtraction;
  draft: SourceDraftRef;
  onDenied: () => void;
  onReloadSource: () => void;
  onShowSource: (v: { page: number; excerpt: string }) => void;
}) {
  const { state, saveState, reload, save } = useSourceReview(
    kind,
    patientId,
    documentId,
    snapshot,
    onDenied,
    draft,
  );
  const [notice, setNotice] = useState('');
  const [opened, setOpened] = useState(false);
  const status = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (notice) status.current?.focus();
  }, [notice]);
  const Candidates =
    kind === 'diagnosis' ? DiagnosisCandidates : MedicationCandidates;
  return (
    <div className="min-w-0 space-y-2">
      {notice && (
        <p
          ref={status}
          tabIndex={-1}
          role="status"
          className="text-pretty text-sm text-muted-foreground"
        >
          {notice}
        </p>
      )}
      {typeof state === 'object' && saveState !== 'conflict' ? (
        <Review
          kind={kind}
          key={sourceDraftKey(patientId, documentId, state, kind)}
          contextKey={sourceDraftKey(patientId, documentId, state, kind)}
          data={state}
          patientName={patientName}
          opened={opened}
          onOpenChange={setOpened}
          snapshot={snapshot}
          draft={draft}
          saveState={saveState}
          onSave={(body, operation) => {
            setNotice('');
            void save(body, operation).then((ok) => {
              if (ok) {
                setNotice(
                  operation === 'confirmation'
                    ? kind === 'diagnosis'
                      ? 'Source statements confirmed. Their wording is preserved; no current patient diagnosis was assigned. Selections have been reset.'
                      : 'Prescription source fields confirmed. Their wording is preserved; no active regimen or schedule was created. Selections have been reset.'
                    : 'Source confirmations withdrawn. History is preserved. Selections have been reset.',
                );
                reload();
              }
            });
          }}
          onReload={reload}
          onDenied={onDenied}
          onReloadSource={onReloadSource}
          onShowSource={onShowSource}
          patientId={patientId}
          documentId={documentId}
        />
      ) : (
        <Candidates
          snapshot={snapshot}
          onShowSource={onShowSource}
          review={
            <p className="break-words text-sm font-semibold">
              Patient: {patientName}
            </p>
          }
          open={opened}
          onOpenChange={setOpened}
        >
          {state === 'loading' ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading source confirmations…
            </p>
          ) : state === 'conflict' || saveState === 'conflict' ? (
            <>
              <p role="status" className="text-sm text-muted-foreground">
                The saved source or confirmation changed. Reload saved text
                before confirming.
              </p>
              <Button variant="secondary" onClick={onReloadSource}>
                Reload saved text
              </Button>
            </>
          ) : (
            <>
              <p role="status" className="text-sm text-muted-foreground">
                Source confirmations could not be loaded. The original and
                unverified text remain available.
              </p>
              <Button variant="secondary" onClick={reload}>
                Retry source confirmations
              </Button>
            </>
          )}
        </Candidates>
      )}
    </div>
  );
}
