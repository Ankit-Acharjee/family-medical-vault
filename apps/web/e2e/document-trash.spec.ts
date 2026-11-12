import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// DEL-01, UX-02/04/05, F-01/F-06: exercise the real App with protected API fixtures.
const patient = {
  id: 'a',
  displayName: 'Trash Patient',
  relationship: 'self',
  capabilities: ['view', 'edit', 'export', 'upload'].map((action) => ({
    action,
    scope: { kind: 'patient' },
  })),
};
const other = { ...patient, id: 'b', displayName: 'Other Patient' };
const record = {
  id: 'private-document-id',
  patientId: 'a',
  title: 'Recovery report.pdf',
  originalTitle: 'original-report.pdf',
  categoryId: 'general',
  categoryName: 'Unclassified',
  createdAt: '2026-04-02T12:00:00Z',
  canEdit: true,
  canView: true,
  canExport: true,
  bytes: 5,
  mimeType: 'application/pdf',
};
const trashRecord = {
  ...record,
  canEdit: false,
  canView: false,
  canExport: false,
  deletedAt: '2026-11-12T12:00:00Z',
  restoreUntil: '2026-12-12T12:00:00Z',
  canRestore: true,
};
const move = (page: Page) =>
  page.getByRole('button', {
    name: `Move to Trash ${record.title}`,
    exact: true,
  });
const restore = (page: Page) =>
  page.getByRole('button', { name: `Restore ${record.title}`, exact: true });
const activeView = (page: Page) =>
  page.getByRole('button', { name: 'Active documents', exact: true });
const trashView = (page: Page) =>
  page.getByRole('button', { name: 'Trash', exact: true });
async function setup(page: Page, initiallyTrashed = false) {
  let active = initiallyTrashed ? [] : [structuredClone(record)];
  let trash = initiallyTrashed ? [structuredClone(trashRecord)] : [];
  let status = 200;
  let listStatus = 200;
  let patients = [patient, other];
  let gate: Promise<void> | undefined;
  let release: (() => void) | undefined;
  const writes: string[] = [];
  const reads: string[] = [];
  await page.route('**/api/auth/bootstrap', (route) =>
    route.fulfill({ json: { enabled: true, csrf: 'c'.repeat(43) } }),
  );
  await page.route('**/api/auth/account', (route) =>
    route.fulfill({
      json: { email: 'fixture@example.test', contextId: 'trash-session' },
    }),
  );
  await page.route('**/api/patients', (route) =>
    route.fulfill({ json: { patients } }),
  );
  await page.route('**/api/patients/*/categories', (route) =>
    route.fulfill({ json: { categories: [] } }),
  );
  await page.route('**/api/patients/*/documents', (route) =>
    route.fulfill({
      status: listStatus,
      json: {
        documents: route.request().url().includes('/a/') ? active : [],
        storageReady: true,
      },
    }),
  );
  await page.route('**/api/patients/*/trash', async (route) => {
    reads.push(route.request().url());
    const snapshot = structuredClone(trash);
    if (gate && route.request().url().includes('/a/')) await gate;
    await route
      .fulfill({
        status: listStatus,
        json: {
          documents: route.request().url().includes('/a/') ? snapshot : [],
        },
      })
      .catch(() => {});
  });
  await page.route('**/api/patients/*/documents/*/preview', (route) =>
    route.fulfill({ body: '%PDF-', contentType: 'application/pdf' }),
  );
  await page.route('**/api/patients/*/documents/*/download', (route) =>
    route.fulfill({
      body: '%PDF-',
      contentType: 'application/pdf',
      headers: { 'content-disposition': 'attachment; filename="report.pdf"' },
    }),
  );
  for (const action of ['trash', 'restore']) {
    await page.route(
      `**/api/patients/*/documents/*/${action}`,
      async (route) => {
        expect(route.request().method()).toBe('POST');
        expect(route.request().headers()['x-csrf-token']).toBe('c'.repeat(43));
        expect(route.request().postDataJSON()).toEqual({});
        writes.push(action);
        if (status === 200) {
          active = action === 'trash' ? [] : [structuredClone(record)];
          trash = action === 'trash' ? [structuredClone(trashRecord)] : [];
        }
        await route.fulfill({
          status,
          json: status === 200 ? { saved: true } : {},
        });
      },
    );
  }
  await page.goto('/#documents');
  await selectPatient(page, 'Trash Patient');
  await expect(activeView(page)).toBeVisible();
  return {
    writes,
    reads,
    status: (value: number) => {
      status = value;
    },
    deny: () => {
      listStatus = 404;
    },
    expire: () => {
      trash = trash.map((row) => ({
        ...row,
        canRestore: false,
        restoreUntil: '2026-11-11T12:00:00Z',
      }));
    },
    revoke: () => {
      patients = [
        {
          ...patient,
          capabilities: patient.capabilities.filter(
            (item) => item.action !== 'edit',
          ),
        },
        other,
      ];
      trash = [];
    },
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
async function selectPatient(page: Page, name: string) {
  await page.getByRole('button', { name: /Select patient:/ }).click();
  await page.getByRole('button', { name: `${name} (Your profile)` }).click();
}
async function revalidate(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

test('Trash confirmation cancels by keyboard, retries safely, clears preview and restores with stable focus', async ({
  page,
}) => {
  const api = await setup(page);
  await page
    .getByRole('searchbox', { name: 'Search documents' })
    .fill('original-report');
  await page.getByRole('button', { name: `Preview ${record.title}` }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', /^blob:/);
  await page
    .getByRole('dialog', { name: 'Document preview', exact: true })
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: `Preview ${record.title}` }),
  ).toBeFocused();
  await expect(move(page)).toBeEnabled();
  await move(page).focus();
  await expect(move(page)).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Move document to Trash' });
  await expect(dialog).toContainText('Trash Patient');
  await expect(dialog).toContainText(record.title);
  await expect(dialog).toContainText(/30 days/);
  await page.keyboard.press('Escape');
  await expect(move(page)).toBeFocused();
  expect(api.writes).toEqual([]);
  await move(page).click();
  api.status(503);
  await dialog
    .getByRole('button', { name: 'Move to Trash', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toContainText(/try again/i);
  await expect(dialog).toContainText(record.title);
  api.status(200);
  await dialog
    .getByRole('button', { name: 'Move to Trash', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(
    page.getByText('Document moved to Trash.', { exact: true }),
  ).toBeVisible();
  await expect(activeView(page)).toBeFocused();
  await expect(move(page)).toHaveCount(0);
  await trashView(page).click();
  await restore(page).click();
  const recovery = page.getByRole('dialog', {
    name: 'Restore document',
    exact: true,
  });
  await expect(recovery).toContainText('Trash Patient');
  await expect(recovery).toContainText(record.title);
  await recovery.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(restore(page)).toBeFocused();
  await restore(page).click();
  api.status(503);
  await recovery.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(recovery.getByRole('alert')).toContainText(/try again/i);
  api.status(200);
  await recovery.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(recovery).toHaveCount(0);
  await expect(
    page.getByText('Document restored.', { exact: true }),
  ).toBeVisible();
  await expect(trashView(page)).toBeFocused();
  await expect(restore(page)).toHaveCount(0);
  await activeView(page).click();
  await expect(move(page)).toBeVisible();
  expect(api.writes).toEqual(['trash', 'trash', 'restore', 'restore']);
  expect(page.url()).toMatch(/\/#documents$/);
});

test('an unconfirmed Trash mutation releases its pending state and retries only after an explicit choice', async ({
  page,
}) => {
  const api = await setup(page);
  await page.clock.install();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route('**/api/patients/a/documents/*/trash', async (route) => {
    if (held) {
      await route.fallback();
      return;
    }
    held = true;
    await gate;
    await route.fulfill({ json: { saved: true } }).catch(() => {});
  });
  await move(page).click();
  const dialog = page.getByRole('dialog', {
    name: 'Move document to Trash',
    exact: true,
  });
  await dialog
    .getByRole('button', { name: 'Move to Trash', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Working…', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.clock.fastForward(30_001);
  await expect(dialog.getByRole('alert')).toContainText(
    'could not be confirmed',
  );
  await expect(
    dialog.getByRole('button', { name: 'Move to Trash', exact: true }),
  ).toBeEnabled();
  release();
  await expect(
    page.getByText('Document moved to Trash.', { exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole('button', { name: 'Move to Trash', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText('Document moved to Trash.', { exact: true }),
  ).toBeVisible();
  expect(api.writes).toEqual(['trash']);
});

test('Trash is metadata only; expiry and current rights remove recovery and denial clears sensitive context', async ({
  page,
}) => {
  const api = await setup(page, true);
  await trashView(page).click();
  await expect(restore(page)).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^(Preview|Download|Edit title) / }),
  ).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(record.id);
  await restore(page).click();
  api.expire();
  await revalidate(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(restore(page)).toHaveCount(0);
  await expect(
    page.getByText('Recovery period ended', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('main')).not.toContainText(
    /permanently deleted|physically purged/i,
  );
  api.revoke();
  await revalidate(page);
  await expect(page.getByText(record.title, { exact: true })).toHaveCount(0);
  expect(api.writes).toEqual([]);
});

for (const action of ['trash', 'restore'] as const) {
  test(`${action} denial clears the dialog and protected list`, async ({
    page,
  }) => {
    const api = await setup(page, action === 'restore');
    if (action === 'restore') await trashView(page).click();
    await (action === 'trash' ? move(page) : restore(page)).click();
    api.status(404);
    await page
      .getByRole('dialog')
      .getByRole('button', {
        name: action === 'trash' ? 'Move to Trash' : 'Restore',
        exact: true,
      })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(record.title, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('alert').first()).toContainText(
      /unavailable for your current access/i,
    );
  });
}

test('patient switch clears recovery context and ignores delayed previous-patient Trash', async ({
  page,
}) => {
  const api = await setup(page, true);
  await trashView(page).click();
  await restore(page).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  api.hold();
  const reads = api.reads.length;
  await revalidate(page);
  await expect.poll(() => api.reads.length).toBeGreaterThan(reads);
  await selectPatient(page, 'Other Patient');
  api.release();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(record.title, { exact: true })).toHaveCount(0);
  await expect(restore(page)).toHaveCount(0);
  expect(api.writes).toEqual([]);
});

test('active search, preview, download and global upload remain available after visiting Trash', async ({
  page,
}) => {
  const api = await setup(page);
  await trashView(page).click();
  await expect(restore(page)).toHaveCount(0);
  await activeView(page).click();
  await page
    .getByRole('searchbox', { name: 'Search documents' })
    .fill('original-report');
  await expect(move(page)).toBeVisible();
  await page.getByRole('button', { name: `Preview ${record.title}` }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', /^blob:/);
  await page
    .getByRole('dialog', { name: 'Document preview', exact: true })
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  await expect(page.locator('iframe')).toHaveCount(0);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: `Download ${record.title}` }).click();
  expect((await downloaded).suggestedFilename()).toBe(record.title);
  const uploads: string[] = [];
  await page.route('**/api/patients/a/uploads**', (route) => {
    const path = new URL(route.request().url()).pathname;
    uploads.push(path);
    return route.fulfill({
      json: {
        uploadId: 'u',
        documentId: 'new-upload',
        state: path.endsWith('/finalize') ? 'ready' : 'pending',
      },
    });
  });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Trash Patient');
  await page.getByLabel(/Choose files/).setInputFiles({
    name: 'new-upload.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 synthetic fixture'),
  });
  await page.getByRole('button', { name: 'Upload selected files' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(uploads).toEqual([
    '/api/patients/a/uploads',
    '/api/patients/a/uploads/u/content',
    '/api/patients/a/uploads/u/finalize',
  ]);
  expect(api.writes).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) {
  test(`Trash and confirmations fit 320,390,desktop with axe in ${theme}`, async ({
    page,
  }, testInfo) => {
    await setup(page);
    if (theme === 'dark')
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await move(page).click();
      await expect(
        page.getByRole('dialog', { name: 'Move document to Trash' }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      if (width === 320 || width === 1440) {
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
              .analyze()
          ).violations,
        ).toEqual([]);
      }
      await expect
        .poll(() =>
          page
            .getByRole('dialog')
            .evaluate((element) => element.contains(document.activeElement)),
        )
        .toBe(true);
      await page.screenshot({
        path: `../../.local/screenshots/document-trash-${theme}-${width}-move-${testInfo.project.name}.png`,
        fullPage: false,
      });
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
    }
    await move(page).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Move to Trash', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await trashView(page).click();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(restore(page)).toBeVisible();
      if (width === 320) {
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
              .analyze()
          ).violations,
        ).toEqual([]);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      await page.screenshot({
        path: `../../.local/screenshots/document-trash-${theme}-${width}-${testInfo.project.name}.png`,
        fullPage: true,
      });
      await restore(page).click();
      await expect(
        page.getByRole('dialog', { name: 'Restore document', exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      if (width === 320 || width === 1440) {
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
              .analyze()
          ).violations,
        ).toEqual([]);
      }
      await page.screenshot({
        path: `../../.local/screenshots/document-trash-${theme}-${width}-restore-${testInfo.project.name}.png`,
        fullPage: false,
      });
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
    }
  });
}
