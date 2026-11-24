import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type {
  DocumentSearchInput,
  DocumentSummary,
  PatientSummary,
} from '@fmv/contracts';

const patient: PatientSummary = {
  id: 'overview-search-patient',
  displayName: 'SYNTHETIC Overview Patient',
  relationship: 'self',
  capabilities: [
    { action: 'view', scope: { kind: 'patient' } },
    { action: 'export', scope: { kind: 'patient' } },
  ],
};
const other: PatientSummary = {
  ...patient,
  id: 'overview-search-other',
  displayName: 'SYNTHETIC Other Patient',
};
const savedId = '10000000-0000-4000-8000-000000000001',
  filenameId = '10000000-0000-4000-8000-000000000002',
  unrelatedId = '10000000-0000-4000-8000-000000000003',
  otherId = '10000000-0000-4000-8000-000000000004';
const createDocument = (
  id: string,
  title: string,
  patientId = patient.id,
): DocumentSummary => ({
  id,
  patientId,
  title,
  originalTitle: title,
  categoryId: '20000000-0000-4000-8000-000000000001',
  categoryName: 'SYNTHETIC Category',
  mimeType: 'application/pdf',
  bytes: 100,
  createdAt: '2026-11-18T12:00:00.000Z',
  canView: true,
  canExport: true,
});
const records = [
  createDocument(savedId, 'SYNTHETIC saved original.pdf'),
  {
    ...createDocument(filenameId, 'SYNTHETIC needle filename.pdf'),
    canView: false,
  },
  createDocument(unrelatedId, 'SYNTHETIC unrelated scan.pdf'),
];
const otherDocument = createDocument(
  otherId,
  'SYNTHETIC other original.pdf',
  other.id,
);
const search = (page: Page) =>
  page.getByRole('searchbox', { name: 'Search documents', exact: true });
const submit = (page: Page) =>
  page.getByRole('button', {
    name: 'Search selected patient documents',
    exact: true,
  });
const savedSource = (page: Page) =>
  page.getByRole('button', {
    name: 'Saved text SYNTHETIC saved original.pdf',
    exact: true,
  });
const filename = (page: Page) =>
  page.getByText('SYNTHETIC needle filename.pdf', { exact: true });

async function select(page: Page, selected: PatientSummary) {
  await page.getByRole('button', { name: /^Select patient:/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', {
      name: `${selected.displayName} (Your profile)`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('button', {
      name: `Select patient: ${selected.displayName}`,
      exact: true,
    }),
  ).toBeVisible();
}

async function privateQuery(page: Page, query = 'needle') {
  const url = new URL(page.url());
  expect(url.search).toBe('');
  expect(url.hash).toBe('#documents');
  expect(page.url()).not.toContain(query);
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toContain(query);
}

async function submitWithRevalidation(page: Page) {
  await search(page).evaluate((input) => {
    const form = (input as HTMLInputElement).form;
    if (!form) throw Error('Synthetic Overview search requires a form');
    form.requestSubmit();
    window.dispatchEvent(new Event('focus'));
  });
}

async function setup(page: Page) {
  const errors: string[] = [],
    urls: string[] = [];
  const requests: { patientId: string; body: DocumentSearchInput }[] = [];
  let patients = [patient, other],
    searchStatus = 200;
  let patientsGate: Promise<void> | undefined,
    documentsGate: Promise<void> | undefined;
  let releasePatients = () => {},
    releaseDocuments = () => {};
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Catch every API request before loading the real Auth/Patient providers.
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    urls.push(request.url());
    const json = (value: unknown, status = 200) =>
      route.fulfill({ status, json: value }).catch(() => {});
    if (path === '/api/auth/bootstrap')
      return json({ enabled: true, csrf: 'c'.repeat(43) });
    if (path === '/api/auth/account')
      return json({
        email: 'fixture@example.test',
        contextId: 'overview-search-context',
      });
    if (path === '/api/patients') {
      if (patientsGate) await patientsGate;
      return json({ patients });
    }
    const match = /^\/api\/patients\/([^/]+)\/documents(\/search)?$/.exec(path);
    if (match) {
      const patientId = decodeURIComponent(match[1]!);
      if (match[2]) {
        expect(request.method()).toBe('POST');
        expect(url.search).toBe('');
        expect(request.headers()['x-csrf-token']).toBe('c'.repeat(43));
        expect(request.headers()['content-type']).toBe('application/json');
        requests.push({
          patientId,
          body: request.postDataJSON() as DocumentSearchInput,
        });
        return json(
          searchStatus === 200
            ? {
                documentIds: patientId === patient.id ? [savedId] : [],
                truncated: false,
              }
            : {},
          searchStatus,
        );
      }
      const documents =
        patientId === patient.id
          ? records
          : patientId === other.id
            ? [otherDocument]
            : [];
      if (patientId === patient.id && documentsGate) await documentsGate;
      return json({ documents, storageReady: true });
    }
    if (path.endsWith('/categories')) return json({ categories: [] });
    if (path.endsWith('/trash')) return json({ documents: [] });
    return json({}, 404);
  });
  await page.goto('/#overview');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Overview', exact: true }),
  ).toBeVisible();
  return {
    errors,
    requests,
    urls,
    failTextSearch() {
      searchStatus = 503;
    },
    revokePatient() {
      patients = [other];
    },
    holdPatients() {
      patientsGate = new Promise<void>((resolve) => {
        releasePatients = resolve;
      });
    },
    releasePatients() {
      patientsGate = undefined;
      releasePatients();
    },
    holdDocuments() {
      documentsGate = new Promise<void>((resolve) => {
        releaseDocuments = resolve;
      });
    },
    releaseDocuments() {
      documentsGate = undefined;
      releaseDocuments();
    },
  };
}

test('Overview search stays disabled without a patient and during patient revalidation', async ({
  page,
}) => {
  const api = await setup(page);
  await expect(search(page)).toBeDisabled();
  await expect(submit(page)).toBeDisabled();
  await select(page, patient);
  await expect(search(page)).toBeEnabled();
  await search(page).fill('needle');
  api.holdPatients();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(search(page)).toBeDisabled();
  await expect(submit(page)).toBeDisabled();
  api.releasePatients();
  await expect(search(page)).toBeEnabled();
  expect(api.requests).toEqual([]);
  expect(api.errors).toEqual([]);
});

for (const method of ['keyboard', 'button'] as const)
  test(`Overview ${method} submission seeds the selected patient's metadata and saved-text search privately`, async ({
    page,
  }) => {
    const api = await setup(page);
    await select(page, patient);
    await search(page).fill('needle');
    if (method === 'keyboard') await search(page).press('Enter');
    else await submit(page).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Documents', exact: true }),
    ).toBeVisible();
    await expect(search(page)).toHaveValue('needle');
    await expect(filename(page)).toBeVisible();
    await expect(savedSource(page)).toBeVisible();
    await expect(
      page.getByText('SYNTHETIC unrelated scan.pdf', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('2 documents shown', { exact: true }),
    ).toBeVisible();
    expect(api.requests).toEqual([
      { patientId: patient.id, body: { query: 'needle' } },
    ]);
    expect(api.urls.every((url) => !url.includes('needle'))).toBe(true);
    await privateQuery(page);
    expect(api.errors).toEqual([]);
  });

test('switching patients clears submitted search and never searches the new patient with the old term', async ({
  page,
}) => {
  const api = await setup(page);
  await select(page, patient);
  await search(page).fill('needle');
  await submit(page).click();
  await expect(savedSource(page)).toBeVisible();
  await select(page, other);
  await expect(search(page)).toHaveValue('');
  await expect(
    page.getByText(otherDocument.title, { exact: true }),
  ).toBeVisible();
  await expect(savedSource(page)).toHaveCount(0);
  await select(page, patient);
  await expect(search(page)).toHaveValue('');
  await expect(
    page.getByText('SYNTHETIC unrelated scan.pdf', { exact: true }),
  ).toBeVisible();
  expect(api.requests).toEqual([
    { patientId: patient.id, body: { query: 'needle' } },
  ]);
  expect(api.errors).toEqual([]);
});

test('Back then ordinary Documents navigation does not replay a consumed Overview submission', async ({
  page,
  isMobile,
}) => {
  const api = await setup(page);
  await select(page, patient);
  await search(page).fill('needle');
  await submit(page).click();
  await expect(savedSource(page)).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Overview', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation', {
      name: isMobile ? 'Mobile navigation' : 'Main navigation',
      exact: true,
    })
    .getByRole('link', {
      name: isMobile ? 'Docs (Documents)' : 'Documents',
      exact: true,
    })
    .click();
  await expect(search(page)).toHaveValue('');
  await expect(
    page.getByText('3 documents shown', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('SYNTHETIC unrelated scan.pdf', { exact: true }),
  ).toBeVisible();
  expect(api.requests).toEqual([
    { patientId: patient.id, body: { query: 'needle' } },
  ]);
  await privateQuery(page);
  expect(api.errors).toEqual([]);
});

test('saved-text failure keeps filename matching usable with the existing incomplete-results notice', async ({
  page,
}) => {
  const api = await setup(page);
  api.failTextSearch();
  await select(page, patient);
  await search(page).fill('needle');
  await submit(page).click();
  await expect(page.getByText(/Results are incomplete/)).toBeVisible();
  await expect(filename(page)).toBeVisible();
  await expect(savedSource(page)).toHaveCount(0);
  await expect(search(page)).toBeEnabled();
  await search(page).fill('needle filename');
  await expect(filename(page)).toBeVisible();
  await expect
    .poll(() => api.requests.at(-1)?.body.query)
    .toBe('needle filename');
  await expect(
    page.getByRole('button', { name: 'Retry saved text search', exact: true }),
  ).toBeVisible();
  await privateQuery(page, 'needle filename');
  expect(api.errors).toEqual([]);
});

test('patient revocation while the first document list is pending cannot seed another patient', async ({
  page,
}) => {
  const api = await setup(page);
  await select(page, patient);
  api.holdDocuments();
  await search(page).fill('needle');
  api.holdPatients();
  api.revokePatient();
  await submitWithRevalidation(page);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Documents', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Select patient: No patient selected',
      exact: true,
    }),
  ).toBeVisible();
  api.releasePatients();
  await select(page, other);
  await expect(search(page)).toHaveValue('');
  await expect(
    page.getByText(otherDocument.title, { exact: true }),
  ).toBeVisible();
  api.releaseDocuments();
  await expect(search(page)).toHaveValue('');
  await expect(savedSource(page)).toHaveCount(0);
  expect(api.requests).toEqual([]);
  await privateQuery(page);
  expect(api.errors).toEqual([]);
});

test('a submitted search survives held focus revalidation while Documents mounts for the same patient', async ({
  page,
}) => {
  const api = await setup(page);
  await select(page, patient);
  await search(page).fill('needle');
  api.holdPatients();
  await submitWithRevalidation(page);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Documents', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Select patient: No patient selected',
      exact: true,
    }),
  ).toBeVisible();
  expect(api.requests).toEqual([]);
  api.releasePatients();
  await expect(search(page)).toHaveValue('needle');
  await expect(savedSource(page)).toBeVisible();
  await expect(filename(page)).toBeVisible();
  expect(api.requests).toEqual([
    { patientId: patient.id, body: { query: 'needle' } },
  ]);
  await privateQuery(page);
  expect(api.errors).toEqual([]);
});

for (const theme of ['light', 'dark'] as const)
  test(`Overview search and its result handoff fit the viewport and pass axe in ${theme}`, async ({
    page,
  }, info) => {
    const api = await setup(page);
    await select(page, patient);
    if (theme === 'dark')
      await page
        .getByRole('button', { name: 'Switch to dark theme', exact: true })
        .click();
    await search(page).fill('needle');
    await expect(submit(page)).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: `../../.local/screenshots/overview-search-${theme}-${info.project.name}.png`,
      fullPage: true,
    });
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 320, height: 1000 });
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
    await page.setViewportSize(viewport);
    await submit(page).click();
    await expect(savedSource(page)).toBeVisible();
    await expect(filename(page)).toBeVisible();
    await page.screenshot({
      path: `../../.local/screenshots/overview-search-results-${theme}-${info.project.name}.png`,
      fullPage: true,
    });
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    await privateQuery(page);
    expect(api.errors).toEqual([]);
  });
