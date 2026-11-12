/** Header/structure gate only; the browser decoder still validates image data.
 * No pixel allocation or decompression occurs here. Limits precede decoding.
 */
export class ImageDimensionError extends Error {
  constructor(readonly reason: 'invalid' | 'dimensions' | 'unsupported') {
    super('Image cannot be prepared for OCR');
    this.name = 'ImageDimensionError';
  }
}

type Dimensions = { width: number; height: number };
const invalid = (): never => {
  throw new ImageDimensionError('invalid');
};
const unsupported = (): never => {
  throw new ImageDimensionError('unsupported');
};
function bounded(width: number, height: number): Dimensions {
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > 16_000_000
  )
    throw new ImageDimensionError('dimensions');
  return { width, height };
}
const same = (a: Dimensions, b: Dimensions) =>
  a.width === b.width && a.height === b.height;

export function imageDimensions(data: Uint8Array, mime: string): Dimensions {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fits = (offset: number, count: number) =>
    offset >= 0 && count >= 0 && offset + count <= data.length;
  const str = (offset: number, length: number) => {
    if (!fits(offset, length)) return invalid();
    return String.fromCharCode(...data.subarray(offset, offset + length));
  };
  const u16 = (offset: number, little = false) => {
    if (!fits(offset, 2)) return invalid();
    return view.getUint16(offset, little);
  };
  const u32 = (offset: number, little = false) => {
    if (!fits(offset, 4)) return invalid();
    return view.getUint32(offset, little);
  };
  if (mime === 'image/png') {
    if (data.length < 8 || data[0] !== 137 || str(1, 7) !== 'PNG\r\n\x1a\n')
      return invalid();
    let dimensions: Dimensions | undefined;
    let pixels = false;
    for (let offset = 8; offset < data.length;) {
      if (!fits(offset, 12)) return invalid();
      const length = u32(offset);
      if (!fits(offset + 8, length + 4)) return invalid();
      const type = str(offset + 4, 4);
      if (offset === 8 && type !== 'IHDR') return invalid();
      if (type === 'acTL' || type === 'fcTL' || type === 'fdAT')
        return unsupported();
      if (type === 'IHDR') {
        if (dimensions || offset !== 8 || length !== 13) return invalid();
        dimensions = bounded(u32(offset + 8), u32(offset + 12));
        const depth = data[offset + 16]!;
        const color = data[offset + 17]!;
        const allowed: Record<number, number[]> = {
          0: [1, 2, 4, 8, 16],
          2: [8, 16],
          3: [1, 2, 4, 8],
          4: [8, 16],
          6: [8, 16],
        };
        if (
          !allowed[color]?.includes(depth) ||
          data[offset + 18] !== 0 ||
          data[offset + 19] !== 0 ||
          data[offset + 20]! > 1
        )
          return invalid();
      } else if (type === 'IDAT') {
        if (!dimensions) return invalid();
        pixels = true;
      } else if (type === 'IEND') {
        if (
          length !== 0 ||
          !dimensions ||
          !pixels ||
          offset + 12 !== data.length
        )
          return invalid();
        return dimensions;
      }
      offset += length + 12;
    }
    return invalid();
  }
  if (mime === 'image/jpeg') {
    if (data.length < 4 || u16(0) !== 0xffd8) return invalid();
    let dimensions: Dimensions | undefined;
    let offset = 2;
    let entropy = false;
    let scanned = false;
    let components = 0;
    while (offset < data.length) {
      if (entropy) {
        while (offset < data.length && data[offset] !== 0xff) offset++;
        if (offset === data.length) return invalid();
      } else if (data[offset] !== 0xff) return invalid();
      while (data[offset] === 0xff) offset++;
      if (offset === data.length) return invalid();
      const marker = data[offset++]!;
      if (entropy && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7)))
        continue;
      entropy = false;
      if (marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7))
        return invalid();
      if (marker === 0xd9) {
        if (!dimensions || !scanned || offset !== data.length) return invalid();
        return dimensions;
      }
      if (marker === 1) continue; // TEM has no length.
      const length = u16(offset);
      if (length < 2 || !fits(offset, length)) return invalid();
      const frame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker);
      if (frame) {
        if (![0xc0, 0xc1, 0xc2].includes(marker)) return unsupported();
        if (dimensions || length < 11) return invalid();
        if (data[offset + 2] !== 8) return unsupported();
        components = data[offset + 7]!;
        if (![1, 3, 4].includes(components) || length !== 8 + 3 * components)
          return invalid();
        dimensions = bounded(u16(offset + 5), u16(offset + 3));
      }
      if (marker === 0xda) {
        if (!dimensions || length < 8) return invalid();
        const count = data[offset + 2]!;
        if (!count || count > components || length !== 6 + 2 * count)
          return invalid();
        scanned = true;
        entropy = true;
      }
      // A deferred height can alter allocation after SOF; do not support DNL.
      if (marker === 0xdc) return unsupported();
      offset += length;
    }
    return invalid();
  }
  if (mime === 'image/webp') {
    if (
      data.length < 20 ||
      str(0, 4) !== 'RIFF' ||
      str(8, 4) !== 'WEBP' ||
      u32(4, true) + 8 !== data.length
    )
      return invalid();
    let canvas: Dimensions | undefined;
    let image: Dimensions | undefined;
    let offset = 12;
    while (offset < data.length) {
      if (!fits(offset, 8)) return invalid();
      const type = str(offset, 4);
      const length = u32(offset + 4, true);
      const start = offset + 8;
      if (!fits(start, length + (length & 1))) return invalid();
      if (type === 'ANIM' || type === 'ANMF') return unsupported();
      if (type === 'VP8X') {
        if (canvas || image || offset !== 12 || length !== 10) return invalid();
        if ((data[start]! & 2) !== 0) return unsupported();
        if (
          (data[start]! & 0xc1) !== 0 ||
          data[start + 1] ||
          data[start + 2] ||
          data[start + 3]
        )
          return invalid();
        const uint24 = (at: number) =>
          data[at]! + data[at + 1]! * 256 + data[at + 2]! * 65536;
        canvas = bounded(uint24(start + 4) + 1, uint24(start + 7) + 1);
      } else if (type === 'VP8 ') {
        if (
          image ||
          length < 10 ||
          (data[start]! & 1) !== 0 ||
          str(start + 3, 3) !== '\x9d\x01\x2a'
        )
          return invalid();
        image = bounded(
          u16(start + 6, true) & 0x3fff,
          u16(start + 8, true) & 0x3fff,
        );
      } else if (type === 'VP8L') {
        if (
          image ||
          length < 5 ||
          data[start] !== 0x2f ||
          (data[start + 4]! & 0xe0) !== 0
        )
          return invalid();
        const bits = u32(start + 1, true);
        image = bounded((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      }
      if (canvas && image && !same(canvas, image)) return invalid();
      offset = start + length + (length & 1);
    }
    if (!image) return invalid();
    return image;
  }
  return unsupported();
}
