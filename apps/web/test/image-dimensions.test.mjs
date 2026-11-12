import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/features/documents/imageDimensions.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { imageDimensions, ImageDimensionError } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);
function error(bytes, mime, reason) {
  assert.throws(
    () => imageDimensions(bytes, mime),
    (e) => e instanceof ImageDimensionError && e.reason === reason,
  );
}
function chunk(type, data) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  result.write(type, 4);
  data.copy(result, 8);
  return result;
}
function png(width = 100, height = 200, extra = []) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    ...extra,
    chunk('IDAT', Buffer.from([0])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function segment(marker, data) {
  const result = Buffer.alloc(data.length + 4);
  result[0] = 255;
  result[1] = marker;
  result.writeUInt16BE(data.length + 2, 2);
  data.copy(result, 4);
  return result;
}
function jpeg(width = 640, height = 480, extra = []) {
  const sof = Buffer.from([
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    1,
    1,
    0x11,
    0,
  ]);
  return Buffer.concat([
    Buffer.from([255, 216]),
    segment(0xc0, sof),
    segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.from([1, 255, 0, 3, 255, 208, 4]),
    ...extra,
    Buffer.from([255, 217]),
  ]);
}
function webpChunk(type, data) {
  const result = Buffer.alloc(8 + data.length + (data.length & 1));
  result.write(type);
  result.writeUInt32LE(data.length, 4);
  data.copy(result, 8);
  return result;
}
function webp(chunks) {
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8);
  return Buffer.concat([head, body]);
}
function vp8(width = 100, height = 200) {
  const data = Buffer.from([0, 0, 0, 157, 1, 42, 0, 0, 0, 0]);
  data.writeUInt16LE(width, 6);
  data.writeUInt16LE(height, 8);
  return webpChunk('VP8 ', data);
}
function vp8l(width = 100, height = 200) {
  const data = Buffer.alloc(5);
  data[0] = 47;
  data.writeUInt32LE(width - 1 + (height - 1) * 16384, 1);
  return webpChunk('VP8L', data);
}
function vp8x(width = 100, height = 200, flags = 0) {
  const data = Buffer.alloc(10);
  data[0] = flags;
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  return webpChunk('VP8X', data);
}

test('PNG dimensions are validated before any decoding', () => {
  assert.deepEqual(imageDimensions(png(), 'image/png'), {
    width: 100,
    height: 200,
  });
  error(png(0), 'image/png', 'dimensions');
  error(png(8193, 1), 'image/png', 'dimensions');
  error(png(4001, 4000), 'image/png', 'dimensions');
  assert.deepEqual(imageDimensions(png(4000, 4000), 'image/png'), {
    width: 4000,
    height: 4000,
  });
});
test('PNG rejects animation, missing/truncated/repeated chunks and trailing content', () => {
  error(
    png(1, 1, [chunk('acTL', Buffer.alloc(8))]),
    'image/png',
    'unsupported',
  );
  error(png().subarray(0, 32), 'image/png', 'invalid');
  error(Buffer.concat([png(), Buffer.from([0])]), 'image/png', 'invalid');
  error(png(1, 1, [chunk('IHDR', Buffer.alloc(13))]), 'image/png', 'invalid');
  const malformed = png();
  malformed.writeUInt32BE(0xffffffff, 33);
  error(malformed, 'image/png', 'invalid');
});
test('JPEG handles entropy stuffing/restart markers and bounded dimensions', () => {
  assert.deepEqual(imageDimensions(jpeg(), 'image/jpeg'), {
    width: 640,
    height: 480,
  });
  error(jpeg(8193, 1), 'image/jpeg', 'dimensions');
  error(jpeg(5000, 4000), 'image/jpeg', 'dimensions');
  error(jpeg(0, 1), 'image/jpeg', 'dimensions');
});
test('JPEG rejects compound frame allocation changes, truncation, unsupported frame and DNL', () => {
  const frame = segment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 17, 0]));
  error(jpeg(640, 480, [frame]), 'image/jpeg', 'invalid');
  error(jpeg().subarray(0, -1), 'image/jpeg', 'invalid');
  error(
    jpeg(640, 480, [segment(0xdc, Buffer.from([0, 1]))]),
    'image/jpeg',
    'unsupported',
  );
  const unsupported = jpeg();
  unsupported[3] = 0xc3;
  error(unsupported, 'image/jpeg', 'unsupported');
  const broken = jpeg();
  broken.writeUInt16BE(65535, 4);
  error(broken, 'image/jpeg', 'invalid');
});
test('WebP lossy/lossless/extended dimensions agree', () => {
  for (const chunks of [[vp8()], [vp8l()], [vp8x(), vp8()], [vp8x(), vp8l()]])
    assert.deepEqual(imageDimensions(webp(chunks), 'image/webp'), {
      width: 100,
      height: 200,
    });
});
test('WebP rejects animation, mismatched canvas/frame, duplicates and truncated RIFF chunks', () => {
  error(webp([vp8x(100, 200, 2), vp8()]), 'image/webp', 'unsupported');
  error(
    webp([vp8(), webpChunk('ANIM', Buffer.alloc(6))]),
    'image/webp',
    'unsupported',
  );
  error(webp([vp8x(1, 1), vp8()]), 'image/webp', 'invalid');
  error(webp([vp8(), vp8()]), 'image/webp', 'invalid');
  error(webp([vp8()]).subarray(0, -1), 'image/webp', 'invalid');
  const wrong = webp([vp8()]);
  wrong.writeUInt32LE(0xffffffff, 16);
  error(wrong, 'image/webp', 'invalid');
  error(webp([vp8l(8193, 1)]), 'image/webp', 'dimensions');
});
test('MIME and signature mismatch cannot request another decoder', () => {
  error(png(), 'image/jpeg', 'invalid');
  error(jpeg(), 'image/webp', 'invalid');
  error(webp([vp8()]), 'image/png', 'invalid');
  error(png(), 'image/gif', 'unsupported');
  for (const mime of ['image/png', 'image/jpeg', 'image/webp'])
    for (let length = 0; length < 20; length++)
      error(new Uint8Array(length), mime, 'invalid');
});
test('Uint8Array slices respect byteOffset and do not inspect surrounding bytes', () => {
  const original = png();
  const padded = Buffer.concat([Buffer.alloc(17), original, Buffer.alloc(19)]);
  assert.deepEqual(
    imageDimensions(
      new Uint8Array(padded.buffer, padded.byteOffset + 17, original.length),
      'image/png',
    ),
    { width: 100, height: 200 },
  );
});
