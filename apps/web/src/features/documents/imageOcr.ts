import { ocrByteLimit } from './ocrTypes';
import type { OcrState, OcrProgress } from './ocrTypes';

let running = false;
export async function recognizeImage(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  signal: AbortSignal,
  progress: OcrProgress,
): Promise<OcrState> {
  if (running) return { kind: 'failed', reason: 'unavailable' };
  if (bytes.byteLength > ocrByteLimit)
    return { kind: 'failed', reason: 'size' };
  signal.throwIfAborted();
  running = true;
  let worker: Worker | undefined;
  let rejectCurrent: ((reason: unknown) => void) | undefined;
  const cancel = () => {
    worker?.terminate();
    rejectCurrent?.(signal.reason ?? new Error('Cancelled'));
  };
  signal.addEventListener('abort', cancel, { once: true });
  const wait = <T>(
    send: () => void,
    receive: (packet: unknown) => T | undefined,
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      signal.throwIfAborted();
      rejectCurrent = reject;
      worker!.onerror = (event) => {
        event.preventDefault();
        reject(new Error('OCR unavailable'));
      };
      worker!.onmessageerror = () => reject(new Error('OCR unavailable'));
      worker!.onmessage = ({ data }: MessageEvent<unknown>) => {
        try {
          const result = receive(data);
          if (result !== undefined) resolve(result);
        } catch {
          reject(new Error('OCR unavailable'));
        }
      };
      send();
    });
  try {
    progress('preparing', 0);
    worker = new Worker(new URL('./ocrRaster.worker.ts', import.meta.url), {
      type: 'module',
    });
    const raster = await wait<{
      bytes?: ArrayBuffer;
      downsized?: boolean;
      error?: string;
    }>(
      () => worker!.postMessage({ bytes, mime }, [bytes.buffer]),
      (packet) =>
        packet as { bytes?: ArrayBuffer; downsized?: boolean; error?: string },
    );
    worker.terminate();
    worker = undefined;
    signal.throwIfAborted();
    if (raster.error || !(raster.bytes instanceof ArrayBuffer))
      return {
        kind: 'failed',
        reason:
          raster.error === 'dimensions'
            ? 'dimensions'
            : raster.error === 'unsupported'
              ? 'unsupported'
              : 'invalid',
      };
    progress('loading', 0);
    // Own the worker before initialization starts. This is the exact pinned
    // publisher message protocol used by createWorker, without its hidden worker.
    worker = new Worker(
      new URL(
        `${import.meta.env.BASE_URL}ocr-assets/v7/worker.js`,
        window.location.href,
      ),
    );
    let serial = 0;
    const job = async (
      action: string,
      payload: object,
    ): Promise<{ text?: string; partial?: boolean }> => {
      const jobId = `job-${++serial}`;
      return wait(
        () =>
          worker!.postMessage({
            workerId: 'local-ocr',
            jobId,
            action,
            payload,
          }),
        (packet) => {
          const result = packet as {
            jobId?: string;
            status?: string;
            data?: { progress?: number; text?: string; partial?: boolean };
          };
          if (result.status === 'fatal') throw new Error('OCR unavailable');
          if (result.jobId !== jobId) return;
          if (result.status === 'progress') {
            progress(
              action === 'recognize' ? 'recognizing' : 'loading',
              typeof result.data?.progress === 'number'
                ? result.data.progress
                : 0,
            );
            return;
          }
          if (result.status === 'reject') throw new Error('OCR unavailable');
          if (result.status === 'resolve') return result.data ?? {};
        },
      );
    };
    const root = new URL(
      `${import.meta.env.BASE_URL}ocr-assets/v7/`,
      window.location.href,
    ).href;
    await job('load', {
      options: { lstmOnly: true, corePath: `${root}core`, logging: false },
    });
    await job('loadLanguage', {
      langs: 'eng',
      options: {
        langPath: `${root}lang`,
        cacheMethod: 'none',
        gzip: true,
        lstmOnly: true,
      },
    });
    await job('initialize', { langs: 'eng', oem: 1, config: {} });
    signal.throwIfAborted();
    progress('recognizing', 0);
    const result = await job('recognize', {
      image: new Uint8Array(raster.bytes),
      options: {},
      output: { text: true },
    });
    signal.throwIfAborted();
    if (typeof result.text !== 'string') throw new Error('OCR unavailable');
    const text = result.text.slice(0, 100000).trim();
    return text
      ? {
          kind: 'ready',
          text,
          partial: result.partial === true || result.text.length > 100000,
          downsized: raster.downsized === true,
        }
      : { kind: 'empty', downsized: raster.downsized === true };
  } catch {
    if (signal.aborted) throw signal.reason;
    return { kind: 'failed', reason: 'unavailable' };
  } finally {
    worker?.terminate();
    signal.removeEventListener('abort', cancel);
    rejectCurrent = undefined;
    running = false;
  }
}
