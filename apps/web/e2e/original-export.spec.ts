import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const patient = '11111111-1111-4111-8111-111111111111',
  file = '22222222-2222-4222-8222-222222222222',
  other = '33333333-3333-4333-8333-333333333333';
const record = {
  id: file,
  patientId: patient,
  title: 'SYNTHETIC report বাংলা.pdf',
  originalTitle: 'SYNTHETIC original.pdf',
  mimeType: 'application/pdf',
  bytes: 42,
  createdAt: '2026-11-18T00:00:00Z',
  categoryId: other,
  canView: false,
  canExport: true,
  canEdit: false,
};
async function setup(page: Page) {
  let mode = 'ready',
    downloadMode = 'ready';
  const bodies: unknown[] = [],
    errors: string[] = [];
  let release: (() => void) | undefined, gate: Promise<void> | undefined;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname,
      json = (value: unknown, status = 200) =>
        route.fulfill({ status, json: value });
    if (path === '/api/auth/bootstrap')
      return json({ enabled: true, csrf: 'c'.repeat(43) });
    if (path === '/api/auth/account')
      return json({
        email: 'fixture@example.test',
        contextId: 'original-export-session',
      });
    if (path === '/api/patients')
      return json({
        patients: [
          {
            id: patient,
            displayName: 'SYNTHETIC export patient',
            relationship: 'caregiver',
            capabilities: [
              {
                action: 'export',
                scope: { kind: 'document', documentId: file },
              },
            ],
          },
        ],
      });
    if (path.endsWith('/documents'))
      return json({
        documents: [
          record,
          {
            ...record,
            id: other,
            title: 'SYNTHETIC non-exportable.pdf',
            canView: true,
            canExport: false,
          },
        ],
        storageReady: true,
      });
    if (path.endsWith('/categories')) return json({ categories: [] });
    if (path.endsWith('/documents/search'))
      return json({ documentIds: [], truncated: false });
    if (path.endsWith('/exports/originals/prepare')) {
      bodies.push(route.request().postDataJSON());
      expect(route.request().headers()['x-csrf-token']).toBe('c'.repeat(43));
      if (mode === 'denied') return json({}, 404);
      if (mode === 'failed') return json({}, 503);
      return json({
        patientId: patient,
        patientName: 'SYNTHETIC export patient',
        snapshotSha256: 'a'.repeat(64),
        files: [
          {
            id: file,
            title: record.title,
            originalTitle: record.originalTitle,
            mimeType: record.mimeType,
            bytes: 42,
            sha256: 'b'.repeat(64),
          },
        ],
      });
    }
    if (path.endsWith('/exports/originals')) {
      bodies.push(route.request().postDataJSON());
      if (gate) await gate;
      if (downloadMode === 'conflict') return json({}, 409);
      if (downloadMode === 'denied') return json({}, 404);
      if (downloadMode === 'failed') return json({}, 503);
      return route
        .fulfill({
          status: 200,
          contentType: 'application/zip',
          body: Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0]),
        })
        .catch(() => {});
    }
    return json({}, 404);
  });
  await page.goto('/#documents');
  await page
    .getByRole('button', { name: 'Select patient: No patient selected' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /SYNTHETIC export patient/ })
    .click();
  await expect(
    page.getByRole('button', { name: 'Export originals', exact: true }),
  ).toBeEnabled();
  return {
    bodies,
    errors,
    mode(v: string) {
      mode = v;
    },
    downloadMode(v: string) {
      downloadMode = v;
    },
    hold() {
      gate = new Promise<void>((r) => (release = r));
    },
    release() {
      release?.();
      gate = undefined;
    },
  };
}
const dialog = (page: Page) => page.getByRole('dialog');
async function select(page: Page) {
  await page
    .getByRole('button', { name: 'Export originals', exact: true })
    .click();
  await expect(dialog(page).getByRole('checkbox')).toHaveCount(1);
  await expect(dialog(page).getByRole('checkbox')).not.toBeChecked();
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('button', { name: 'Review selected originals' })
    .click();
  await expect(
    dialog(page).getByRole('heading', {
      name: 'Review export for SYNTHETIC export patient',
    }),
  ).toBeVisible();
}
test('explicit selection and privacy confirmation export only allowed originals; both themes are accessible', async ({
  page,
}, info) => {
  const f = await setup(page);
  await select(page);
  await expect(dialog(page)).not.toContainText('SYNTHETIC non-exportable.pdf');
  const download = dialog(page).getByRole('button', {
    name: 'Download originals ZIP',
  });
  await expect(download).toBeDisabled();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `../../.local/screenshots/original-export-${info.project.name}-${theme}.png`,
    });
  }
  await dialog(page).getByRole('checkbox').check();
  const event = page.waitForEvent('download');
  await download.click();
  expect((await event).suggestedFilename()).toBe(
    'family-medical-vault-originals.zip',
  );
  await expect(dialog(page)).toContainText('Download started.');
  expect(f.bodies).toHaveLength(2);
  expect(f.bodies[0]).toEqual({ documentIds: [file] });
  expect(f.bodies[1]).toMatchObject({
    documentIds: [file],
    format: 'zip',
    confirmed: true,
    snapshotSha256: 'a'.repeat(64),
  });
  expect(f.errors).toEqual([]);
  await dialog(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Export originals', exact: true }),
  ).toBeFocused();
});
test('stale or failed downloads require fresh review and consent, while denied selections are cleared', async ({
  page,
}) => {
  const f = await setup(page);
  await select(page);
  await dialog(page).getByRole('checkbox').check();
  f.downloadMode('conflict');
  await dialog(page)
    .getByRole('button', { name: 'Download originals ZIP' })
    .click();
  await expect(dialog(page)).toContainText('The selection changed.');
  await dialog(page)
    .getByRole('button', { name: 'Review selected originals' })
    .click();
  await expect(dialog(page).getByRole('checkbox')).not.toBeChecked();
  await dialog(page).getByRole('checkbox').check();
  f.downloadMode('failed');
  await dialog(page)
    .getByRole('button', { name: 'Download originals ZIP' })
    .click();
  await expect(dialog(page)).toContainText('Export could not be completed.');
  await dialog(page)
    .getByRole('button', { name: 'Review selected originals' })
    .click();
  await dialog(page).getByRole('checkbox').check();
  f.downloadMode('denied');
  await dialog(page)
    .getByRole('button', { name: 'Download originals ZIP' })
    .click();
  await expect(dialog(page)).toContainText('no longer available for export');
  await expect(dialog(page).getByRole('checkbox')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
test('canceling pending original export suppresses late delivery; 320px controls stay reachable', async ({
  page,
}) => {
  const f = await setup(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await select(page);
  await dialog(page).getByRole('checkbox').check();
  f.hold();
  let downloads = 0;
  page.on('download', () => downloads++);
  await dialog(page)
    .getByRole('button', { name: 'Download originals ZIP' })
    .click();
  await expect(
    dialog(page).getByRole('button', { name: 'Preparing private archive…' }),
  ).toBeDisabled();
  expect(
    await dialog(page).evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
  await dialog(page)
    .getByRole('button', { name: 'Cancel export', exact: true })
    .click();
  f.release();
  await expect(dialog(page)).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Export originals', exact: true })
    .click();
  await expect(dialog(page).getByRole('checkbox')).not.toBeChecked();
  expect(downloads).toBe(0);
  expect(f.errors).toEqual([]);
});

test('same-context access recheck retains selection, then removes revoked originals and prior confirmation', async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole('button', { name: 'Export originals', exact: true })
    .click();
  await dialog(page).getByRole('checkbox').check();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/patients', async (route) => {
    await gate;
    await route.fulfill({
      json: {
        patients: [
          {
            id: patient,
            displayName: 'SYNTHETIC export patient',
            relationship: 'caregiver',
            capabilities: [
              {
                action: 'export',
                scope: { kind: 'document', documentId: file },
              },
            ],
          },
        ],
      },
    });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page)).toContainText('Checking document access…');
  release();
  await expect(dialog(page).getByRole('checkbox')).toBeChecked();
  await dialog(page)
    .getByRole('button', { name: 'Review selected originals' })
    .click();
  await expect(
    dialog(page).getByRole('heading', {
      name: 'Review export for SYNTHETIC export patient',
    }),
  ).toBeVisible();
  await dialog(page).getByRole('checkbox').check();
  await page.route('**/api/patients/*/documents', (route) =>
    route.fulfill({ json: { documents: [], storageReady: true } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page)).toContainText(
    'No originals are currently available for export.',
  );
  await expect(
    dialog(page).getByRole('button', { name: 'Download originals ZIP' }),
  ).toHaveCount(0);
  await expect(dialog(page)).toContainText('0 selected');
});
