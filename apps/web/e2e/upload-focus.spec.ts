import { expect, test, type Page } from '@playwright/test';
const a = {
  id: 'a',
  displayName: 'Fixture Patient',
  relationship: 'self',
  capabilities: [{ action: 'upload', scope: { kind: 'patient' } }],
};
const b = { ...a, id: 'b', displayName: 'Other Patient' };
async function setup(page: Page) {
  let patients = [a];
  let status = 200;
  let gate: Promise<void> | undefined;
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const uploads: string[] = [];
  await page.route('**/api/auth/bootstrap', (r) =>
    r.fulfill({ json: { enabled: true, csrf: 'c'.repeat(43) } }),
  );
  await page.route('**/api/auth/account', (r) =>
    r.fulfill({
      json: { email: 'fixture@example.test', contextId: 'upload-focus' },
    }),
  );
  await page.route('**/api/patients', async (r) => {
    started?.();
    if (gate) await gate;
    await r.fulfill({ status, json: { patients } });
  });
  await page.route('**/api/patients/*/documents', (r) =>
    r.fulfill({ json: { documents: [], storageReady: true } }),
  );
  await page.route('**/api/patients/*/categories', (r) =>
    r.fulfill({ json: { categories: [] } }),
  );
  await page.route('**/api/patients/*/uploads**', (r) => {
    const path = new URL(r.request().url()).pathname;
    uploads.push(`${r.request().method()} ${path}`);
    return r.fulfill({
      json: {
        uploadId: 'u',
        documentId: 'd',
        state: path.endsWith('/finalize') ? 'ready' : 'pending',
      },
    });
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Select patient: No patient selected' })
    .click();
  await page
    .getByRole('button', { name: /Fixture Patient \(Your profile\)/ })
    .click();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByLabel(/Choose files/)).toBeEnabled();
  return {
    uploads,
    async focusRefresh(next = patients, code = 200) {
      const bounds = await page.getByRole('dialog').boundingBox();
      patients = next;
      status = code;
      const requested = new Promise<void>((resolve) => {
        started = resolve;
      });
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await requested;
      await expect(page.locator('.document-upload')).toHaveAttribute(
        'aria-busy',
        'true',
      );
      await expect(
        page.getByRole('button', { name: 'Upload selected files' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Upload selected files' }),
      ).toBeDisabled();
      expect(await page.getByRole('dialog').boundingBox()).toEqual(bounds);
      expect(uploads).toEqual([]);
    },
    release() {
      gate = undefined;
      started = undefined;
      release?.();
    },
  };
}
async function chooseFile(page: Page) {
  await page.getByLabel(/Choose files/).setInputFiles({
    name: 'synthetic-record.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 synthetic fixture'),
  });
  await expect(
    page.getByText('synthetic-record.pdf:', { exact: true }),
  ).toBeVisible();
}
test('canceling the picker keeps the same dialog and file input', async ({
  page,
}) => {
  const fixture = await setup(page);
  const input = await page.getByLabel(/Choose files/).elementHandle();
  const bounds = await page.getByRole('dialog').boundingBox();
  await input!.dispatchEvent('cancel');
  await fixture.focusRefresh();
  fixture.release();
  await expect(page.getByLabel(/Choose files/)).toBeEnabled();
  expect(await input!.evaluate((element) => element.isConnected)).toBe(true);
  expect(await page.getByRole('dialog').boundingBox()).toEqual(bounds);
  await expect(
    page.getByRole('button', { name: 'Upload selected files' }),
  ).toBeDisabled();
  expect(fixture.uploads).toEqual([]);
});
test('real App preserves upload queue across picker focus revalidation', async ({
  page,
}) => {
  const fixture = await setup(page);
  await chooseFile(page);
  await fixture.focusRefresh();
  fixture.release();
  await expect(
    page.getByText('synthetic-record.pdf:', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Upload selected files' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Upload', exact: true }),
  ).toBeFocused();
  expect(fixture.uploads).toEqual([
    'POST /api/patients/a/uploads',
    'PUT /api/patients/a/uploads/u/content',
    'POST /api/patients/a/uploads/u/finalize',
  ]);
});
test('picker change reaches its original input when focus arrives first', async ({
  page,
}) => {
  const fixture = await setup(page);
  const input = await page.getByLabel(/Choose files/).elementHandle();
  expect(input).not.toBeNull();
  await fixture.focusRefresh();
  await input!.setInputFiles({
    name: 'synthetic-record.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 synthetic fixture'),
  });
  fixture.release();
  await expect(
    page.getByText('synthetic-record.pdf:', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Upload selected files' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Upload', exact: true }),
  ).toBeFocused();
  expect(fixture.uploads).toHaveLength(3);
});
test('partial batch stays open and retries only the failed file before closing', async ({
  page,
}) => {
  await setup(page);
  const titles: string[] = [];
  const keys: string[] = [];
  const finalized: string[] = [];
  await page.route('**/api/patients/a/uploads**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/uploads')) {
      const body = route.request().postDataJSON() as {
        title: string;
        idempotencyKey: string;
      };
      titles.push(body.title);
      keys.push(body.idempotencyKey);
      if (titles.length === 1) return route.fulfill({ status: 503 });
      return route.fulfill({
        json: {
          uploadId: body.title,
          documentId: body.title,
          state: 'pending',
        },
      });
    }
    if (path.endsWith('/finalize')) finalized.push(path);
    return route.fulfill({
      json: {
        uploadId: path.split('/')[5],
        documentId: path.split('/')[5],
        state: path.endsWith('/finalize') ? 'ready' : 'pending',
      },
    });
  });
  await page.getByLabel(/Choose files/).setInputFiles(
    ['retry.pdf', 'stored.pdf'].map((name) => ({
      name,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 synthetic fixture'),
    })),
  );
  await page.getByRole('button', { name: 'Upload selected files' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'retry.pdf:' }),
  ).toContainText('Failed');
  await expect(
    page.getByRole('listitem').filter({ hasText: 'stored.pdf:' }),
  ).toContainText('Stored');
  expect(titles).toEqual(['retry.pdf', 'stored.pdf']);
  await page.getByRole('button', { name: 'Upload selected files' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Upload', exact: true }),
  ).toBeFocused();
  expect(titles).toEqual(['retry.pdf', 'stored.pdf', 'retry.pdf']);
  expect(keys[2]).toBe(keys[0]);
  expect(finalized).toEqual([
    '/api/patients/a/uploads/stored.pdf/finalize',
    '/api/patients/a/uploads/retry.pdf/finalize',
  ]);
});
for (const outcome of ['revoked', 'failed'] as const) {
  test(`real App clears upload queue after ${outcome} refresh`, async ({
    page,
  }) => {
    const fixture = await setup(page);
    await chooseFile(page);
    await fixture.focusRefresh(
      outcome === 'revoked' ? [b] : [a],
      outcome === 'failed' ? 503 : 200,
    );
    fixture.release();
    await expect(
      page.getByRole('heading', { name: 'Select a patient first' }),
    ).toBeVisible();
    await expect(
      page.getByText('synthetic-record.pdf:', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Upload selected files' }),
    ).toHaveCount(0);
    expect(fixture.uploads).toEqual([]);
    if (outcome === 'revoked') {
      await page.getByRole('button', { name: 'Got it' }).click();
      await page
        .getByRole('button', { name: 'Select patient: No patient selected' })
        .click();
      await page
        .getByRole('button', { name: /Other Patient \(Your profile\)/ })
        .click();
      await page.getByRole('button', { name: 'Upload', exact: true }).click();
      await expect(page.getByLabel(/Choose files/)).toBeEnabled();
      await expect(
        page.getByText('synthetic-record.pdf:', { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Upload selected files' }),
      ).toBeDisabled();
      expect(fixture.uploads).toEqual([]);
    }
  });
}

test('upload dialog fits both themes and narrow screens', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'Viewport coverage is explicit in this test.',
  );
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const { mkdir } = await import('node:fs/promises');
  const path = await import('node:path');
  await setup(page);
  await chooseFile(page);
  const directory = path.resolve(process.cwd(), '../../.local/screenshots');
  await mkdir(directory, { recursive: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.dataset['theme'] = value;
      document.documentElement.classList.toggle('dark', value === 'dark');
      document.documentElement.style.colorScheme = value;
    }, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(
      page.getByRole('button', {
        includeHidden: true,
        name:
          theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      }),
    ).toBeAttached();
    await expect(
      page.getByRole('button', { name: 'Clear file queue' }),
    ).toHaveCSS(
      'background-color',
      theme === 'dark' ? 'rgb(19, 29, 43)' : 'rgb(255, 255, 255)',
    );
    const colors = await page
      .getByRole('dialog')
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons.map((button) => ({
          text: button.textContent,
          background: getComputedStyle(button).backgroundColor,
          color: getComputedStyle(button).color,
        })),
      );
    await testInfo.attach(`upload-${theme}-button-colors`, {
      body: JSON.stringify(colors),
      contentType: 'application/json',
    });
    for (const [device, width, height] of [
      ['desktop', 1440, 1000],
      ['mobile', 390, 844],
      ['narrow', 320, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      const dialog = page.getByRole('dialog');
      await expect(
        page.getByRole('button', { name: 'Upload selected files' }),
      ).toBeVisible();
      const dimensions = await dialog.evaluate((el) => ({
        width: el.scrollWidth,
        viewport: el.clientWidth,
        right: el.getBoundingClientRect().right,
      }));
      expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport + 1);
      expect(dimensions.right).toBeLessThanOrEqual(width);
      if (device !== 'narrow')
        await page.screenshot({
          path: path.join(directory, `upload-${theme}-${device}.png`),
        });
    }
    const result = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(result.violations).toEqual([]);
  }
});
