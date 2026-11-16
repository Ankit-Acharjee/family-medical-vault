export const rangeResult = (changes = {}) => ({
  method: 'pdf-pages-ocr',
  engineVersion: 'pdfjs-6.5.438+tesseract-7.0.0+eng-1.0.0',
  pages: [
    { page: 7, text: 'SYNTHETIC first page' },
    { page: 8, text: 'SYNTHETIC second page' },
  ],
  partial: true,
  partialReason: 'selected-pages',
  downsized: false,
  ...changes,
});
export function rangeVectors() {
  const cases = [
    ['contiguous selected range', {}, true],
    [
      'one returned page after truncation',
      {
        pages: [{ page: 50, text: 'SYNTHETIC prefix' }],
        partialReason: 'characters',
      },
      true,
    ],
    [
      'one-page provenance remains representable',
      { pages: [{ page: 1, text: 'SYNTHETIC' }] },
      true,
    ],
    [
      'five pages ending at page 50',
      {
        pages: Array.from({ length: 5 }, (_, i) => ({
          page: 46 + i,
          text: 'SYNTHETIC',
        })),
      },
      true,
    ],
    [
      'completed blank pages retain position',
      {
        pages: [
          { page: 7, text: '' },
          { page: 8, text: 'SYNTHETIC' },
          { page: 9, text: ' \n' },
        ],
      },
      true,
    ],
    ['downsized range', { downsized: true }, true],
    [
      'aggregate UTF-16 boundary',
      {
        pages: [
          { page: 7, text: '😀'.repeat(25000) },
          { page: 8, text: 'x'.repeat(50000) },
        ],
        partialReason: 'characters',
      },
      true,
    ],
    [
      'aggregate UTF-16 overflow',
      {
        pages: [
          { page: 7, text: '😀'.repeat(25000) },
          { page: 8, text: 'x'.repeat(50001) },
        ],
      },
      false,
    ],
    [
      'six-page range',
      {
        pages: Array.from({ length: 6 }, (_, i) => ({
          page: 1 + i,
          text: 'SYNTHETIC',
        })),
      },
      false,
    ],
    ['no pages', { pages: [] }, false],
    [
      'ECMAScript whitespace only',
      { pages: [{ page: 7, text: '\u00a0\ufeff\u2028' }] },
      false,
    ],
    ['null page', { pages: [null] }, false],
    ['scalar page', { pages: [7] }, false],
    [
      'all blank pages',
      {
        pages: [
          { page: 7, text: '' },
          { page: 8, text: '\t \n' },
        ],
      },
      false,
    ],
    [
      'gap',
      {
        pages: [
          { page: 7, text: 'SYNTHETIC' },
          { page: 9, text: 'SYNTHETIC' },
        ],
      },
      false,
    ],
    [
      'duplicate',
      {
        pages: [
          { page: 7, text: 'SYNTHETIC' },
          { page: 7, text: 'SYNTHETIC' },
        ],
      },
      false,
    ],
    [
      'reverse',
      {
        pages: [
          { page: 8, text: 'SYNTHETIC' },
          { page: 7, text: 'SYNTHETIC' },
        ],
      },
      false,
    ],
    ['page zero', { pages: [{ page: 0, text: 'SYNTHETIC' }] }, false],
    [
      'page 51',
      {
        pages: [
          { page: 50, text: 'SYNTHETIC' },
          { page: 51, text: 'SYNTHETIC' },
        ],
      },
      false,
    ],
    ['fractional page', { pages: [{ page: 1.5, text: 'SYNTHETIC' }] }, false],
    ['string page', { pages: [{ page: '1', text: 'SYNTHETIC' }] }, false],
    [
      'extra page provenance',
      { pages: [{ page: 7, text: 'SYNTHETIC', verified: true }] },
      false,
    ],
    ['null text', { pages: [{ page: 7, text: null }] }, false],
    ['unknown engine', { engineVersion: 'unknown' }, false],
    ['not partial', { partial: false, partialReason: null }, false],
    ['null partial reason', { partialReason: null }, false],
    ['legacy single-page reason', { partialReason: 'selected-page' }, false],
    ['PDF-text page limit reason', { partialReason: 'pages' }, false],
    ['cancelled reason is not savable', { partialReason: 'cancelled' }, false],
    ['timeout reason is not savable', { partialReason: 'timeout' }, false],
    ['string partial', { partial: 'true' }, false],
    ['string downsized', { downsized: 'false' }, false],
    ['extra authority', { verified: true }, false],
    [
      'legacy single-page method stays single-page',
      { method: 'pdf-page-ocr', partialReason: 'selected-page' },
      false,
    ],
  ];
  return cases.map(([name, changes, valid]) => ({
    name,
    result: rangeResult(changes),
    valid,
  }));
}
