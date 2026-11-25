import AxeBuilder from '@axe-core/playwright';
import { Buffer } from 'node:buffer';
import { expect, test, type Page } from '@playwright/test';
import type { DocumentSummary, PatientSummary } from '@fmv/contracts';

const patient: PatientSummary = {
  id: 'recent-patient',
  displayName: 'SYNTHETIC Recent Patient',
  relationship: 'self',
  capabilities: ['view', 'export', 'upload'].map((action) => ({
    action: action as 'view' | 'export' | 'upload',
    scope: { kind: 'patient' },
  })),
};
const other: PatientSummary = {
  ...patient,
  id: 'recent-other',
  displayName: 'SYNTHETIC Other Patient',
};
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const record = (
  n: number,
  title: string,
  createdAt: string,
  patch: Partial<DocumentSummary> = {},
): DocumentSummary => ({
  id: id(n),
  patientId: patient.id,
  title,
  originalTitle: title,
  mimeType: 'application/pdf',
  bytes: 100,
  createdAt,
  categoryId: '20000000-0000-4000-8000-000000000001',
  categoryName: 'SYNTHETIC Laboratory',
  canView: true,
  canExport: true,
  ...patch,
});
const newest = record(
  6,
  'SYNTHETIC newest report.pdf',
  '2026-11-25T12:00:00.000Z',
);
const tieA = record(2, 'SYNTHETIC tie A.pdf', '2026-11-24T12:00:00.000Z');
const tieB = record(3, 'SYNTHETIC tie B.pdf', '2026-11-24T12:00:00.000Z');
const exportOnly = record(
  4,
  'SYNTHETIC export only.pdf',
  '2026-11-23T12:00:00.000Z',
  { canView: false },
);
const fifth = record(
  5,
  'SYNTHETIC fifth report.pdf',
  '2026-11-22T12:00:00.000Z',
);
const hidden = record(
  1,
  'SYNTHETIC inaccessible record.pdf',
  '2026-11-30T12:00:00.000Z',
  { canView: false, canExport: false },
);
const old = record(7, 'SYNTHETIC old report.pdf', '2026-11-21T12:00:00.000Z');
const older = record(8, 'SYNTHETIC older scan.pdf', '2026-11-20T12:00:00.000Z');
const records = [older, tieB, hidden, fifth, newest, old, exportOnly, tieA];
const otherRecord = record(
  10,
  'SYNTHETIC other patient source.pdf',
  '2026-11-26T12:00:00.000Z',
  { patientId: other.id },
);
const uploadTitle = 'synthetic-recent-upload.pdf';
const uploaded = record(9, uploadTitle, '2026-11-26T12:00:00.000Z');
const section = (page: Page) =>
  page.getByRole('region', { name: 'Recent documents', exact: true });
const actions = (page: Page) =>
  section(page).getByRole('button', { name: /^(Open|View in Documents) / });
const open = (page: Page, document = newest) =>
  section(page).getByRole('button', {
    name: `Open ${document.title}`,
    exact: true,
  });

async function select(page: Page, selected = patient) {
  await page.getByRole('button', { name: /^Select patient:/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', {
      name: `${selected.displayName} (Your profile)`,
      exact: true,
    })
    .click();
}

async function setup(page: Page) {
  const errors: string[] = [],
    listReads: string[] = [],
    previews: string[] = [],
    downloads: string[] = [];
  const uploads: string[] = [];
  const rows = new Map<string, DocumentSummary[]>([
    [patient.id, structuredClone(records)],
    [other.id, [otherRecord]],
  ]);
  const statuses = new Map<string, number>();
  const payloads = new Map<string, unknown>();
  let patientsGate: Promise<void> | undefined,
    listGate: Promise<void> | undefined;
  let releasePatients = () => {},
    releaseList = () => {};
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const json = (value: unknown, status = 200) =>
      route.fulfill({ status, json: value }).catch(() => {});
    if (path === '/api/auth/bootstrap')
      return json({ enabled: true, csrf: 'c'.repeat(43) });
    if (path === '/api/auth/account')
      return json({
        email: 'fixture@example.test',
        contextId: 'overview-recent-context',
      });
    if (path === '/api/patients') {
      if (patientsGate) await patientsGate;
      return json({ patients: [patient, other] });
    }
    const list = /^\/api\/patients\/([^/]+)\/documents$/.exec(path);
    if (list) {
      const patientId = decodeURIComponent(list[1]!);
      expect(request.method()).toBe('GET');
      expect(new URL(request.url()).search).toBe('');
      listReads.push(patientId);
      const payload = structuredClone(
        payloads.has(patientId)
          ? payloads.get(patientId)
          : {
              documents: rows.get(patientId) ?? [],
              storageReady: true,
            },
      );
      const status = statuses.get(patientId) ?? 200;
      if (patientId === patient.id && listGate) await listGate;
      return json(payload, status);
    }
    const content =
      /^\/api\/patients\/([^/]+)\/documents\/([^/]+)\/(preview|download)$/.exec(
        path,
      );
    if (content) {
      (content[3] === 'preview' ? previews : downloads).push(path);
      return route
        .fulfill({
          contentType: 'application/pdf',
          body: '%PDF-1.4\nSYNTHETIC preview only\n%%EOF',
        })
        .catch(() => {});
    }
    if (path.endsWith('/documents/search'))
      return json({ documentIds: [], truncated: false });
    if (path.endsWith('/categories')) return json({ categories: [] });
    if (path.endsWith('/trash')) return json({ documents: [] });
    const upload =
      /^\/api\/patients\/([^/]+)\/uploads(?:\/[^/]+\/(content|finalize))?$/.exec(
        path,
      );
    if (upload) {
      uploads.push(`${request.method()} ${path}`);
      if (request.method() === 'POST' && !upload[2]) {
        expect(request.headers()['x-csrf-token']).toBe('c'.repeat(43));
        expect(request.postDataJSON().title).toBe(uploadTitle);
      }
      if (upload[2] === 'finalize')
        rows.set(patient.id, [...(rows.get(patient.id) ?? []), uploaded]);
      return json({
        uploadId: 'synthetic-upload',
        documentId: uploaded.id,
        state: upload[2] === 'finalize' ? 'ready' : 'pending',
      });
    }
    return json({}, 404);
  });
  await page.goto('/#overview');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Overview', exact: true }),
  ).toBeVisible();
  return {
    errors,
    listReads,
    previews,
    downloads,
    uploads,
    rows(next: DocumentSummary[], patientId = patient.id) {
      rows.set(patientId, next);
      payloads.delete(patientId);
    },
    status(next: number) {
      statuses.set(patient.id, next);
    },
    payload(next: unknown) {
      payloads.set(patient.id, next);
    },
    holdList() {
      listGate = new Promise<void>((resolve) => {
        releaseList = resolve;
      });
    },
    releaseList() {
      listGate = undefined;
      releaseList();
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
  };
}

test('no selected patient keeps the static medical-documents card and makes no document request', async ({
  page,
}) => {
  const api = await setup(page);
  await expect(
    page.getByRole('heading', { name: 'Medical documents', exact: true }),
  ).toBeVisible();
  await expect(section(page)).toHaveCount(0);
  expect(api.listReads).toEqual([]);
  expect(api.previews).toEqual([]);
  expect(api.downloads).toEqual([]);
  expect(api.errors).toEqual([]);
});

test('recent metadata lists the newest five eligible uploads with stable ID ties and no verification claims', async ({
  page,
}) => {
  const api = await setup(page);
  await select(page);
  const ordered = [newest, tieA, tieB, exportOnly, fifth];
  await expect(actions(page)).toHaveCount(5);
  for (const [index, document] of ordered.entries()) {
    await expect(actions(page).nth(index)).toHaveAccessibleName(
      `${document.canView ? 'Open' : 'View in Documents'} ${document.title}`,
    );
    const row = section(page).getByRole('listitem').nth(index);
    await expect(row).toContainText('SYNTHETIC Laboratory');
    await expect(row).toContainText('Uploaded');
    await expect(row.locator('time')).toHaveAttribute(
      'datetime',
      document.createdAt,
    );
    const date = await page.evaluate(
      (value) => new Date(value).toLocaleDateString(),
      document.createdAt,
    );
    await expect(row.locator('time')).toHaveText(date);
  }
  for (const document of [hidden, old, older])
    await expect(
      section(page).getByText(document.title, { exact: true }),
    ).toHaveCount(0);
  for (const label of ['Verified', 'Clinically verified', 'Reviewed'])
    await expect(section(page).getByText(label, { exact: true })).toHaveCount(
      0,
    );
  await expect(
    section(page).getByRole('link', { name: 'View all', exact: true }),
  ).toHaveAttribute('href', '#documents');
  expect(api.listReads.every((value) => value === patient.id)).toBe(true);
  expect(api.previews).toEqual([]);
  expect(api.downloads).toEqual([]);
  expect(api.errors).toEqual([]);
});

test('Open revalidates the current document list and uses the existing preview with current metadata', async ({
  page,
}) => {
  const api = await setup(page);
  await select(page);
  await expect(open(page)).toBeVisible();
  const reads = api.listReads.length;
  const current = { ...newest, title: 'SYNTHETIC current document title.pdf' };
  api.rows(
    records
      .filter((row) => row.canView || row.canExport)
      .map((row) => (row.id === newest.id ? current : row)),
  );
  await open(page).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Documents', exact: true }),
  ).toBeVisible();
  const preview = page.getByRole('dialog', {
    name: 'Document preview',
    exact: true,
  });
  await expect(preview).toContainText(current.title);
  await expect(preview.locator('iframe')).toHaveAttribute('src', /^blob:/);
  await expect(preview.locator('iframe')).toHaveAttribute('sandbox', '');
  expect(api.listReads.length).toBeGreaterThan(reads);
  expect(api.previews).toEqual([
    `/api/patients/${patient.id}/documents/${newest.id}/preview`,
  ]);
  expect(api.downloads).toEqual([]);
  expect(new URL(page.url()).hash).toBe('#documents');
  expect(new URL(page.url()).search).toBe('');
  expect(api.errors).toEqual([]);
});

for (const expandedView of [false, true])
  test(`export-only entry ${expandedView ? 'with newly granted View' : 'with unchanged access'} only focuses its current Documents row`, async ({
    page,
  }) => {
    const api = await setup(page);
    await select(page);
    const entry = section(page).getByRole('button', {
      name: `View in Documents ${exportOnly.title}`,
      exact: true,
    });
    await expect(entry).toBeVisible();
    const reads = api.listReads.length;
    api.rows(
      records
        .filter((row) => row.canView || row.canExport)
        .map((row) =>
          row.id === exportOnly.id ? { ...row, canView: expandedView } : row,
        ),
    );
    await entry.click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Documents', exact: true }),
    ).toBeVisible();
    const row = page.locator(`li[data-document-id="${exportOnly.id}"]`);
    await expect(row).toBeFocused();
    await expect(row).toHaveAttribute('tabindex', '-1');
    await expect(row).toContainText(exportOnly.title);
    await expect(
      row.getByRole('button', {
        name: `Preview ${exportOnly.title}`,
        exact: true,
      }),
    ).toHaveCount(expandedView ? 1 : 0);
    await expect(
      page.getByRole('dialog', { name: 'Document preview', exact: true }),
    ).toHaveCount(0);
    expect(api.listReads.length).toBeGreaterThan(reads);
    expect(api.previews).toEqual([]);
    expect(api.downloads).toEqual([]);
    expect(api.errors).toEqual([]);
  });

for (const outcome of ['missing', 'view-revoked'] as const)
  test(`a recent entry ${outcome} before the fresh Documents list stays closed with a generic error`, async ({
    page,
  }) => {
    const api = await setup(page);
    await select(page);
    await expect(open(page)).toBeVisible();
    api.rows(
      records
        .filter((row) => row.canView || row.canExport)
        .flatMap((row) =>
          row.id !== newest.id
            ? [row]
            : outcome === 'missing'
              ? []
              : [{ ...row, canView: false, canExport: true }],
        ),
    );
    await open(page).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Documents', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(
      'This document is no longer available for your current access.',
    );
    await expect(
      page.getByRole('dialog', { name: 'Document preview', exact: true }),
    ).toHaveCount(0);
    if (outcome === 'missing')
      await expect(page.getByText(newest.title, { exact: true })).toHaveCount(
        0,
      );
    expect(api.previews).toEqual([]);
    expect(api.downloads).toEqual([]);
    expect(api.errors).toEqual([]);
  });

for (const status of [401, 403, 404])
  for (const recovery of ['retry', 'focus'] as const)
    test(`a denied ${status} document handoff cannot replay after later ${recovery} recovery`, async ({
      page,
    }) => {
      const api = await setup(page);
      await select(page);
      await expect(open(page)).toBeVisible();
      api.rows(records.filter((row) => row.canView || row.canExport));
      api.status(status);
      await open(page).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Documents', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('alert')).toContainText(
        'unavailable for your current access',
      );
      expect(api.previews).toEqual([]);
      expect(api.downloads).toEqual([]);
      api.status(200);
      if (recovery === 'retry')
        await page
          .getByRole('button', { name: 'Try again', exact: true })
          .click();
      else await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(
        page.locator(`li[data-document-id="${newest.id}"]`),
      ).toBeVisible();
      await expect(
        page.getByRole('dialog', { name: 'Document preview', exact: true }),
      ).toHaveCount(0);
      expect(api.previews).toEqual([]);
      expect(api.downloads).toEqual([]);
      expect(api.errors).toEqual([]);
    });

test('a transient document-list failure preserves the explicit preview intent for an explicit retry', async ({
  page,
}) => {
  const api = await setup(page);
  await select(page);
  await expect(open(page)).toBeVisible();
  api.status(503);
  await open(page).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Documents', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(
    'The request could not be completed. Please try again.',
  );
  expect(api.previews).toEqual([]);
  const current = { ...newest, title: 'SYNTHETIC recovered current title.pdf' };
  api.rows(
    records
      .filter((row) => row.canView || row.canExport)
      .map((row) => (row.id === newest.id ? current : row)),
  );
  api.status(200);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Document preview', exact: true }),
  ).toContainText(current.title);
  expect(api.previews).toEqual([
    `/api/patients/${patient.id}/documents/${newest.id}/preview`,
  ]);
  expect(api.downloads).toEqual([]);
  expect(api.errors).toEqual([]);
});

test('View all opens ordinary Documents browsing without an automatic record action', async ({
  page,
}) => {
  const api = await setup(page);
  await select(page);
  await expect(actions(page)).toHaveCount(5);
  api.rows(records.filter((row) => row.canView || row.canExport));
  await section(page)
    .getByRole('link', { name: 'View all', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Documents', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('searchbox', { name: 'Search documents', exact: true }),
  ).toHaveValue('');
  await expect(page.getByText(old.title, { exact: true })).toBeVisible();
  expect(api.previews).toEqual([]);
  expect(api.downloads).toEqual([]);
  expect(api.errors).toEqual([]);
});

test('loading, empty results and transient list failure use real states and an explicit retry', async ({
  page,
}) => {
  const api = await setup(page);
  api.holdList();
  api.rows([]);
  await select(page);
  await expect(section(page).getByRole('status')).toHaveText(
    'Loading recent documents…',
  );
  await expect(actions(page)).toHaveCount(0);
  api.releaseList();
  await expect(section(page).getByRole('status')).toHaveText(
    'No recent documents are available for this patient.',
  );
  api.status(503);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(section(page).getByRole('alert')).toContainText(
    'Recent documents could not be loaded.',
  );
  api.rows([newest]);
  api.status(200);
  await section(page)
    .getByRole('button', { name: 'Try again', exact: true })
    .click();
  await expect(open(page)).toBeVisible();
  expect(api.previews).toEqual([]);
  expect(api.downloads).toEqual([]);
  expect(api.errors).toEqual([]);
});

for (const status of [401, 403])
  test(`a ${status} recent-list denial removes previously shown metadata`, async ({
    page,
  }) => {
    const api = await setup(page);
    await select(page);
    await expect(open(page)).toBeVisible();
    api.status(status);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(section(page).getByRole('alert')).toContainText(
      'Recent documents are unavailable for your current access.',
    );
    await expect(actions(page)).toHaveCount(0);
    await expect(page.getByText(newest.title, { exact: true })).toHaveCount(0);
    expect(api.previews).toEqual([]);
    expect(api.downloads).toEqual([]);
    expect(api.errors).toEqual([]);
  });

for (const malformed of ['mixed-patient', 'duplicate-id'] as const)
  test(`invalid ${malformed} list is rejected without rendering any record metadata`, async ({
    page,
  }) => {
    const api = await setup(page);
    const foreign = {
      ...otherRecord,
      title: 'SYNTHETIC foreign hidden title.pdf',
    };
    api.payload({
      documents:
        malformed === 'mixed-patient'
          ? [newest, foreign]
          : [newest, { ...newest }],
      storageReady: true,
    });
    await select(page);
    await expect(section(page).getByRole('alert')).toContainText(
      'Recent documents could not be loaded.',
    );
    await expect(actions(page)).toHaveCount(0);
    for (const title of [newest.title, foreign.title])
      await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    expect(api.previews).toEqual([]);
    expect(api.downloads).toEqual([]);
    expect(api.errors).toEqual([]);
  });

test('focus revalidation hides old rows and a late previous-patient result cannot enter the next patient', async ({
  page,
}) => {
  const api = await setup(page);
  await select(page);
  await expect(open(page)).toBeVisible();
  const reads = api.listReads.length;
  api.holdPatients();
  api.holdList();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByRole('button', {
      name: 'Select patient: No patient selected',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(newest.title, { exact: true })).toHaveCount(0);
  api.releasePatients();
  await expect.poll(() => api.listReads.length).toBeGreaterThan(reads);
  await select(page, other);
  await expect(open(page, otherRecord)).toBeVisible();
  api.releaseList();
  await expect(open(page, otherRecord)).toBeVisible();
  await expect(page.getByText(newest.title, { exact: true })).toHaveCount(0);
  expect(api.previews).toEqual([]);
  expect(api.downloads).toEqual([]);
  expect(api.errors).toEqual([]);
});

test('successful synthetic upload refreshes recent metadata without leaving Overview', async ({
  page,
}) => {
  const api = await setup(page);
  await select(page);
  await expect(open(page)).toBeVisible();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByLabel(/Choose files/)).toBeEnabled();
  await page.getByLabel(/Choose files/).setInputFiles({
    name: uploadTitle,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nSYNTHETIC upload fixture\n%%EOF'),
  });
  await page
    .getByRole('button', { name: 'Upload selected files', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(open(page, uploaded)).toBeVisible();
  await expect(
    section(page).getByText(fifth.title, { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Overview', exact: true }),
  ).toBeVisible();
  expect(api.uploads).toEqual([
    `POST /api/patients/${patient.id}/uploads`,
    `PUT /api/patients/${patient.id}/uploads/synthetic-upload/content`,
    `POST /api/patients/${patient.id}/uploads/synthetic-upload/finalize`,
  ]);
  expect(api.previews).toEqual([]);
  expect(api.downloads).toEqual([]);
  expect(api.errors).toEqual([]);
});

for (const theme of ['light', 'dark'] as const)
  test(`recent metadata wraps at320,390,1440 and passes axe in ${theme}`, async ({
    page,
  }, info) => {
    const api = await setup(page);
    const long = {
      ...newest,
      title: 'SYNTHETIC ' + 'long-source-'.repeat(14) + '.pdf',
    };
    api.rows(records.map((row) => (row.id === newest.id ? long : row)));
    await select(page);
    await expect(open(page, long)).toBeVisible();
    if (theme === 'dark')
      await page
        .getByRole('button', { name: 'Switch to dark theme', exact: true })
        .click();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(open(page, long)).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      await page.screenshot({
        path: `../../.local/screenshots/overview-recent-${theme}-${width}-${info.project.name}.png`,
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
    expect(api.previews).toEqual([]);
    expect(api.downloads).toEqual([]);
    expect(api.errors).toEqual([]);
  });
