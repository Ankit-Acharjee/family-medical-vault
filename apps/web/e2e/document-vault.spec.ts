import { expect, test, type Page } from '@playwright/test';
const a = {
  id: 'a',
  displayName: 'Fixture A',
  relationship: 'self',
  capabilities: [{ action: 'view', scope: { kind: 'patient' } }],
};
const b = { ...a, id: 'b', displayName: 'Fixture B' };
const document = {
  id: 'doc',
  patientId: 'a',
  title: 'fixture.pdf',
  mimeType: 'application/pdf',
  bytes: 5,
  createdAt: '2026-01-01T00:00:00Z',
  categoryId: 'general',
  canView: true,
  canExport: false,
};
async function setup(page: Page) {
  await page.route('**/api/auth/bootstrap', (route) =>
    route.fulfill({ json: { enabled: true, csrf: 'c'.repeat(43) } }),
  );
  await page.route('**/api/auth/account', (route) =>
    route.fulfill({ status: 401 }),
  );
  await page.route('**/api/patients', (route) =>
    route.fulfill({ json: { patients: [a, b] } }),
  );
}
async function mount(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/features/documents/test-fixture.tsx';
    const fixture = (await import(/* @vite-ignore */ path)) as {
      mount: () => void;
    };
    fixture.mount();
  });
  await page.getByRole('button', { name: /Fixture A/ }).click();
}
test('long document names reflow at narrow widths in both themes', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/patients/a/documents', (route) =>
    route.fulfill({
      json: {
        documents: [
          {
            ...document,
            title: 'x'.repeat(195) + '.pdf',
            canView: true,
            canExport: true,
          },
        ],
        storageReady: true,
      },
    }),
  );
  await page.route('**/api/patients/a/categories', (route) =>
    route.fulfill({ json: { categories: [] } }),
  );
  await mount(page);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (value) =>
        window.document.documentElement.classList.toggle(
          'dark',
          value === 'dark',
        ),
      theme,
    );
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(
        page.getByRole('button', { name: /^Preview / }),
      ).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        viewport: window.document.documentElement.clientWidth,
        width: window.document.documentElement.scrollWidth,
        overflowing: Array.from(window.document.querySelectorAll('*'))
          .filter((el) => el.getBoundingClientRect().right > innerWidth + 0.5)
          .map((el) => ({
            tag: el.tagName,
            class: el.className,
            width: el.getBoundingClientRect().width,
          }))
          .slice(0, 6),
      }));
      expect(dimensions.width, JSON.stringify(dimensions)).toBeLessThanOrEqual(
        dimensions.viewport,
      );
    }
  }
});
test('lists records and hides download without export; preview uses a blob', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/patients/a/documents', (route) =>
    route.fulfill({ json: { documents: [document], storageReady: true } }),
  );
  await page.route('**/api/patients/a/categories', (route) =>
    route.fulfill({ json: { categories: [] } }),
  );
  await page.route('**/api/patients/a/documents/doc/preview', (route) =>
    route.fulfill({ body: '%PDF-', contentType: 'application/pdf' }),
  );
  await mount(page);
  await expect(
    page.getByRole('button', { name: 'Download fixture.pdf' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview fixture.pdf' }).click();
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', '');
  await expect(page.locator('iframe')).toHaveAttribute('src', /^blob:/);
});
test('export-only access offers download without preview', async ({ page }) => {
  await setup(page);
  await page.route('**/api/patients/a/documents', (route) =>
    route.fulfill({
      json: {
        documents: [{ ...document, canView: false, canExport: true }],
        storageReady: true,
      },
    }),
  );
  await page.route('**/api/patients/a/categories', (route) =>
    route.fulfill({ status: 404 }),
  );
  await mount(page);
  await expect(
    page.getByRole('button', { name: 'Download fixture.pdf' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Preview fixture.pdf' }),
  ).toHaveCount(0);
});
test('upload retries the same idempotency key and waits for finalization', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/patients/a/documents', (route) =>
    route.fulfill({ json: { documents: [], storageReady: true } }),
  );
  await page.route('**/api/patients/a/categories', (route) =>
    route.fulfill({ json: { categories: [] } }),
  );
  const keys: string[] = [];
  let contentAttempts = 0;
  await page.route('**/api/patients/a/uploads', (route) => {
    keys.push(
      (route.request().postDataJSON() as { idempotencyKey: string })
        .idempotencyKey,
    );
    return route.fulfill({
      json: { uploadId: 'u', documentId: 'd', state: 'pending' },
    });
  });
  await page.route('**/api/patients/a/uploads/u/content', (route) => {
    contentAttempts++;
    return contentAttempts === 1
      ? route.fulfill({ status: 503 })
      : route.fulfill({
          json: { uploadId: 'u', documentId: 'd', state: 'pending' },
        });
  });
  await page.route('**/api/patients/a/uploads/u/finalize', (route) =>
    route.fulfill({ json: { uploadId: 'u', documentId: 'd', state: 'ready' } }),
  );
  await mount(page);
  await page.getByLabel(/Choose files/).setInputFiles({
    name: 'fixture.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-'),
  });
  await page.getByRole('button', { name: 'Upload selected files' }).click();
  await expect(page.getByText(/fixture.pdf: Failed/)).toBeVisible();
  await page.getByRole('button', { name: 'Upload selected files' }).click();
  await expect(page.getByText(/fixture.pdf: Stored/)).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});
test('denied list and unavailable storage are clear', async ({ page }) => {
  await setup(page);
  await page.route('**/api/patients/a/documents', (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.route('**/api/patients/a/categories', (route) =>
    route.fulfill({ json: { categories: [] } }),
  );
  await mount(page);
  await expect(page.getByRole('alert').first()).toContainText(
    'unavailable for your current access',
  );
  await expect(page.getByText('fixture.pdf')).toHaveCount(0);
});
test('patient switch hides delayed previous patient records', async ({
  page,
}) => {
  await setup(page);
  let release: (() => void) | undefined;
  let mark: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    mark = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/patients/*/categories', (route) =>
    route.fulfill({ json: { categories: [] } }),
  );
  await page.route('**/api/patients/*/documents', async (route) => {
    if (new URL(route.request().url()).pathname.includes('/a/')) {
      mark?.();
      await gate;
      await route
        .fulfill({ json: { documents: [document], storageReady: true } })
        .catch(() => {});
    } else
      await route.fulfill({ json: { documents: [], storageReady: false } });
  });
  await mount(page);
  await started;
  await page.getByRole('button', { name: /Fixture B/ }).click();
  await expect(
    page.getByText('No documents are available for this patient.'),
  ).toBeVisible();
  release?.();
  await expect(page.getByText('fixture.pdf')).toHaveCount(0);
  await expect(
    page.getByText(/Document storage is unavailable/).first(),
  ).toBeVisible();
});
