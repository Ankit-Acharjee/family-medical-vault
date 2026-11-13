import { mockExtractionContext } from './support/extraction-context';
import { deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// AI-01/05/06, DOC-02, SEC-02/05: synthetic scanned pages and mocked access.
// Image XObjects contain the only page content: there are no PDF text operators.
const firstText = 'SCANNED PAGE ONE';
const secondText = 'SCANNED PAGE TWO';
const sourceTitle = 'Synthetic scanned pages.pdf';
const patient = {
  id: 'pdf-ocr-a',
  displayName: 'PDF OCR Fixture Patient',
  relationship: 'self',
  capabilities: ['view', 'export', 'edit'].map((action) => ({
    action,
    scope: { kind: 'patient' },
  })),
};
const other = { ...patient, id: 'pdf-ocr-b', displayName: 'Other PDF Patient' };
const document = {
  id: 'synthetic-scanned-pdf',
  patientId: patient.id,
  title: sourceTitle,
  originalTitle: 'synthetic-scanned-pages.pdf',
  categoryId: 'general',
  categoryName: 'Unclassified',
  createdAt: '2026-11-12T12:00:00Z',
  canEdit: true,
  canView: true,
  canExport: true,
  mimeType: 'application/pdf',
};
const action = (page: Page) =>
  page.getByRole('button', {
    name: `Recognize text (OCR) ${sourceTitle}`,
    exact: true,
  });
const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Recognized text (OCR)', exact: true });
const ownedWorkers = (page: Page) =>
  page
    .workers()
    .filter((worker) =>
      /pdf\.(?:worker|renderer)|pdfOcr\.worker|ocrRaster\.worker|ocr-assets\/v7\/worker\.js/.test(
        worker.url(),
      ),
    );

async function scannedPdf(
  page: Page,
  texts = [firstText, secondText],
  options: {
    encrypted?: boolean;
    mediaScale?: number;
    oversizedImage?: boolean;
    missingImageDimensions?: boolean;
    invalidImage?: boolean;
  } = {},
) {
  const unique = [...new Set(texts)];
  const rasters: Buffer[] = [];
  for (const text of unique) {
    if (options.invalidImage) {
      rasters.push(Buffer.from('synthetic invalid JPX image'));
      continue;
    }
    if (options.oversizedImage) {
      rasters.push(deflateSync(Buffer.alloc(4001 * 4001, 255)));
      continue;
    }
    const pixels = await page.evaluate((text) => {
      const canvas = window.document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 300;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#000';
      context.font = 'bold 64px Arial';
      context.fillText(text, 50, 170);
      const rgba = context.getImageData(0, 0, 1200, 300).data;
      let gray = '';
      for (let index = 0; index < rgba.length; index += 4)
        gray += String.fromCharCode(rgba[index]!);
      return btoa(gray);
    }, text);
    rasters.push(deflateSync(Buffer.from(pixels, 'base64')));
  }
  const firstPageId = 3 + rasters.length;
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from(
      `<< /Type /Pages /Count ${texts.length} /Kids [${texts.map((_, index) => `${firstPageId + index * 2} 0 R`).join(' ')}] >>`,
    ),
    ...rasters.map((raster) =>
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${options.missingImageDimensions ? 0 : options.oversizedImage ? 4001 : options.invalidImage ? 100 : 1200} /Height ${options.oversizedImage ? 4001 : options.invalidImage ? 100 : 300} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /${options.invalidImage ? 'JPXDecode' : 'FlateDecode'} /Length ${raster.length} >>\nstream\n`,
        ),
        raster,
        Buffer.from('\nendstream'),
      ]),
    ),
  ];
  const width = 1200 * (options.mediaScale ?? 1);
  const height = 300 * (options.mediaScale ?? 1);
  texts.forEach((text, index) => {
    const pageId = firstPageId + index * 2;
    const imageId = 3 + unique.indexOf(text);
    const stream = `q ${width} 0 0 ${height} 0 0 cm /Scan Do Q`;
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Scan ${imageId} 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
      ),
      Buffer.from(
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
      ),
    );
  });
  // This synthetic security dictionary exercises the password gate only.
  if (options.encrypted)
    objects.push(
      Buffer.from(
        `<< /Filter /Standard /V 1 /R 2 /P -4 /O <${'01'.repeat(32)}> /U <${'02'.repeat(32)}> >>`,
      ),
    );
  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  let length = chunks[0]!.length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(chunk);
    length += chunk.length;
  });
  const security = options.encrypted
    ? ` /Encrypt ${objects.length} 0 R /ID [<${'03'.repeat(16)}> <${'03'.repeat(16)}>]`
    : '';
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${security} >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}

async function setup(
  page: Page,
  options: { source?: Buffer; canView?: boolean; bytes?: number } = {},
) {
  const source = options.source ?? (await scannedPdf(page));
  let records = [
    {
      ...document,
      canView: options.canView ?? true,
      bytes: options.bytes ?? source.length,
    },
  ];
  let patients = [patient, other];
  let status = 200;
  let gate: Promise<void> | undefined;
  let release: (() => void) | undefined;
  let patientGate: Promise<void> | undefined;
  let releasePatients: (() => void) | undefined;
  const reads: string[] = [];
  const external: string[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  page.on('console', (message) => logs.push(message.text()));
  page.on('pageerror', (error) => errors.push(error.name));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      /^https?:$/.test(url.protocol) &&
      !['127.0.0.1', 'localhost'].includes(url.hostname)
    )
      external.push(url.href);
  });
  await mockExtractionContext(page);
  await page.route('**/api/auth/bootstrap', (route) =>
    route.fulfill({ json: { enabled: true, csrf: 'c'.repeat(43) } }),
  );
  await page.route('**/api/auth/account', (route) =>
    route.fulfill({
      json: { email: 'fixture@example.test', contextId: 'pdf-ocr-session' },
    }),
  );
  await page.route('**/api/patients', async (route) => {
    if (patientGate) await patientGate;
    await route.fulfill({ json: { patients } }).catch(() => {});
  });
  await page.route('**/api/patients/*/categories', (route) =>
    route.fulfill({ json: { categories: [] } }),
  );
  await page.route('**/api/patients/*/documents', (route) =>
    route.fulfill({
      json: {
        documents: route.request().url().includes('/pdf-ocr-a/') ? records : [],
        storageReady: true,
      },
    }),
  );
  await page.route('**/api/patients/*/documents/*/preview', async (route) => {
    reads.push(route.request().url());
    if (gate) await gate;
    await route
      .fulfill({ status, body: source, contentType: 'application/pdf' })
      .catch(() => {});
  });
  await page.goto('/#documents');
  await page.getByRole('button', { name: /Select patient:/ }).click();
  await page
    .getByRole('button', { name: `${patient.displayName} (Your profile)` })
    .click();
  await expect(
    page.getByRole('button', { name: 'Active documents', exact: true }),
  ).toBeVisible();
  return {
    reads,
    external,
    logs,
    errors,
    hold: () => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release: () => {
      gate = undefined;
      release?.();
    },
    holdPatients: () => {
      patientGate = new Promise<void>((resolve) => {
        releasePatients = resolve;
      });
    },
    releasePatients: () => {
      patientGate = undefined;
      releasePatients?.();
    },
    status: (value: number) => {
      status = value;
    },
    revoke: () => {
      records = records.map((record) => ({ ...record, canView: false }));
    },
    removePatient: () => {
      patients = [other];
    },
    trash: () => {
      records = [];
    },
  };
}

async function open(page: Page, selectedPage = 1) {
  await action(page).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page)
    .getByLabel('Page number', { exact: true })
    .fill(String(selectedPage));
}
async function start(page: Page, selectedPage = 1) {
  await open(page, selectedPage);
  await dialog(page)
    .getByRole('button', { name: 'Start OCR', exact: true })
    .click();
}
async function recognized(page: Page, text = firstText) {
  await expect(dialog(page)).toContainText(text, { timeout: 65_000 });
}

test('explicit selected-page OCR recognizes only scanned page two with local source binding', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const api = await setup(page);
  expect(api.reads).toEqual([]);
  await action(page).focus();
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toContainText(sourceTitle);
  await expect(dialog(page)).toContainText(/English/i);
  await expect(
    dialog(page).getByLabel('Page number', { exact: true }),
  ).toHaveValue('1');
  expect(api.reads).toEqual([]);
  await dialog(page).getByLabel('Page number', { exact: true }).fill('2');
  const began = Date.now();
  await dialog(page)
    .getByRole('button', { name: 'Start OCR', exact: true })
    .click();
  await recognized(page, secondText);
  testInfo.annotations.push({
    type: 'Selected-page OCR elapsed ms',
    description: String(Date.now() - began),
  });
  await expect(
    dialog(page).getByRole('heading', { name: 'Page 2', exact: true }),
  ).toBeVisible();
  await expect(dialog(page)).not.toContainText(firstText);
  await expect(
    dialog(page).getByRole('heading', { name: 'Page 1', exact: true }),
  ).toHaveCount(0);
  await expect(dialog(page)).toContainText(/unverified/i);
  expect(api.external).toEqual([]);
  expect(api.errors).toEqual([]);
  expect(api.logs.join('\n')).not.toContain(secondText);
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    ),
  ).not.toContain(secondText);
  const databases = await page.evaluate(async () =>
    typeof indexedDB.databases === 'function'
      ? (await indexedDB.databases()).map((database) => database.name)
      : [],
  );
  expect(
    databases.filter((name) => /tesseract|keyval/i.test(name ?? '')),
  ).toEqual([]);
  const readsBeforePageChange = api.reads.length;
  await dialog(page).getByLabel('Page number', { exact: true }).fill('1');
  await expect(dialog(page)).not.toContainText(secondText);
  await expect(
    dialog(page).getByRole('button', { name: 'Start OCR', exact: true }),
  ).toBeEnabled();
  expect(api.reads).toHaveLength(readsBeforePageChange);
  await dialog(page)
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  await expect(action(page)).toBeFocused();
  for (const prefix of ['Preview', 'Download', 'Extract text'])
    await expect(
      page.getByRole('button', {
        name: `${prefix} ${sourceTitle}`,
        exact: true,
      }),
    ).toBeEnabled();
});

for (const value of ['0', '51']) {
  test(`page ${value} cannot start a selected-page attempt`, async ({
    page,
  }) => {
    const api = await setup(page);
    await open(page);
    await dialog(page).getByLabel('Page number', { exact: true }).fill(value);
    const button = dialog(page).getByRole('button', {
      name: 'Start OCR',
      exact: true,
    });
    await expect(button).toBeDisabled();
    await expect(dialog(page)).toContainText(/whole page number from 1 to 50/i);
    await expect(dialog(page)).not.toContainText(
      /loading the source|recognizing text/i,
    );
    expect(api.reads).toEqual([]);
    await expect(
      dialog(page).getByLabel('Page number', { exact: true }),
    ).toHaveValue(value);
  });
}

test('a page beyond the original page count reports its range without starting OCR', async ({
  page,
}) => {
  await setup(page);
  let ocrWorkers = 0;
  page.on('worker', (worker) => {
    if (worker.url().includes('/ocr-assets/v7/worker.js')) ocrWorkers++;
  });
  await start(page, 3);
  await expect(dialog(page)).toContainText(
    /page.*(?:range|exist|2)|(?:range|2).*page/i,
  );
  await expect(
    dialog(page).getByRole('button', { name: 'Retry OCR', exact: true }),
  ).toBeVisible();
  expect(ocrWorkers).toBe(0);
});

for (const kind of ['corrupt', 'encrypted', 'too many pages'] as const) {
  test(`${kind} PDF remains unavailable without disabling its original`, async ({
    page,
  }) => {
    const source =
      kind === 'corrupt'
        ? Buffer.from('%PDF-1.4\nnot a valid PDF')
        : await scannedPdf(
            page,
            kind === 'too many pages'
              ? Array<string>(51).fill(firstText)
              : [firstText],
            { encrypted: kind === 'encrypted' },
          );
    await setup(page, { source });
    await start(page);
    await expect(dialog(page)).toContainText(
      kind === 'encrypted'
        ? /encrypted|password/i
        : kind === 'too many pages'
          ? /50|page.*limit/i
          : /invalid|unavailable|could not|unable|unsupported|not supported/i,
    );
    await expect(dialog(page)).not.toContainText(firstText);
    await expect(dialog(page).locator('input[type="password"]')).toHaveCount(0);
    await dialog(page)
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: `Preview ${sourceTitle}`, exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole('button', {
        name: `Download ${sourceTitle}`,
        exact: true,
      }),
    ).toBeEnabled();
  });
}

test('export-only PDF keeps download and cannot initiate either text operation', async ({
  page,
}) => {
  const api = await setup(page, { canView: false });
  await expect(action(page)).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: `Extract text ${sourceTitle}`,
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: `Download ${sourceTitle}`, exact: true }),
  ).toBeEnabled();
  expect(api.reads).toEqual([]);
});

test('current source VIEW denial closes OCR before publishing text', async ({
  page,
}) => {
  const api = await setup(page);
  api.status(403);
  await start(page);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('alert').first()).toContainText(
    /access|unavailable/i,
  );
  await expect(page.getByText(firstText, { exact: true })).toHaveCount(0);
});

for (const metadata of [true, false]) {
  test(`${metadata ? 'metadata' : 'actual'} source cap rejects PDF over 10 MiB`, async ({
    page,
  }) => {
    const api = await setup(
      page,
      metadata
        ? { bytes: 10 * 1024 * 1024 + 1 }
        : { source: Buffer.alloc(10 * 1024 * 1024 + 1, 32), bytes: 100 },
    );
    await start(page);
    await expect(dialog(page)).toContainText(/size|10 MiB|large/i);
    if (metadata) expect(api.reads).toEqual([]);
  });
}

test('cancel during source acquisition ignores late bytes and restores action focus', async ({
  page,
}) => {
  const api = await setup(page);
  api.hold();
  await start(page, 2);
  await expect.poll(() => api.reads.length).toBeGreaterThanOrEqual(1);
  await dialog(page)
    .getByRole('button', { name: 'Cancel OCR', exact: true })
    .click();
  api.release();
  await expect(dialog(page)).toHaveCount(0);
  await expect(action(page)).toBeFocused();
  await expect(page.getByText(secondText, { exact: true })).toHaveCount(0);
});

test('one 60-second deadline covers source acquisition and ignores late bytes', async ({
  page,
}) => {
  const api = await setup(page);
  api.hold();
  await page.clock.install();
  await start(page);
  await expect.poll(() => api.reads.length).toBeGreaterThanOrEqual(1);
  await page.clock.fastForward(60_001);
  await expect(dialog(page)).toContainText(/timed out|timeout/i);
  api.release();
  await expect(dialog(page)).not.toContainText(firstText);
  await expect(
    dialog(page).getByRole('button', { name: 'Retry OCR', exact: true }),
  ).toBeVisible();
});

for (const phase of ['PDF parser', 'OCR engine'] as const) {
  test(`cancel during ${phase} initialization retires the worker and permits a fresh attempt`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const api = await setup(page);
    let requests = 0;
    let hold = true;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      phase === 'PDF parser'
        ? /pdf\.worker[^/]*\.mjs(?:\?.*)?$/
        : '**/ocr-assets/v7/worker.js',
      async (route) => {
        if (
          phase === 'PDF parser' &&
          new URL(route.request().url()).searchParams.has('url')
        ) {
          await route.continue();
          return;
        }
        requests++;
        if (hold) await gate;
        await route.continue().catch(() => {});
      },
    );
    await start(page);
    await expect.poll(() => requests).toBeGreaterThanOrEqual(1);
    await dialog(page)
      .getByRole('button', { name: 'Cancel OCR', exact: true })
      .click();
    await expect(dialog(page)).toHaveCount(0);
    hold = false;
    release?.();
    await expect.poll(() => ownedWorkers(page).length).toBe(0);
    await start(page);
    await recognized(page);
    expect(api.errors).toEqual([]);
  });
}

for (const operation of ['cancel', 'VIEW revoked', 'timeout'] as const) {
  test(`${operation} during active recognition retires all owned workers and discards the page`, async ({
    page,
  }) => {
    const api = await setup(page);
    // Keep the real PDF rendering, raster worker and owned OCR bootstrap. Only
    // publisher recognition is a controlled protocol stall, with no result sent.
    // Real engine recognition is exercised by the successful selected-page tests.
    await page.route('**/ocr-assets/v7/engine.min.js', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `
          globalThis.addEventListener('message', ({data}) => {
            if (data.action === 'recognize') {
              globalThis.pdfOcrTestRecognitionStarted = true;
              globalThis.postMessage({jobId:data.jobId, action:data.action, status:'progress', data:{progress:0.5}});
              return;
            }
            globalThis.postMessage({jobId:data.jobId, action:data.action, status:'resolve', data:{}});
          });
        `,
      }),
    );
    if (operation === 'timeout') await page.clock.install();
    await start(page, 2);
    await expect(dialog(page)).toContainText('Recognizing text…');
    const engine = page
      .workers()
      .find((worker) => worker.url().includes('/ocr-assets/v7/worker.js'));
    expect(engine).toBeDefined();
    expect(
      await engine!.evaluate(
        () =>
          (globalThis as unknown as { pdfOcrTestRecognitionStarted?: boolean })
            .pdfOcrTestRecognitionStarted,
      ),
    ).toBe(true);
    // PDF resources must already be gone before recognition starts.
    await expect
      .poll(() => ownedWorkers(page).map((worker) => worker.url()))
      .toEqual([engine!.url()]);
    if (operation === 'cancel') {
      await dialog(page)
        .getByRole('button', { name: 'Cancel OCR', exact: true })
        .click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(action(page)).toBeFocused();
    } else if (operation === 'VIEW revoked') {
      api.revoke();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(dialog(page)).toHaveCount(0);
      await expect(action(page)).toHaveCount(0);
    } else {
      await page.clock.fastForward(60_001);
      await expect(dialog(page)).toContainText(/timed out|timeout/i);
      await expect(
        dialog(page).getByRole('button', { name: 'Retry OCR', exact: true }),
      ).toBeEnabled();
    }
    await expect.poll(() => ownedWorkers(page).length).toBe(0);
    await expect(page.getByText(secondText, { exact: true })).toHaveCount(0);
    expect(api.errors).toEqual([]);
    expect(api.external).toEqual([]);
  });
}

test('renderer initialization failure cannot fall back to page drawing or start OCR', async ({
  page,
}) => {
  await setup(page);
  let injected = false;
  await page.route(/pdf\.renderer[^/]*\.mjs(?:\?.*)?$/, async (route) => {
    if (new URL(route.request().url()).searchParams.has('url')) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const original = await response.text();
    const marker = 'handler.on("InitializeGraphics", async data => {';
    expect(original).toContain(marker);
    injected = true;
    await route.fulfill({
      response,
      body: original.replace(
        marker,
        `${marker}\nthrow new Error("Synthetic renderer initialization failure");`,
      ),
    });
  });
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.drawImage;
    Object.assign(window, { pdfOcrFallbackDraws: 0 });
    CanvasRenderingContext2D.prototype.drawImage = function (
      this: CanvasRenderingContext2D,
      ...args: unknown[]
    ) {
      if (this.canvas.width >= 500 && this.canvas.height >= 100)
        (window as unknown as { pdfOcrFallbackDraws: number })
          .pdfOcrFallbackDraws++;
      return Reflect.apply(original, this, args);
    } as typeof original;
  });
  let ocrWorkers = 0;
  page.on('worker', (worker) => {
    if (worker.url().includes('/ocr-assets/v7/worker.js')) ocrWorkers++;
  });
  await start(page);
  await expect(dialog(page)).toContainText(
    /unsupported|not supported|unavailable/i,
  );
  await expect(
    dialog(page).getByRole('button', { name: 'Retry OCR', exact: true }),
  ).toBeVisible();
  expect(injected).toBe(true);
  expect(ocrWorkers).toBe(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { pdfOcrFallbackDraws: number })
          .pdfOcrFallbackDraws,
    ),
  ).toBe(0);
});

for (const operation of ['cancel', 'timeout'] as const) {
  test(`${operation} during renderer graphics initialization discards the stalled page`, async ({
    page,
  }) => {
    await setup(page);
    let rendererRequests = 0;
    await page.route(/pdf\.renderer[^/]*\.mjs(?:\?.*)?$/, async (route) => {
      if (new URL(route.request().url()).searchParams.has('url')) {
        await route.continue();
        return;
      }
      rendererRequests++;
      const response = await route.fetch();
      const original = await response.text();
      const marker = 'handler.on("InitializeGraphics", async data => {';
      expect(original).toContain(marker);
      await route.fulfill({
        response,
        body: original.replace(
          marker,
          `${marker}\nglobalThis.pdfOcrTestGraphicsStarted = true;\nawait new Promise(() => {});`,
        ),
      });
    });
    let ocrWorkers = 0;
    page.on('worker', (worker) => {
      if (worker.url().includes('/ocr-assets/v7/worker.js')) ocrWorkers++;
    });
    if (operation === 'timeout') await page.clock.install();
    await start(page);
    await expect.poll(() => rendererRequests).toBeGreaterThanOrEqual(1);
    await expect
      .poll(async () => {
        const renderer = page
          .workers()
          .find((worker) => /pdf\.renderer/.test(worker.url()));
        return renderer
          ? renderer.evaluate(
              () =>
                (
                  globalThis as unknown as {
                    pdfOcrTestGraphicsStarted?: boolean;
                  }
                ).pdfOcrTestGraphicsStarted === true,
            )
          : false;
      })
      .toBe(true);
    await expect(dialog(page)).toContainText(/preparing/i);
    if (operation === 'cancel') {
      await dialog(page)
        .getByRole('button', { name: 'Cancel OCR', exact: true })
        .click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(action(page)).toBeFocused();
    } else {
      await page.clock.fastForward(60_001);
      await expect(dialog(page)).toContainText(/timed out|timeout/i);
      await expect(
        dialog(page).getByRole('button', { name: 'Retry OCR', exact: true }),
      ).toBeEnabled();
    }
    await expect.poll(() => ownedWorkers(page).length).toBe(0);
    expect(ocrWorkers).toBe(0);
  });
}

test('embedded scan over 16 megapixels fails rather than recognizing a silently blank page', async ({
  page,
}) => {
  await setup(page, {
    source: await scannedPdf(page, [firstText], { oversizedImage: true }),
  });
  let ocrWorkers = 0;
  page.on('worker', (worker) => {
    if (worker.url().includes('/ocr-assets/v7/worker.js')) ocrWorkers++;
  });
  await start(page);
  await expect(
    dialog(page).getByRole('button', { name: 'Retry OCR', exact: true }),
  ).toBeVisible();
  await expect(dialog(page)).toContainText(
    /unavailable|unsupported|not supported|dimension|large/i,
  );
  await expect(dialog(page)).not.toContainText(/no text was recognized/i);
  expect(ocrWorkers).toBe(0);
});

test('missing embedded scan dimensions fail without recognizing an omitted image', async ({
  page,
}) => {
  const api = await setup(page, {
    source: await scannedPdf(page, [firstText], {
      missingImageDimensions: true,
    }),
  });
  let ocrWorkers = 0;
  page.on('worker', (worker) => {
    if (worker.url().includes('/ocr-assets/v7/worker.js')) ocrWorkers++;
  });
  await start(page);
  await expect(
    dialog(page).getByRole('button', { name: 'Retry OCR', exact: true }),
  ).toBeVisible();
  await expect(dialog(page)).toContainText(
    /unsupported|not supported|unavailable/i,
  );
  await expect(dialog(page)).not.toContainText(/no text was recognized/i);
  expect(ocrWorkers).toBe(0);
  const diagnostics = api.logs.join('\n');
  for (const marker of [
    sourceTitle,
    firstText,
    secondText,
    'Image dimensions are missing',
    'Image exceeded maximum allowed size',
  ])
    expect(diagnostics).not.toContain(marker);
});

test('unsupported embedded image decoding fails rather than silently recognizing a blank page', async ({
  page,
}) => {
  const api = await setup(page, {
    source: await scannedPdf(page, [firstText], { invalidImage: true }),
  });
  let ocrWorkers = 0;
  page.on('worker', (worker) => {
    if (worker.url().includes('/ocr-assets/v7/worker.js')) ocrWorkers++;
  });
  await start(page);
  await expect(
    dialog(page).getByRole('button', { name: 'Retry OCR', exact: true }),
  ).toBeVisible();
  await expect(dialog(page)).toContainText(
    /unsupported|not supported|unavailable/i,
  );
  await expect(dialog(page)).not.toContainText(/no text was recognized/i);
  expect(ocrWorkers).toBe(0);
  expect(api.external).toEqual([]);
});

for (const loss of [
  'VIEW revoked',
  'patient removed',
  'source moved to Trash',
] as const) {
  test(`${loss} during acquisition prevents late result publication`, async ({
    page,
  }) => {
    const api = await setup(page);
    api.hold();
    await start(page);
    await expect.poll(() => api.reads.length).toBeGreaterThanOrEqual(1);
    if (loss === 'VIEW revoked') api.revoke();
    else if (loss === 'patient removed') api.removePatient();
    else api.trash();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(dialog(page)).toHaveCount(0);
    api.release();
    await expect(action(page)).toHaveCount(0);
    await expect(page.getByText(firstText, { exact: true })).toHaveCount(0);
  });
}

test('revalidation hides completed page text, then lost VIEW clears it', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const api = await setup(page);
  await start(page, 2);
  await recognized(page, secondText);
  api.holdPatients();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page)).toContainText(/access.*check|check.*access/i);
  await expect(dialog(page)).not.toContainText(secondText);
  api.revoke();
  api.releasePatients();
  await expect(dialog(page)).toHaveCount(0);
  await expect(action(page)).toHaveCount(0);
  await expect(page.getByText(secondText, { exact: true })).toHaveCount(0);
});

test('transient acquisition failure explicitly retries the selected page', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const api = await setup(page);
  api.status(503);
  await start(page, 2);
  await expect(
    dialog(page).getByRole('button', { name: 'Retry OCR', exact: true }),
  ).toBeVisible();
  api.status(200);
  await dialog(page)
    .getByRole('button', { name: 'Retry OCR', exact: true })
    .click();
  await recognized(page, secondText);
  await expect(dialog(page)).not.toContainText(firstText);
});

test('large page raster is bounded and its downsizing is disclosed', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await setup(page, {
    source: await scannedPdf(page, [firstText], { mediaScale: 4 }),
  });
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    Object.assign(window, { pdfOcrRasterDimensions: [] });
    HTMLCanvasElement.prototype.toBlob = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof original>
    ) {
      (
        window as unknown as { pdfOcrRasterDimensions: number[][] }
      ).pdfOcrRasterDimensions.push([this.width, this.height]);
      return Reflect.apply(original, this, args);
    };
  });
  await start(page);
  await recognized(page);
  await expect(dialog(page)).toContainText(/downsized/i);
  const rasters = await page.evaluate(
    () =>
      (window as unknown as { pdfOcrRasterDimensions: number[][] })
        .pdfOcrRasterDimensions,
  );
  expect(rasters.length).toBeGreaterThan(0);
  for (const [width, height] of rasters) {
    expect(width).toBeLessThanOrEqual(2000);
    expect(height).toBeLessThanOrEqual(2000);
    expect(width! * height!).toBeLessThanOrEqual(2_000_000);
  }
});

for (const theme of ['light', 'dark']) {
  test(`${theme} selected-page OCR reflows accessibly on desktop and mobile`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const width = testInfo.project.name === 'mobile' ? 320 : 1440;
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(
      (theme) => localStorage.setItem('fmv.theme', theme),
      theme,
    );
    await setup(page);
    await open(page, 2);
    const initial = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(initial.violations).toEqual([]);
    await dialog(page)
      .getByRole('button', { name: 'Start OCR', exact: true })
      .click();
    await recognized(page, secondText);
    expect(
      await page.evaluate(
        () => window.document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect((await dialog(page).boundingBox())?.width).toBeLessThanOrEqual(
      width,
    );
    const complete = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(complete.violations).toEqual([]);
    if (process.env['PDF_OCR_CAPTURE'] === '1')
      await page.screenshot({
        path: `../../.local/screenshots/pdf-ocr-${theme}-${testInfo.project.name}.png`,
        fullPage: false,
      });
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(action(page)).toBeFocused();
  });
}
