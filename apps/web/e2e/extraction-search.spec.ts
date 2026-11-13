import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { DocumentSearchInput, DocumentSummary } from '@fmv/contracts';

test.use({ timezoneId: 'America/New_York' });

const textId = '10000000-0000-4000-8000-000000000001';
const metadataId = '10000000-0000-4000-8000-000000000002';
const restrictedId = '10000000-0000-4000-8000-000000000003';
const foreignId = '10000000-0000-4000-8000-000000000099';
const categoryId = '20000000-0000-4000-8000-000000000001';
const otherCategoryId = '20000000-0000-4000-8000-000000000002';
const patient = {
  id: 'search-patient',
  displayName: 'Search Fixture Patient',
  relationship: 'self',
  capabilities: ['view', 'export'].map((action) => ({
    action,
    scope: { kind: 'patient' },
  })),
};
const other = { ...patient, id: 'other-patient', displayName: 'Other Fixture' };
const records: DocumentSummary[] = [
  {
    id: textId,
    patientId: patient.id,
    title: 'Synthetic saved source.pdf',
    originalTitle: 'Original synthetic.pdf',
    categoryId,
    categoryName: 'Laboratory',
    mimeType: 'application/pdf',
    bytes: 500,
    createdAt: '2026-03-08T12:00:00.000Z',
    canView: true,
    canExport: true,
  },
  {
    id: metadataId,
    patientId: patient.id,
    title: 'Needle filename.pdf',
    categoryId: otherCategoryId,
    categoryName: 'Unclassified',
    mimeType: 'application/pdf',
    bytes: 500,
    createdAt: '2026-03-09T12:00:00.000Z',
    canView: false,
    canExport: true,
  },
  {
    id: restrictedId,
    patientId: patient.id,
    title: 'Restricted source.pdf',
    categoryId,
    categoryName: 'Laboratory',
    mimeType: 'application/pdf',
    bytes: 500,
    createdAt: '2026-03-08T12:00:00.000Z',
    canView: false,
    canExport: true,
  },
];
const source = (page: Page) =>
  page.getByRole('button', {
    name: 'Saved text Synthetic saved source.pdf',
    exact: true,
  });
const search = (page: Page) =>
  page.getByRole('searchbox', { name: 'Search documents' });

async function setup(page: Page, exportOnly = false) {
  let rows = records.map((record) => ({
    ...record,
    canView: exportOnly ? false : record.canView,
  }));
  let result: unknown = { documentIds: [textId], truncated: false };
  let status = 200;
  let patientGate: Promise<void> | undefined;
  let releasePatients = () => {};
  let searchGate: Promise<void> | undefined;
  let releaseSearch = () => {};
  const requests: DocumentSearchInput[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/auth/bootstrap', (route) =>
    route.fulfill({ json: { enabled: true, csrf: 'c'.repeat(43) } }),
  );
  await page.route('**/api/auth/account', (route) =>
    route.fulfill({
      json: { email: 'fixture@example.test', contextId: 'search-context' },
    }),
  );
  await page.route('**/api/patients', async (route) => {
    if (patientGate) await patientGate;
    await route.fulfill({ json: { patients: [patient, other] } });
  });
  await page.route('**/api/patients/*/documents', (route) =>
    route.fulfill({
      json: {
        documents: route.request().url().includes('/search-patient/')
          ? rows
          : [],
        storageReady: true,
      },
    }),
  );
  await page.route('**/api/patients/*/trash', (route) =>
    route.fulfill({ json: { documents: [] } }),
  );
  await page.route('**/api/patients/*/documents/search', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(new URL(route.request().url()).search).toBe('');
    expect(route.request().headers()['x-csrf-token']).toBe('c'.repeat(43));
    expect(route.request().headers()['content-type']).toBe('application/json');
    requests.push(route.request().postDataJSON() as DocumentSearchInput);
    const response = { status, json: structuredClone(result) };
    if (searchGate) await searchGate;
    await route.fulfill(response).catch(() => {});
  });
  await page.route('**/api/patients/*/documents/*/extraction', (route) =>
    route.fulfill({
      json: {
        context: {
          sourceSha256: 'a'.repeat(64),
          lifecycleVersion: 0,
          revision: 1,
          canSave: false,
        },
        snapshot: {
          method: 'pdf-text',
          engineVersion: 'pdfjs-6.5.438',
          pages: [
            { page: 1, text: 'Synthetic needle saved text <b>literal</b>' },
          ],
          partial: false,
          partialReason: null,
          downsized: false,
          revision: 1,
          sourceSha256: 'a'.repeat(64),
          savedAt: '2026-11-13T00:00:00.000Z',
          unverified: true,
        },
      },
    }),
  );
  await page.goto('/#documents');
  await page
    .getByRole('button', { name: 'Select patient: No patient selected' })
    .click();
  await page
    .getByRole('button', { name: /Search Fixture Patient \(Your profile\)/ })
    .click();
  await expect(page.getByText('3 documents shown')).toBeVisible();
  return {
    requests,
    errors,
    result: (next: unknown) => {
      result = next;
    },
    status: (next: number) => {
      status = next;
    },
    hold: () => {
      searchGate = new Promise<void>((resolve) => {
        releaseSearch = resolve;
      });
    },
    release: () => {
      searchGate = undefined;
      releaseSearch();
    },
    holdPatients: () => {
      patientGate = new Promise<void>((resolve) => {
        releasePatients = resolve;
      });
    },
    releasePatients: () => {
      patientGate = undefined;
      releasePatients();
    },
    revoke: () => {
      rows = rows.map((row) => ({ ...row, canView: false }));
    },
  };
}

test('saved text IDs union with metadata, respect View and current list, and open existing unverified source safely', async ({
  page,
}) => {
  const api = await setup(page);
  expect(api.requests).toEqual([]);
  api.result({
    documentIds: [textId, metadataId, restrictedId, foreignId],
    truncated: false,
  });
  await search(page).fill('  Needle  ');
  await expect(source(page)).toBeVisible();
  await expect(
    page.getByText('Needle filename.pdf', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Restricted source.pdf', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('Saved text match · Unverified', { exact: true }),
  ).toHaveCount(1);
  expect(api.requests).toEqual([{ query: 'Needle' }]);
  await source(page).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Saved text', exact: true });
  await expect(
    dialog.getByText('Synthetic needle saved text <b>literal</b>', {
      exact: true,
    }),
  ).toBeVisible();
  expect(await dialog.locator('b').count()).toBe(0);
  await page.keyboard.press('Escape');
  await expect(source(page)).toBeFocused();
  expect(api.errors).toEqual([]);
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toContain('Needle');
  expect(page.url()).toMatch(/\/#documents$/);
});

test('debounces query and immediately hides old IDs across query/category/date changes', async ({
  page,
}) => {
  const api = await setup(page);
  await search(page).fill('needle');
  await expect(source(page)).toBeVisible();
  api.hold();
  await search(page).fill('new term');
  await expect(source(page)).toHaveCount(0);
  await expect.poll(() => api.requests.length).toBe(2);
  await page
    .getByLabel('Category', { exact: true })
    .selectOption(otherCategoryId);
  api.release();
  await expect(source(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await search(page).fill('needle');
  await expect(source(page)).toBeVisible();
  api.hold();
  await page.getByLabel('Uploaded from').fill('2026-03-09');
  await expect(source(page)).toHaveCount(0);
  api.release();
  await expect(source(page)).toHaveCount(0);
  const count = api.requests.length;
  await search(page).fill('n');
  await search(page).fill('ne');
  await search(page).fill('need');
  await page.waitForTimeout(350);
  // The date filter has no View-eligible document, so no server request is made.
  expect(api.requests).toHaveLength(count);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  const before = api.requests.length;
  await search(page).fill('n');
  await search(page).fill('ne');
  await search(page).fill('needle');
  await expect(source(page)).toBeVisible();
  expect(api.requests).toHaveLength(before + 1);
});

test('server filters use inclusive and exclusive local midnights across DST', async ({
  page,
}) => {
  const api = await setup(page);
  await page.getByLabel('Category', { exact: true }).selectOption(categoryId);
  await page.getByLabel('Uploaded from').fill('2026-03-08');
  await page.getByLabel('Uploaded through').fill('2026-03-08');
  await search(page).fill('needle');
  await expect(source(page)).toBeVisible();
  const dates = await page.evaluate(() => ({
    uploadedFrom: new Date(2026, 2, 8).toISOString(),
    uploadedBefore: new Date(2026, 2, 9).toISOString(),
  }));
  expect(api.requests).toEqual([{ query: 'needle', categoryId, ...dates }]);
  expect(
    Date.parse(dates.uploadedBefore) - Date.parse(dates.uploadedFrom),
  ).toBe(23 * 60 * 60 * 1000);
  await page.getByLabel('Uploaded from').fill('2026-03-10');
  await expect(page.getByRole('alert')).toContainText('start date');
  await expect(source(page)).toHaveCount(0);
  await page.waitForTimeout(350);
  expect(api.requests).toHaveLength(1);
});

test('failure and invalid responses leave titles usable and recover only through explicit retry', async ({
  page,
}) => {
  const api = await setup(page);
  api.status(503);
  await search(page).fill('needle');
  await expect(page.getByText(/Results are incomplete/)).toBeVisible();
  await expect(
    page.getByText('Needle filename.pdf', { exact: true }),
  ).toBeVisible();
  await expect(source(page)).toHaveCount(0);
  api.status(200);
  api.result({ documentIds: [textId, textId], truncated: false });
  const retry = page.getByRole('button', {
    name: 'Retry saved text search',
    exact: true,
  });
  await retry.click();
  await expect(page.getByText(/Results are incomplete/)).toBeVisible();
  await expect(source(page)).toHaveCount(0);
  api.result({ documentIds: [textId], truncated: true });
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(source(page)).toBeVisible();
  await expect(page.getByText(/Refine your search or filters/)).toBeVisible();
  expect(api.requests).toHaveLength(3);
  expect(api.errors).toEqual([]);
});

test('focus revalidation clears saved text IDs immediately and View revocation prevents replacement requests', async ({
  page,
}) => {
  const api = await setup(page);
  await search(page).fill('needle');
  await expect(source(page)).toBeVisible();
  api.holdPatients();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(source(page)).toHaveCount(0);
  api.revoke();
  api.releasePatients();
  await expect(
    page.getByText('Needle filename.pdf', { exact: true }),
  ).toBeVisible();
  await expect(source(page)).toHaveCount(0);
  await page.waitForTimeout(350);
  expect(api.requests).toHaveLength(1);
});

test('switching to Trash or another patient cancels late hits and sends no empty or export-only search', async ({
  page,
}) => {
  const api = await setup(page, true);
  await search(page).fill('needle');
  await expect(
    page.getByText('Needle filename.pdf', { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(350);
  expect(api.requests).toEqual([]);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByText('3 documents shown')).toBeVisible();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(search(page)).toHaveCount(0);
  expect(api.requests).toEqual([]);
  await page
    .getByRole('button', { name: 'Active documents', exact: true })
    .click();
  await expect(search(page)).toHaveValue('');
  await page.getByRole('button', { name: /Select patient:/ }).click();
  await page
    .getByRole('button', { name: /Other Fixture \(Your profile\)/ })
    .click();
  await expect(
    page.getByText('No documents are available for this patient.'),
  ).toBeVisible();
  expect(api.requests).toEqual([]);
});

test('late responses after switching patient or Trash cannot restore text matches', async ({
  page,
}) => {
  const api = await setup(page);
  api.hold();
  await search(page).fill('needle');
  await expect.poll(() => api.requests.length).toBe(1);
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  api.release();
  await expect(
    page.getByText('Saved text match · Unverified', { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Active documents', exact: true })
    .click();
  await expect(source(page)).toBeVisible();
  api.hold();
  await search(page).fill('other text');
  await expect.poll(() => api.requests.length).toBe(3);
  await page.getByRole('button', { name: /Select patient:/ }).click();
  await page
    .getByRole('button', { name: /Other Fixture \(Your profile\)/ })
    .click();
  api.release();
  await expect(
    page.getByText('No documents are available for this patient.'),
  ).toBeVisible();
  await expect(search(page)).toHaveValue('');
  await expect(source(page)).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const)
  test(`search recovery and results fit mobile/desktop and pass axe in ${theme}`, async ({
    page,
  }, testInfo) => {
    const api = await setup(page);
    if (theme === 'dark')
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await search(page).fill('needle');
    await expect(source(page)).toBeVisible();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(source(page)).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      await page.screenshot({
        path: `../../.local/screenshots/extraction-search-${theme}-${width}-${testInfo.project.name}.png`,
        fullPage: true,
      });
      if (width === 320)
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
              .analyze()
          ).violations,
        ).toEqual([]);
    }
    api.status(503);
    await search(page).fill('Needle filename');
    await expect(
      page.getByRole('button', {
        name: 'Retry saved text search',
        exact: true,
      }),
    ).toBeVisible();
    await page.setViewportSize({ width: 320, height: 1000 });
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(api.errors).toEqual([]);
  });

function syntheticPdf() {
  const text = 'Synthetic replacement needle';
  const stream = `BT /F1 12 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = objects.map((o, i) => {
    const at = Buffer.byteLength(output);
    output += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const at = Buffer.byteLength(output);
  output += `xref\n0 6\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
  return Buffer.from(output);
}

test('denied search clears protected metadata instead of offering title-only fallback', async ({
  page,
}) => {
  const api = await setup(page);
  api.status(404);
  await search(page).fill('Needle filename');
  await expect(
    page.getByText(
      'Document access is no longer available. Refresh and try again.',
    ),
  ).toBeVisible();
  await expect(
    page.getByText('Needle filename.pdf', { exact: true }),
  ).toHaveCount(0);
  await expect(source(page)).toHaveCount(0);
  api.status(200);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByText('Needle filename.pdf', { exact: true }),
  ).toBeVisible();
});

test('a stalled search times out and ignores its late result before explicit retry', async ({
  page,
}) => {
  const api = await setup(page);
  await page.clock.install();
  api.hold();
  await search(page).fill('needle');
  await page.clock.runFor(300);
  await expect.poll(() => api.requests.length).toBe(1);
  await page.clock.runFor(15001);
  await expect(
    page.getByRole('button', { name: 'Retry saved text search', exact: true }),
  ).toBeVisible();
  api.release();
  await expect(source(page)).toHaveCount(0);
  api.result({ documentIds: [], truncated: false });
  await page
    .getByRole('button', { name: 'Retry saved text search', exact: true })
    .click();
  await page.clock.runFor(300);
  await expect(
    page.getByText(
      'Searching saved text… Title and filename matches are available.',
    ),
  ).toHaveCount(0);
  await expect(source(page)).toHaveCount(0);
});

for (const initialMatch of [true, false])
  test(`successful Save refreshes the unchanged query after ${initialMatch ? 'replacing' : 'creating'} a text match`, async ({
    page,
  }) => {
    const api = await setup(page);
    api.result({ documentIds: initialMatch ? [textId] : [], truncated: false });
    await page.route(
      '**/api/patients/*/documents/*/extraction/context',
      (route) =>
        route.fulfill({
          json: {
            context: {
              sourceSha256: 'a'.repeat(64),
              lifecycleVersion: 0,
              revision: 1,
              canSave: true,
            },
          },
        }),
    );
    await page.route('**/api/patients/*/documents/*/preview', (route) =>
      route.fulfill({ contentType: 'application/pdf', body: syntheticPdf() }),
    );
    await page.route(
      '**/api/patients/*/documents/*/extraction',
      async (route) => {
        if (route.request().method() !== 'PUT') return route.fallback();
        api.result({
          documentIds: initialMatch ? [] : [textId],
          truncated: false,
        });
        await route.fulfill({ json: { saved: true, revision: 2 } });
      },
    );
    const query = initialMatch ? 'needle' : 'Synthetic';
    await search(page).fill(query);
    if (initialMatch) await expect(source(page)).toBeVisible();
    else
      await expect(
        page.getByText(
          'Saved text matches all search words across saved pages.',
          { exact: false },
        ),
      ).toBeVisible();
    const before = api.requests.length;
    await page
      .getByRole('button', {
        name: 'Extract text Synthetic saved source.pdf',
        exact: true,
      })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Extracted text',
      exact: true,
    });
    await expect(
      dialog.getByText('Synthetic replacement needle', { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Save text', exact: true })
      .click();
    await expect(dialog).toContainText('Unverified text saved');
    await expect.poll(() => api.requests.length).toBeGreaterThan(before);
    await page.keyboard.press('Escape');
    if (initialMatch) await expect(source(page)).toHaveCount(0);
    else
      await expect(
        page.getByText('Saved text match · Unverified', { exact: true }),
      ).toHaveCount(1);
    await expect(search(page)).toHaveValue(query);
    expect(api.errors).toEqual([]);
  });
