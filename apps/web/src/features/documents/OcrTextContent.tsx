import { Button } from '../../components/ui/button';
import { PdfTextContent } from './PdfTextContent';
import type { OcrState } from './ocrTypes';
import type { PdfOcrRangeResult } from './pdfOcrTypes';
import { ExtractedTextResult } from './ExtractedTextResult';

type OcrTextContentProps = {
  state: OcrState | PdfOcrRangeResult;
  rangeProgress?: { page: number; count: number; completed: number } | null;
  enabled: boolean;
  onStart: () => void;
  onCancel: () => void;
  page?: number;
};

type FailedOcrState = Extract<OcrState, { kind: 'failed' }>;
type LoadingStage = Extract<OcrState, { kind: 'loading' }>['stage'];

const FAILED_COPY: Record<FailedOcrState['reason'], string> = {
  size: 'The source is larger than 10 MiB, so recognition was not started.',
  dimensions:
    'The source exceeds 16 megapixels or 8192 px on its longest side.',
  invalid: 'The source could not be read as a valid file.',
  unsupported: 'This source type is not supported for recognition.',
  timeout: 'OCR timed out after 60 seconds and was stopped.',
  unavailable: 'Recognition is temporarily unavailable.',
  pages: 'This PDF exceeds the 50-page limit. Try a shorter document.',
  page: 'The selected page is outside this document’s page range.',
  encrypted: 'Password-protected PDFs are not supported for recognition.',
};

const STAGE_COPY: Record<LoadingStage, string> = {
  loading: 'Loading the source for recognition…',
  preparing: 'Preparing the source for recognition…',
  recognizing: 'Recognizing text…',
};

export function OcrTextContent({
  state,
  enabled,
  onStart,
  onCancel,
  page = 1,
  rangeProgress,
}: OcrTextContentProps) {
  switch (state.kind) {
    case 'idle':
      return (
        <div className="min-w-0 space-y-3 text-sm text-muted-foreground">
          <p>
            Recognizes printed English text only. The original file is not
            changed and recognition runs locally on this device. Results are
            unverified and are not diagnoses or structured clinical data. OCR
            may be inaccurate, especially for handwriting or languages other
            than English.
          </p>
          <div>
            <Button onClick={onStart} disabled={!enabled}>
              Start OCR
            </Button>
          </div>
        </div>
      );
    case 'loading': {
      const progress = Math.min(1, Math.max(0, state.progress));
      return (
        <div className="min-w-0 space-y-3 text-sm text-muted-foreground">
          <p role="status">
            {rangeProgress
              ? `PDF page ${rangeProgress.page}. ${rangeProgress.completed} of ${rangeProgress.count} selected pages completed. `
              : ''}
            {STAGE_COPY[state.stage]}
          </p>
          {!rangeProgress && (
            <progress max={1} value={progress} aria-label="OCR progress" />
          )}
          <div>
            <Button variant="secondary" onClick={onCancel}>
              Cancel OCR
            </Button>
          </div>
        </div>
      );
    }
    case 'failed':
      return (
        <div className="min-w-0 space-y-3 text-sm text-muted-foreground">
          <p role="status">
            Text recognition did not complete. {FAILED_COPY[state.reason]}
          </p>
          <div>
            <Button onClick={onStart} disabled={!enabled}>
              Retry OCR
            </Button>
          </div>
        </div>
      );
    case 'empty':
      return (
        <div className="min-w-0 space-y-3 text-sm text-muted-foreground">
          <p role="status">
            No text was recognized. The original file is unchanged.
          </p>
          {state.downsized && (
            <p>The image was downsized before recognition.</p>
          )}
          <div>
            <Button onClick={onStart} disabled={!enabled}>
              Retry OCR
            </Button>
          </div>
        </div>
      );
    case 'ready':
      if ('pages' in state)
        return (
          <div className="min-w-0 space-y-3 text-sm text-muted-foreground">
            <p role="status">
              Unverified output from the selected pages. Not medical advice.
            </p>
            <ExtractedTextResult
              pages={state.pages}
              emptyPageText="No text was recognized on this page."
            />
            <p>
              {state.partialReason === 'characters'
                ? 'Recognition stopped at the character limit. The final line may be incomplete.'
                : 'Only the selected page range was recognized.'}
            </p>
            <p>
              {state.downsized
                ? 'The source was downsized before recognition. '
                : ''}
              Only printed English text is recognized; handwriting and other
              languages may be missed or inaccurate.
            </p>
          </div>
        );
      return (
        <div className="min-w-0 space-y-3 text-sm text-muted-foreground">
          <PdfTextContent
            emptyPageText="No text was recognized on this page."
            state={{
              kind: 'ready',
              pages: [{ page, text: state.text }],
              partial: state.partial,
              ...(state.partial ? { reason: 'characters' as const } : {}),
            }}
            onRetry={onStart}
            onCancel={onCancel}
          />
          <p className="bg-muted rounded-xl p-3">
            {state.downsized
              ? 'The source was downsized before recognition. '
              : ''}
            Only printed English text is recognized; handwriting and other
            languages may be missed or inaccurate.
          </p>
        </div>
      );
  }
}
