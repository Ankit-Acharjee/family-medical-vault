import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { URL } from 'node:url';

const source = await readFile(
  new URL('../src/features/documents/ocrEngine.bootstrap.js', import.meta.url),
  'utf8',
);
function publisher(text) {
  const packets = [];
  const sandbox = createContext({
    URL,
    location: { href: 'http://127.0.0.1/ocr-assets/v7/worker.js' },
    fetch: () => {
      throw Error('Unexpected network');
    },
    importScripts: () => {},
    addEventListener: () => {},
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    postMessage: (packet) => packets.push(packet),
  });
  runInContext(source, sandbox);
  sandbox.postMessage({
    jobId: 'synthetic',
    action: 'recognize',
    status: 'resolve',
    data: { text },
  });
  assert.equal(packets.length, 1);
  return packets[0].data;
}
test('owned OCR publisher preserves full Unicode characters at the UTF16 budget', () => {
  for (const [text, length, partial] of [
    ['X'.repeat(100001), 100000, true],
    ['X'.repeat(99999) + '🧊', 99999, true],
    ['X'.repeat(99998) + '🧊', 100000, false],
    ['X\ud800', 1, true],
    ['literal\r\nsource', 15, false],
  ]) {
    const result = publisher(text);
    assert.equal(result.text.length, length);
    assert.equal(result.partial, partial);
    assert.equal(
      result.text.charCodeAt(result.text.length - 1) >= 0xd800 &&
        result.text.charCodeAt(result.text.length - 1) <= 0xdbff,
      false,
    );
    assert.equal(result.text, text.slice(0, length));
  }
});
