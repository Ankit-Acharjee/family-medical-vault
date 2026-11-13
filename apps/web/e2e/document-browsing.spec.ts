import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const patient = {
  id: 'a',
  displayName: 'Browsing Patient',
  relationship: 'self',
  capabilities: ['view', 'edit'].map((action) => ({
    action,
    scope: { kind: 'patient' },
  })),
};
const other = { ...patient, id: 'b', displayName: 'Other Patient' };
const records = [
  {
    id: 'first',
    patientId: 'a',
    title: 'Renamed report [1].pdf',
    originalTitle: 'original.filename.pdf',
    categoryId: 'lab',
    categoryName: 'Laboratory',
    createdAt: '2026-04-02T12:00:00Z',
    canEdit: true,
    canView: true,
    canExport: false,
    bytes: 5,
    mimeType: 'application/pdf',
  },
  {
    id: 'second',
    patientId: 'a',
    title: 'Other report.pdf',
    categoryId: 'general',
    categoryName: 'Unclassified',
    createdAt: '2026-04-03T12:00:00Z',
    canView: true,
    canExport: false,
    bytes: 5,
    mimeType: 'application/pdf',
  },
];
async function setup(page: Page) {
  let rows = structuredClone(records);
  let patchStatus = 200;
  let listStatus = 200;
  let patientGate: Promise<void> | undefined;
  let listGate: Promise<void> | undefined;
  let releasePatients: (() => void) | undefined;
  let releaseList: (() => void) | undefined;
  const listUrls: string[] = [];
  const saves: unknown[] = [];
  await page.route('**/api/patients/*/documents/search', (route) =>
    route.fulfill({ json: { documentIds: [], truncated: false } }),
  );
  await page.route('**/api/auth/bootstrap', (route) =>
    route.fulfill({ json: { enabled: true, csrf: 'c'.repeat(43) } }),
  );
  await page.route('**/api/auth/account', (route) =>
    route.fulfill({
      json: { email: 'fixture@example.test', contextId: 'browsing-session' },
    }),
  );
  await page.route('**/api/patients', async (route) => {
    if (patientGate) await patientGate;
    await route.fulfill({ json: { patients: [patient, other] } });
  });
  await page.route('**/api/patients/*/documents', async (route) => {
    listUrls.push(route.request().url());
    if (listGate) await listGate;
    await route.fulfill({
      status: listStatus,
      json: {
        documents: route.request().url().includes('/a/') ? rows : [],
        storageReady: true,
      },
    });
  });
  await page.route('**/api/patients/*/documents/*/title', async (route) => {
    expect(route.request().method()).toBe('PATCH');
    expect(route.request().headers()['x-csrf-token']).toBe('c'.repeat(43));
    const body = route.request().postDataJSON() as { title: string };
    expect(Object.keys(body)).toEqual(['title']);
    saves.push(body);
    if (patchStatus === 200)
      rows = rows.map((row) =>
        row.id === 'first' ? { ...row, title: body.title } : row,
      );
    await route.fulfill({
      status: patchStatus,
      json: patchStatus === 200 ? { saved: true } : {},
    });
  });
  await page.goto('/#documents');
  await page
    .getByRole('button', { name: 'Select patient: No patient selected' })
    .click();
  await page
    .getByRole('button', { name: /Browsing Patient \(Your profile\)/ })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Edit title Renamed report [1].pdf',
      exact: true,
    }),
  ).toBeVisible();
  return {
    listUrls,
    saves,
    failSave: (status: number) => {
      patchStatus = status;
    },
    empty: () => {
      rows = [];
    },
    denyList: () => {
      listStatus = 404;
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
    holdList: () => {
      listGate = new Promise<void>((resolve) => {
        releaseList = resolve;
      });
    },
    releaseList: () => {
      listGate = undefined;
      releaseList?.();
    },
  };
}
const edit = (page: Page) =>
  page.getByRole('button', {
    name: 'Edit title Renamed report [1].pdf',
    exact: true,
  });

test('actual App filters only authorized local records by original filename, literal text, category and inclusive local dates', async ({
  page,
}) => {
  const api = await setup(page);
  await expect(
    page.getByRole('button', { name: 'Edit title Other report.pdf' }),
  ).toHaveCount(0);
  const count = api.listUrls.length;
  await page
    .getByRole('searchbox', { name: 'Search documents' })
    .fill(' ORIGINAL.FILENAME ');
  await expect(edit(page)).toBeVisible();
  await expect(page.getByText('Other report.pdf', { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('searchbox', { name: 'Search documents' }).fill('[1]');
  await expect(edit(page)).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search documents' }).fill('.*');
  await expect(
    page.getByText(/No documents match these filters/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Category', { exact: true }).selectOption('general');
  await expect(
    page.getByText('Other report.pdf', { exact: true }),
  ).toBeVisible();
  await expect(edit(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  const day = await page.evaluate((date) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, records[0]!.createdAt);
  await page.getByLabel('Uploaded from').fill(day);
  await page.getByLabel('Uploaded through').fill(day);
  await expect(edit(page)).toBeVisible();
  await expect(page.getByText('Other report.pdf', { exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel('Uploaded from').fill('2026-04-04');
  await expect(page.getByRole('alert')).toContainText('start date');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByText('2 documents shown')).toBeVisible();
  expect(api.listUrls).toHaveLength(count);
  expect(api.listUrls.every((url) => !new URL(url).search)).toBe(true);
  expect(page.url()).toMatch(/\/#documents$/);
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  for (const value of [
    'original.filename',
    '[1]',
    '2026-04',
    'Browsing Patient',
  ])
    expect(storage).not.toContain(value);
  api.empty();
  await page.reload();
  await page
    .getByRole('button', { name: 'Select patient: No patient selected' })
    .click();
  await page
    .getByRole('button', { name: /Browsing Patient \(Your profile\)/ })
    .click();
  await expect(
    page.getByText('No documents are available for this patient.'),
  ).toBeVisible();
});

test('actual App edit supports keyboard cancel, retry, original search and list refresh', async ({
  page,
}) => {
  const api = await setup(page);
  await edit(page).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('dialog', { name: 'Edit document title' }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Document title', { exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(edit(page)).toBeFocused();
  await edit(page).click();
  await page
    .getByLabel('Document title', { exact: true })
    .fill('  Updated display title  ');
  api.failSave(503);
  await page.getByRole('button', { name: 'Save title', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'try again',
  );
  await expect(page.getByLabel('Document title', { exact: true })).toHaveValue(
    '  Updated display title  ',
  );
  api.failSave(200);
  const reads = api.listUrls.length;
  await page.getByRole('button', { name: 'Save title', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Edit title Updated display title' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Edit title Updated display title' }),
  ).toBeFocused();
  expect(api.listUrls.length).toBeGreaterThan(reads);
  expect(api.saves).toEqual([
    { title: 'Updated display title' },
    { title: 'Updated display title' },
  ]);
  await page
    .getByRole('searchbox', { name: 'Search documents' })
    .fill('original.filename');
  await expect(
    page.getByRole('button', { name: 'Edit title Updated display title' }),
  ).toBeVisible();
});

test('renaming a row out of its active search restores focus to the search field', async ({
  page,
}) => {
  await setup(page);
  const search = page.getByRole('searchbox', { name: 'Search documents' });
  await search.fill('Renamed report');
  await edit(page).click();
  await page
    .getByLabel('Document title', { exact: true })
    .fill('Different display name');
  await page.getByRole('button', { name: 'Save title', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByText(/No documents match these filters/),
  ).toBeVisible();
  await expect(search).toBeFocused();
});

test('focus revalidation preserves draft but disables save, and permission denial clears edit and records', async ({
  page,
}) => {
  const api = await setup(page);
  await edit(page).click();
  await page
    .getByLabel('Document title', { exact: true })
    .fill('Private draft');
  api.holdPatients();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByRole('button', { name: /Save title|Saving/ }),
  ).toBeDisabled();
  await expect(page.getByLabel('Document title', { exact: true })).toHaveValue(
    'Private draft',
  );
  api.releasePatients();
  await expect(page.getByRole('button', { name: 'Save title' })).toBeEnabled();
  await expect(page.getByLabel('Document title', { exact: true })).toHaveValue(
    'Private draft',
  );
  api.failSave(404);
  await page.getByRole('button', { name: 'Save title' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText(
    'unavailable for your current access',
  );
  await expect(edit(page)).toHaveCount(0);
  await expect(page.getByText('Other report.pdf', { exact: true })).toHaveCount(
    0,
  );
});

test('patient switch clears filter and draft, and delayed old list cannot leak into next patient', async ({
  page,
}) => {
  const api = await setup(page);
  await page
    .getByRole('searchbox', { name: 'Search documents' })
    .fill('original.filename');
  await edit(page).click();
  await page
    .getByLabel('Document title', { exact: true })
    .fill('Private previous draft');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  api.holdList();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', { name: /Select patient:/ }).click();
  await page
    .getByRole('button', { name: /Other Patient \(Your profile\)/ })
    .click();
  api.releaseList();
  await expect(
    page.getByText('No documents are available for this patient.'),
  ).toBeVisible();
  await expect(
    page.getByRole('searchbox', { name: 'Search documents' }),
  ).toHaveValue('');
  await expect(page.getByText('Private previous draft')).toHaveCount(0);
  await expect(edit(page)).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const)
  test(`browsing and title dialog fit 320,390,desktop and pass axe in ${theme}`, async ({
    page,
  }, testInfo) => {
    await setup(page);
    if (theme === 'dark')
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(
        page.getByRole('searchbox', { name: 'Search documents' }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      await page.screenshot({
        path: `../../.local/screenshots/documents-browsing-${theme}-${width}-${testInfo.project.name}.png`,
        fullPage: true,
      });
      if (width === 320) {
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
              .analyze()
          ).violations,
        ).toEqual([]);
        await edit(page).click();
        await expect(
          page.getByLabel('Document title', { exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
        ).toBe(false);
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
              .analyze()
          ).violations,
        ).toEqual([]);
        await page.screenshot({
          path: `../../.local/screenshots/documents-browsing-${theme}-320-editor-${testInfo.project.name}.png`,
          fullPage: true,
        });
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      }
    }
    await edit(page).click();
    await expect(
      page.getByRole('dialog', { name: 'Edit document title' }),
    ).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  });
