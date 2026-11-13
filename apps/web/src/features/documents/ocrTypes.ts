export const ocrByteLimit = 10 * 1024 * 1024;
export type OcrState =
  | { kind: 'idle' }
  | {
      kind: 'loading';
      stage: 'loading' | 'preparing' | 'recognizing';
      progress: number;
    }
  | { kind: 'ready'; text: string; partial: boolean; downsized: boolean }
  | { kind: 'empty'; downsized: boolean }
  | {
      kind: 'failed';
      reason:
        | 'size'
        | 'dimensions'
        | 'invalid'
        | 'unsupported'
        | 'timeout'
        | 'pages'
        | 'page'
        | 'encrypted'
        | 'unavailable';
    };
export type OcrProgress = (
  stage: 'loading' | 'preparing' | 'recognizing',
  progress: number,
) => void;
