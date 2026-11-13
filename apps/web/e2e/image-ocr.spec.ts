import { mockExtractionContext } from './support/extraction-context';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// AI-01/05/06: synthetic printed images, real local OCR engine, mocked access.
const sourceTitle = 'Synthetic printed image.png';
const patient = {
  id: 'ocr-a',
  displayName: 'OCR Fixture Patient',
  relationship: 'self',
  capabilities: ['view', 'export', 'edit'].map((action) => ({
    action,
    scope: { kind: 'patient' },
  })),
};
const other = { ...patient, id: 'ocr-b', displayName: 'Other OCR Patient' };
const record = {
  id: 'synthetic-ocr-image',
  patientId: patient.id,
  title: sourceTitle,
  originalTitle: 'synthetic-printed-image.png',
  categoryId: 'general',
  categoryName: 'Unclassified',
  createdAt: '2026-11-12T12:00:00Z',
  canEdit: true,
  canView: true,
  canExport: true,
  bytes: 500,
  mimeType: 'image/png',
};
const action = (page: Page) =>
  page.getByRole('button', {
    name: `Recognize text (OCR) ${sourceTitle}`,
    exact: true,
  });
const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Recognized text (OCR)', exact: true });

async function image(
  page: Page,
  text = 'FAMILY VAULT TEST',
  mime = 'image/png',
  width = 1200,
  height = 300,
) {
  const data = await page.evaluate(
    ({ text, mime, width, height }) => {
      const canvas = window.document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#000';
      context.font = 'bold 64px Arial';
      if (text) context.fillText(text, 50, 150);
      return canvas.toDataURL(mime, 0.95).split(',')[1]!;
    },
    { text, mime, width, height },
  );
  return Buffer.from(data, 'base64');
}

async function setup(
  page: Page,
  options: {
    source?: Buffer;
    mimeType?: string;
    bytes?: number;
    canView?: boolean;
  } = {},
) {
  const source = options.source ?? (await image(page));
  let records = [
    {
      ...record,
      ...options,
      source: undefined,
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
  const logs: string[] = [];
  const external: string[] = [];
  const errors: string[] = [];
  const assetBytes = new Map<string, number>();
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
  page.on('response', (response) => {
    if (
      /ocr|tesseract|traineddata|\.wasm/.test(response.url()) &&
      !response.url().includes('/api/')
    ) {
      const length = Number(response.headers()['content-length']);
      if (Number.isFinite(length)) assetBytes.set(response.url(), length);
    }
  });
  await mockExtractionContext(page);
  await page.route('**/api/auth/bootstrap', (route) =>
    route.fulfill({ json: { enabled: true, csrf: 'c'.repeat(43) } }),
  );
  await page.route('**/api/auth/account', (route) =>
    route.fulfill({
      json: { email: 'fixture@example.test', contextId: 'ocr-test-session' },
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
        documents: route.request().url().includes('/ocr-a/') ? records : [],
        storageReady: true,
      },
    }),
  );
  await page.route('**/api/patients/*/documents/*/preview', async (route) => {
    reads.push(route.request().url());
    if (gate) await gate;
    await route
      .fulfill({
        status,
        body: source,
        contentType: options.mimeType ?? 'image/png',
      })
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
    logs,
    external,
    errors,
    assetBytes,
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
      records = records.map((item) => ({ ...item, canView: false }));
    },
    removePatient: () => {
      patients = [other];
    },
  };
}
async function open(page: Page) {
  await action(page).click();
  await expect(dialog(page)).toBeVisible();
}
async function start(page: Page) {
  await open(page);
  await dialog(page)
    .getByRole('button', { name: 'Start OCR', exact: true })
    .click();
}
async function recognized(page: Page) {
  await expect(dialog(page)).toContainText('FAMILY VAULT TEST', {
    timeout: 65_000,
  });
}

// Real OCR tests are deliberately sequential within each test and single-worker in CI invocation.
test('OCR is explicit, English-only, local and unverified, with safe source and focus', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const api = await setup(page);
  expect(api.reads).toHaveLength(0);
  await action(page).focus();
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toContainText(sourceTitle);
  await expect(dialog(page)).toContainText(/English/i);
  expect(api.reads).toHaveLength(0);
  const started = Date.now();
  await dialog(page)
    .getByRole('button', { name: 'Start OCR', exact: true })
    .click();
  await recognized(page);
  testInfo.annotations.push({
    type: 'OCR elapsed ms',
    description: String(Date.now() - started),
  });
  testInfo.annotations.push({
    type: 'OCR static content-length bytes',
    description: String(
      [...api.assetBytes.values()].reduce((a, b) => a + b, 0),
    ),
  });
  await expect(dialog(page)).toContainText(/unverified/i);
  expect(api.external).toEqual([]);
  expect(api.logs.join('\n')).not.toContain('FAMILY VAULT TEST');
  expect(api.errors).toEqual([]);
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    ),
  ).not.toContain('FAMILY VAULT TEST');
  const databases = await page.evaluate(async () =>
    typeof indexedDB.databases === 'function'
      ? (await indexedDB.databases()).map((database) => database.name)
      : [],
  );
  expect(
    databases.filter((name) => /tesseract|keyval/i.test(name ?? '')),
  ).toEqual([]);
  await dialog(page)
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  await expect(action(page)).toBeFocused();
  await expect(
    page.getByRole('button', { name: `Preview ${sourceTitle}`, exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: `Download ${sourceTitle}`, exact: true }),
  ).toBeEnabled();
});

for (const mimeType of ['image/jpeg', 'image/webp']) {
  test(`${mimeType} originals can be recognized with the real engine`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await setup(page, {
      source: await image(page, 'FAMILY VAULT TEST', mimeType),
      mimeType,
    });
    await start(page);
    await recognized(page);
  });
}

test('blank image gives an honest no-text state', async ({ page }) => {
  test.setTimeout(90_000);
  await setup(page, { source: await image(page, '') });
  await start(page);
  await expect(dialog(page)).toContainText(/no .*text|no text/i, {
    timeout: 65_000,
  });
  await expect(dialog(page)).not.toContainText('FAMILY VAULT TEST');
});
test('malformed image gives retry without disabling the original', async ({
  page,
}) => {
  await setup(page, { source: Buffer.from('not an image') });
  await start(page);
  await expect(
    dialog(page).getByRole('button', { name: 'Retry OCR', exact: true }),
  ).toBeVisible();
  await expect(dialog(page)).not.toContainText('FAMILY VAULT TEST');
});

test('export-only permission does not enable OCR', async ({ page }) => {
  await setup(page, { canView: false });
  await expect(action(page)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: `Download ${sourceTitle}`, exact: true }),
  ).toBeEnabled();
});
test('PDF originals keep their separate embedded-text extraction action', async ({
  page,
}) => {
  await setup(page, { mimeType: 'application/pdf' });
  await expect(action(page)).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: `Extract text ${sourceTitle}`,
      exact: true,
    }),
  ).toBeVisible();
});
test('current VIEW denial clears the OCR source without publishing text', async ({
  page,
}) => {
  const api = await setup(page);
  api.status(403);
  await start(page);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('alert').first()).toContainText(
    /access|unavailable/i,
  );
  await expect(
    page.getByText('FAMILY VAULT TEST', { exact: true }),
  ).toHaveCount(0);
});
test('transient source failure requires explicit retry', async ({ page }) => {
  test.setTimeout(90_000);
  const api = await setup(page);
  api.status(503);
  await start(page);
  await expect(
    dialog(page).getByRole('button', { name: 'Retry OCR', exact: true }),
  ).toBeVisible();
  api.status(200);
  await dialog(page)
    .getByRole('button', { name: 'Retry OCR', exact: true })
    .click();
  await recognized(page);
});
test('metadata input cap avoids fetching an oversized original', async ({
  page,
}) => {
  const api = await setup(page, { bytes: 10 * 1024 * 1024 + 1 });
  await start(page);
  await expect(dialog(page)).toContainText(/size|10 MiB|large/i);
  expect(api.reads).toHaveLength(0);
});
test('actual input cap rejects misleading original-size metadata', async ({
  page,
}) => {
  await setup(page, {
    source: Buffer.alloc(10 * 1024 * 1024 + 1, 32),
    bytes: 100,
  });
  await start(page);
  await expect(dialog(page)).toContainText(/size|10 MiB|large/i);
});
test('source dimensions are checked before decoding a huge raster', async ({
  page,
}) => {
  await setup(page, { source: await image(page, '', 'image/png', 8193, 1) });
  await start(page);
  await expect(dialog(page)).toContainText(/dimension|8192|large/i);
});
test('cancel during source acquisition ignores a late original and restores focus', async ({
  page,
}) => {
  const api = await setup(page);
  api.hold();
  await start(page);
  await expect.poll(() => api.reads.length).toBeGreaterThanOrEqual(1);
  await dialog(page)
    .getByRole('button', { name: 'Cancel OCR', exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  api.release();
  await expect(action(page)).toBeFocused();
  await expect(
    page.getByText('FAMILY VAULT TEST', { exact: true }),
  ).toHaveCount(0);
});
test('source deadline permits retry and rejects a late result', async ({
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
  await expect(dialog(page)).not.toContainText('FAMILY VAULT TEST');
  await expect(
    dialog(page).getByRole('button', { name: 'Retry OCR', exact: true }),
  ).toBeVisible();
});
test('revoked VIEW clears completed OCR and removes its action', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const api = await setup(page);
  await start(page);
  await recognized(page);
  api.revoke();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page)).toHaveCount(0);
  await expect(action(page)).toHaveCount(0);
  await expect(
    page.getByText('FAMILY VAULT TEST', { exact: true }),
  ).toHaveCount(0);
});
test('patient removal during acquisition prevents late OCR output', async ({
  page,
}) => {
  const api = await setup(page);
  api.hold();
  await start(page);
  await expect.poll(() => api.reads.length).toBeGreaterThanOrEqual(1);
  api.removePatient();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page)).toHaveCount(0);
  api.release();
  await expect(
    page.getByText('FAMILY VAULT TEST', { exact: true }),
  ).toHaveCount(0);
});

for (const theme of ['light', 'dark']) {
  test(`${theme} OCR stays accessible and responsive at narrow widths`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({
      width: testInfo.project.name === 'mobile' ? 320 : 1440,
      height: 1000,
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(
      (value) => localStorage.setItem('fmv.theme', value),
      theme,
    );
    await setup(page);
    await start(page);
    await recognized(page);
    expect(
      await page.evaluate(
        () => window.document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(results.violations).toEqual([]);
    if (process.env['OCR_CAPTURE'] === '1')
      await page.screenshot({
        path: `../../.local/screenshots/image-ocr-${theme}-${testInfo.project.name}.png`,
        fullPage: false,
      });
  });
}

for (const operation of ['cancel', 'timeout'] as const) {
  test(`stalled OCR worker initialization supports ${operation} and a fresh attempt`, async ({
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
    await page.route('**/ocr-assets/v7/worker.js', async (route) => {
      requests++;
      if (hold) await gate;
      await route.continue().catch(() => {});
    });
    if (operation === 'timeout') await page.clock.install();
    await start(page);
    await expect.poll(() => requests).toBeGreaterThanOrEqual(1);
    if (operation === 'cancel') {
      await dialog(page)
        .getByRole('button', { name: 'Cancel OCR', exact: true })
        .click();
      await expect(dialog(page)).toHaveCount(0);
    } else {
      await page.clock.fastForward(60_001);
      await expect(dialog(page)).toContainText(/timed out|timeout/i);
    }
    await expect
      .poll(
        () =>
          page
            .workers()
            .filter((worker) =>
              worker.url().includes('/ocr-assets/v7/worker.js'),
            ).length,
      )
      .toBe(0);
    hold = false;
    release?.();
    if (operation === 'cancel') await start(page);
    else
      await dialog(page)
        .getByRole('button', { name: 'Retry OCR', exact: true })
        .click();
    await recognized(page);
    expect(api.errors).toEqual([]);
  });
}

test('missing local language model fails honestly and retries without an external fallback', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const api = await setup(page);
  let fail = true;
  await page.route('**/ocr-assets/v7/lang/eng.traineddata.gz', (route) =>
    fail ? route.fulfill({ status: 503, body: '' }) : route.continue(),
  );
  await start(page);
  await expect(
    dialog(page).getByRole('button', { name: 'Retry OCR', exact: true }),
  ).toBeVisible({ timeout: 65_000 });
  expect(api.external).toEqual([]);
  fail = false;
  await dialog(page)
    .getByRole('button', { name: 'Retry OCR', exact: true })
    .click();
  await recognized(page);
  expect(api.external).toEqual([]);
});

test('closing during patient revalidation restores focus after access is usable', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const api = await setup(page);
  await start(page);
  await recognized(page);
  api.holdPatients();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page)).toContainText(/access.*check|check.*access/i);
  await dialog(page)
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  api.releasePatients();
  await expect(action(page)).toBeEnabled();
  await expect(action(page)).toBeFocused();
});

test('oversized supported image is resized for OCR and the reduction is disclosed', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await setup(page, {
    source: await image(page, 'FAMILY VAULT TEST', 'image/png', 3000, 1000),
  });
  await start(page);
  await recognized(page);
  await expect(dialog(page)).toContainText(/downsized/i);
});

test('publisher output is bounded in the owned worker and rendered as plain partial text', async ({
  page,
}) => {
  await setup(page);
  // Test the actual bootstrap/output gate with a deterministic vendor-protocol stub.
  // Real OCR recognition is covered separately above.
  await page.route('**/ocr-assets/v7/engine.min.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
    globalThis.addEventListener('message', ({data}) => {
      globalThis.postMessage({jobId:data.jobId, action:data.action, status:'resolve', data:data.action==='recognize'?{text:'X'.repeat(100001)}:{}});
    });
  `,
    }),
  );
  await start(page);
  await expect(dialog(page)).toContainText(/character cap/i);
  const text = await dialog(page).locator('h3 + p').textContent();
  expect(text?.length).toBe(100000);
  await expect(dialog(page)).toContainText(/not the complete document/i);
});

test('worker asset allowlist blocks remote transports before making a request', async ({
  page,
}) => {
  const api = await setup(page);
  await page.route('**/ocr-assets/v7/engine.min.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
    globalThis.addEventListener('message', async ({data}) => {
      if(data.action==='recognize') {
        let blocked=0;
        try { await globalThis.fetch('https://ocr-test.invalid/image'); } catch { blocked++; }
        try { globalThis.importScripts('https://ocr-test.invalid/engine.js'); } catch { blocked++; }
        try { new globalThis.XMLHttpRequest(); } catch { blocked++; }
        globalThis.postMessage({jobId:data.jobId, action:data.action, status:'resolve', data:{text:blocked===3?'All remote transports blocked':'Unexpected transport'}});
      } else globalThis.postMessage({jobId:data.jobId, action:data.action, status:'resolve', data:{}});
    });
  `,
    }),
  );
  await start(page);
  await expect(dialog(page)).toContainText('All remote transports blocked');
  expect(api.external).toEqual([]);
});
