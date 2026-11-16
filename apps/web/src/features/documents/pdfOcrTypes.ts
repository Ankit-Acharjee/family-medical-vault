import type { OcrState } from './ocrTypes';

export type PdfOcrRangeResult =
  | {
      kind: 'ready';
      pages: { page: number; text: string }[];
      partialReason: 'selected-pages' | 'characters';
      downsized: boolean;
    }
  | Extract<OcrState, { kind: 'empty' | 'failed' }>;
