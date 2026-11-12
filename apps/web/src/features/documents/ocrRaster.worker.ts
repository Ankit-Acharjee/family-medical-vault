import { imageDimensions, ImageDimensionError } from './imageDimensions';

globalThis.onmessage = async (
  event: MessageEvent<{ bytes: Uint8Array<ArrayBuffer>; mime: string }>,
) => {
  let bitmap: ImageBitmap | undefined;
  let canvas: OffscreenCanvas | undefined;
  try {
    if (
      typeof createImageBitmap !== 'function' ||
      typeof OffscreenCanvas !== 'function'
    ) {
      globalThis.postMessage({ error: 'unsupported' });
      return;
    }
    const { bytes, mime } = event.data;
    const { width, height } = imageDimensions(bytes, mime);
    const ratio = Math.min(
      1,
      2000 / width,
      2000 / height,
      Math.sqrt(2_000_000 / (width * height)),
    );
    const targetWidth = Math.max(1, Math.floor(width * ratio));
    const targetHeight = Math.max(1, Math.floor(height * ratio));
    bitmap = await createImageBitmap(new Blob([bytes], { type: mime }), {
      resizeWidth: targetWidth,
      resizeHeight: targetHeight,
      resizeQuality: 'high',
      imageOrientation: 'none',
    });
    if (bitmap.width !== targetWidth || bitmap.height !== targetHeight)
      throw new Error('Unsupported image');
    canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unsupported image');
    context.fillStyle = 'white';
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    bitmap = undefined;
    // Canonical bounded PNG bytes avoid vendor URL/image loaders and EXIF paths.
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const data = await blob.arrayBuffer();
    globalThis.postMessage(
      { bytes: data, downsized: ratio < 1 },
      { transfer: [data] },
    );
  } catch (error) {
    globalThis.postMessage({
      error: error instanceof ImageDimensionError ? error.reason : 'invalid',
    });
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
};
