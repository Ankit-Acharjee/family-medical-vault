import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const source = '11111111-1111-4111-8111-111111111111';
const candidate = '22222222-2222-4222-8222-222222222222';
const patient = {
  id: 'a',
  displayName: 'Related Patient',
  relationship: 'self',
  capabilities: [{ action: 'view', scope: { kind: 'patient' } }],
};
const row = (id: string, title: string) => ({
  id,
  patientId: 'a',
  title,
  categoryId: 'general',
  createdAt: '2026-04-03T12:00:00Z',
  canView: true,
  canExport: false,
  bytes: 5,
  mimeType: 'application/pdf',
});
const context = (documentId: string) => ({
  documentId,
  sourceSha256: 'a'.repeat(64),
  sourceRevision: 1,
  metadataRevision: 1,
  lifecycleVersion: 1,
});
const provider = {
  kind: 'provider',
  value: 'Example Clinic',
  confidence: 'explicit',
  page: 1,
  excerpt: 'Provider: Example Clinic',
};
const date = {
  kind: 'date',
  value: '2026-04-03',
  confidence: 'explicit',
  page: 2,
  excerpt: 'Report date: 2026-04-03',
  dateRole: 'Report date',
};
const result = {
  source: context(source),
  status: 'ready',
  limited: true,
  matches: [
    {
      ...context(candidate),
      title: 'Second report.pdf',
      evidence: {
        sourceProvider: provider,
        sourceDate: date,
        candidateProvider: provider,
        candidateDate: date,
      },
    },
  ],
};
async function setup(page: Page) {
  let response: unknown = result;
  let status = 200;
  let calls = 0;
  let gate: Promise<void> | undefined;
  let release: (() => void) | undefined;
  await page.route('**/api/auth/bootstrap', (route) =>
    route.fulfill({ json: { enabled: true, csrf: 'c'.repeat(43) } }),
  );
  await page.route('**/api/auth/account', (route) =>
    route.fulfill({
      json: { email: 'fixture@example.test', contextId: 'related-session' },
    }),
  );
  await page.route('**/api/patients', (route) =>
    route.fulfill({
      json: {
        patients: [
          patient,
          { ...patient, id: 'b', displayName: 'Other Patient' },
        ],
      },
    }),
  );
  await page.route('**/api/patients/*/categories', (route) =>
    route.fulfill({ json: { categories: [] } }),
  );
  await page.route('**/api/patients/*/documents/search', (route) =>
    route.fulfill({ json: { documentIds: [], truncated: false } }),
  );
  await page.route('**/api/patients/*/documents', (route) =>
    route.fulfill({
      json: {
        documents: [
          row(source, 'First report.pdf'),
          row(candidate, 'Second report.pdf'),
        ],
        storageReady: true,
      },
    }),
  );
  await page.route(
    '**/api/patients/*/documents/*/related-documents',
    async (route) => {
      calls++;
      const oldResponse = response;
      const oldStatus = status;
      if (gate) await gate;
      await route
        .fulfill({ status: oldStatus, json: oldResponse })
        .catch(() => {});
    },
  );
  await page.route('**/api/patients/*/documents/*/preview', (route) =>
    route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' }),
  );
  await page.goto('/#documents');
  await page
    .getByRole('button', { name: 'Select patient: No patient selected' })
    .click();
  await page
    .getByRole('button', { name: /Related Patient \(Your profile\)/ })
    .click();
  const trigger = page.getByRole('button', {
    name: 'Possible related documents First report.pdf',
  });
  await expect(trigger).toBeVisible();
  return {
    trigger,
    set: (value: unknown, code = 200) => {
      response = value;
      status = code;
    },
    calls: () => calls,
    hold: () => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release: () => {
      gate = undefined;
      release?.();
    },
  };
}

test('opt-in lookup, evidence, limited disclosure and original navigation', async ({
  page,
}) => {
  const api = await setup(page);
  expect(api.calls()).toBe(0);
  await api.trigger.click();
  const dialog = page.getByRole('dialog', {
    name: 'Possible related documents',
  });
  await expect(
    dialog.getByText('Provider: Example Clinic').first(),
  ).toBeVisible();
  await expect(dialog.getByText(/list is limited/)).toBeVisible();
  await expect(
    dialog.getByText(/do not establish the same encounter/),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'View original' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Document preview' }),
  ).toBeVisible();
});

test('empty, insufficient, failure retry, denied and focus restoration', async ({
  page,
}) => {
  const api = await setup(page);
  api.set({
    ...result,
    status: 'insufficient-hints',
    matches: [],
    limited: false,
  });
  await api.trigger.click();
  await expect(page.getByText(/No eligible saved provider/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(api.trigger).toBeFocused();
  api.set({}, 500);
  await api.trigger.click();
  await expect(page.getByText(/could not be loaded/)).toBeVisible();
  api.set({ ...result, matches: [], limited: false });
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText(/No matching saved hints/)).toBeVisible();
  await page.keyboard.press('Escape');
  api.set({}, 403);
  await api.trigger.click();
  await expect(
    page.getByText(/Document access is no longer available/),
  ).toBeVisible();
});

for (const theme of ['light', 'dark'] as const)
  test(`related dialog is accessible in ${theme}`, async ({
    page,
  }, testInfo) => {
    const api = await setup(page);
    if (theme === 'dark')
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await api.trigger.click();
    await expect(
      page.getByRole('dialog').getByText('Second report.pdf'),
    ).toBeVisible();
    await page.screenshot({
      path: `../../.local/screenshots/related-documents-${theme}-${testInfo.project.name}.png`,
    });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 320, height: 720 });
    const longTitle = 'LongReport'.repeat(20);
    const longProvider = {
      ...provider,
      excerpt: 'Provider: ' + 'Example'.repeat(30),
    };
    api.set({
      ...result,
      matches: [
        {
          ...result.matches[0],
          title: longTitle,
          evidence: {
            ...result.matches[0]!.evidence,
            candidateProvider: longProvider,
          },
        },
      ],
    });
    await api.trigger.click();
    const dialog = page.getByRole('dialog', {
      name: 'Possible related documents',
    });
    await expect(dialog.getByText(longTitle)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: `../../.local/screenshots/related-documents-${theme}-320-${testInfo.project.name}.png`,
    });
  });

test('revalidation discards a stale response and refreshes candidate access', async ({
  page,
}) => {
  const api = await setup(page);
  api.hold();
  await api.trigger.click();
  await expect.poll(api.calls).toBe(1);
  api.set({ ...result, matches: [], limited: false });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(api.calls).toBeGreaterThanOrEqual(2);
  api.release();
  await expect(page.getByText(/No matching saved hints/)).toBeVisible();
  await expect(
    page.getByRole('dialog').getByText('Second report.pdf'),
  ).toHaveCount(0);
  expect(api.calls()).toBeGreaterThanOrEqual(2);
});

test('malformed and oversized responses fail safely and can retry', async ({
  page,
}) => {
  const api = await setup(page);
  api.set({ invalid: true });
  await api.trigger.click();
  await expect(page.getByText(/could not be loaded/)).toBeVisible();
  api.set({ padding: 'x'.repeat(140000) });
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(api.calls).toBe(2);
  await expect(page.getByText(/could not be loaded/)).toBeVisible();
  api.set(result);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(
    page.getByRole('dialog').getByText('Second report.pdf'),
  ).toBeVisible();
});

test('changing patient clears an in-flight lookup', async ({ page }) => {
  const api = await setup(page);
  api.hold();
  await api.trigger.click();
  await expect.poll(api.calls).toBe(1);
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: /Select patient: Related Patient/ })
    .click();
  await page.getByRole('button', { name: /Other Patient/ }).click();
  api.release();
  await expect(
    page.getByRole('dialog', { name: 'Possible related documents' }),
  ).toHaveCount(0);
  await expect(page.getByText('Provider: Example Clinic')).toHaveCount(0);
});

test('lookup timeout is recoverable and discards the late response', async ({
  page,
}) => {
  const api = await setup(page);
  await page.clock.install();
  api.hold();
  await api.trigger.click();
  await expect.poll(api.calls).toBe(1);
  await page.clock.fastForward(15_001);
  await expect(
    page.getByText('Possible related documents could not be loaded.'),
  ).toBeVisible();
  api.release();
  await expect(
    page.getByRole('dialog').getByText('Second report.pdf'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText('Second report.pdf'),
  ).toBeVisible();
});
