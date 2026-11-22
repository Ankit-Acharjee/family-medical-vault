import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const patient = '11111111-1111-4111-8111-111111111111',
  doc = '22222222-2222-4222-8222-222222222222',
  linkId = '33333333-3333-4333-8333-333333333333',
  secret = 'r'.repeat(43);
const file = {
  id: doc,
  patientId: patient,
  title: 'SYNTHETIC owner report.pdf',
  originalTitle: 'SYNTHETIC original.pdf',
  mimeType: 'application/pdf',
  bytes: 42,
  createdAt: '2026-11-18T00:00:00Z',
  categoryId: linkId,
  canView: true,
  canExport: true,
  canEdit: true,
};
async function setup(page: Page, owner = true) {
  const errors: string[] = [],
    creates: unknown[] = [],
    urls: string[] = [];
  let uncertain = false,
    stored: Record<string, unknown> | null = null;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      json = (v: unknown, status = 200) => route.fulfill({ status, json: v });
    urls.push(req.url());
    if (path === '/api/auth/bootstrap')
      return json({ enabled: true, csrf: 'c'.repeat(43) });
    if (path === '/api/auth/account')
      return json({
        email: 'fixture@example.test',
        contextId: 'owner-sharing-session',
      });
    if (path === '/api/patients')
      return json({
        patients: [
          {
            id: patient,
            displayName: 'SYNTHETIC owner patient',
            relationship: owner ? 'self' : 'caregiver',
            capabilities: [
              { action: 'view', scope: { kind: 'patient' } },
              { action: 'export', scope: { kind: 'patient' } },
            ],
          },
        ],
      });
    if (path.endsWith('/documents'))
      return json({ documents: [file], storageReady: true });
    if (path.endsWith('/categories')) return json({ categories: [] });
    if (path.endsWith('/documents/search'))
      return json({ documentIds: [], truncated: false });
    if (path.endsWith('/sharing-links/prepare'))
      return json({
        patientId: patient,
        patientName: 'SYNTHETIC owner patient',
        snapshotSha256: 'a'.repeat(64),
        files: [
          {
            id: doc,
            title: file.title,
            originalTitle: file.originalTitle,
            mimeType: file.mimeType,
            bytes: 42,
            sha256: 'b'.repeat(64),
          },
        ],
      });
    if (path.endsWith('/sharing-links') && req.method() === 'GET')
      return json({
        patientId: patient,
        links: stored ? [stored] : [],
        limited: false,
      });
    if (path.endsWith('/sharing-links') && req.method() === 'POST') {
      expect(req.headers()['x-csrf-token']).toBe('c'.repeat(43));
      creates.push(req.postDataJSON());
      if (stored) return json({ link: stored, created: false, token: null });
      const body = req.postDataJSON();
      stored = {
        id: linkId,
        documentIds: [doc],
        createdAt: new Date().toISOString(),
        expiresAt: new Date(
          Date.now() + Number(body.expiresInHours) * 3600000,
        ).toISOString(),
        revokedAt: null,
        state: 'active',
      };
      if (uncertain) return json({}, 503);
      return json({ link: stored, created: true, token: secret });
    }
    if (path.endsWith('/activity'))
      return json({
        patientId: patient,
        linkId,
        events: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            kind: 'link.opened',
            documentId: null,
            recordedAt: new Date().toISOString(),
          },
        ],
        limited: false,
      });
    if (path.endsWith('/revoke')) {
      if (stored)
        stored = {
          ...stored,
          state: 'revoked',
          revokedAt: new Date().toISOString(),
        };
      return json({ revoked: true, protection: 'pending' });
    }
    return json({}, 404);
  });
  await page.goto('/#documents');
  await page
    .getByRole('button', { name: 'Select patient: No patient selected' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /SYNTHETIC owner patient/ })
    .click();
  await expect(page.getByText(file.title, { exact: true })).toBeVisible();
  return {
    errors,
    creates,
    urls,
    uncertain() {
      uncertain = true;
    },
  };
}
const dialog = (page: Page) => page.getByRole('dialog');
async function review(page: Page) {
  await page
    .getByRole('button', { name: 'Share originals', exact: true })
    .click();
  await expect(dialog(page).getByRole('checkbox')).not.toBeChecked();
  await dialog(page).getByRole('checkbox').check();
  await expect(
    dialog(page).getByRole('button', { name: 'Review temporary link' }),
  ).toBeDisabled();
  await dialog(page)
    .getByLabel('Expiry in hours (1–168)', { exact: true })
    .fill('169');
  await expect(
    dialog(page).getByRole('button', { name: 'Review temporary link' }),
  ).toBeDisabled();
  await dialog(page)
    .getByLabel('Expiry in hours (1–168)', { exact: true })
    .fill('24');
  await dialog(page)
    .getByRole('button', { name: 'Review temporary link' })
    .click();
  await expect(
    dialog(page).getByRole('heading', {
      name: 'Review link for SYNTHETIC owner patient',
    }),
  ).toBeVisible();
}
test('owner explicitly scopes expiry and bearer access, receives a one-time fragment link and revokes it', async ({
  page,
}, info) => {
  const f = await setup(page);
  await review(page);
  await expect(
    dialog(page).getByRole('button', { name: 'Create temporary link' }),
  ).toBeDisabled();
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('button', { name: 'Create temporary link' })
    .click();
  const value = dialog(page).getByLabel('Secret sharing link — copy now', {
    exact: true,
  });
  await expect(value).toHaveValue(new RegExp('#shared=' + secret + '$'));
  const url = await value.inputValue();
  expect(new URL(url).search).toBe('');
  expect(page.url()).not.toContain(secret);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
      document.documentElement.classList.toggle('dark', t === 'dark');
    }, theme);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `../../.local/screenshots/owner-sharing-${info.project.name}-${theme}.png`,
    });
  }
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await dialog(page).evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
  await dialog(page)
    .getByRole('button', { name: 'Revoke this link', exact: true })
    .click();
  await dialog(page)
    .getByRole('button', { name: 'Confirm revocation' })
    .click();
  await expect(
    dialog(page).getByRole('status').filter({ hasText: 'Access blocked.' }),
  ).toHaveText(
    'Access blocked. Restore protection pending. Previously downloaded copies cannot be recalled.',
  );
  await page.setViewportSize(
    info.project.use.viewport ?? { width: 390, height: 844 },
  );
  await dialog(page)
    .getByRole('status')
    .filter({ hasText: 'Access blocked.' })
    .scrollIntoViewIfNeeded();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
      document.documentElement.classList.toggle('dark', t === 'dark');
    }, theme);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `../../.local/screenshots/link-protection-${info.project.name}-${theme}.png`,
    });
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(
    dialog(page).getByRole('button', { name: 'Copy secret link' }),
  ).toHaveCount(0);
  await dialog(page)
    .locator('summary')
    .filter({ hasText: 'Outstanding and recent links' })
    .click();
  await expect(
    dialog(page)
      .getByRole('listitem')
      .filter({ hasText: '1 original · revoked' }),
  ).toContainText('Restore protection pending.');
  await dialog(page)
    .locator('summary')
    .filter({ hasText: 'Recent access activity' })
    .click();
  await expect(dialog(page).getByText(/ · Link opened/)).toBeVisible();
  expect(f.creates).toHaveLength(1);
  expect(f.creates[0]).toMatchObject({
    documentIds: [doc],
    expiresInHours: 24,
    confirmed: true,
    selectionSha256: 'a'.repeat(64),
  });
  expect(f.urls.every((url) => !url.includes(secret))).toBe(true);
  expect(f.errors).toEqual([]);
  await dialog(page)
    .getByRole('button', { name: 'Close sharing', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Share originals', exact: true }),
  ).toBeFocused();
});
test('an uncertain creation retries the identical request and never fabricates recovery of the secret', async ({
  page,
}) => {
  const f = await setup(page);
  f.uncertain();
  await review(page);
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('button', { name: 'Create temporary link' })
    .click();
  await expect(
    dialog(page).getByRole('heading', {
      name: 'Resolve the previous creation',
    }),
  ).toBeVisible();
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('button', { name: 'Retry same creation' })
    .click();
  await expect(
    dialog(page).getByRole('heading', { name: 'Creation already completed' }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole('button', { name: 'Copy secret link' }),
  ).toHaveCount(0);
  expect(f.creates).toHaveLength(2);
  expect(f.creates[0]).toEqual(f.creates[1]);
  await dialog(page)
    .getByRole('button', { name: 'Revoke this link', exact: true })
    .click();
  await dialog(page)
    .getByRole('button', { name: 'Confirm revocation' })
    .click();
  await expect(
    dialog(page).getByRole('status').filter({ hasText: 'Access blocked.' }),
  ).toHaveText(
    'Access blocked. Restore protection pending. Previously downloaded copies cannot be recalled.',
  );
  expect(f.errors).toEqual([]);
});
test('delegate View and Export never expose owner external-sharing controls', async ({
  page,
}) => {
  await setup(page, false);
  await expect(
    page.getByRole('button', { name: 'Share originals', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Export originals', exact: true }),
  ).toBeVisible();
});

test('owner revalidation preserves selection, expiry draft, dialog footprint and keyed input focus', async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole('button', { name: 'Share originals', exact: true })
    .click();
  await dialog(page).getByRole('checkbox').check();
  const expiry = dialog(page).getByLabel('Expiry in hours (1–168)', {
    exact: true,
  });
  await expiry.fill('48');
  await expiry.focus();
  const before = (await dialog(page).boundingBox())!.height;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/patients', async (route) => {
    await gate;
    await route.fulfill({
      json: {
        patients: [
          {
            id: patient,
            displayName: 'SYNTHETIC owner patient',
            relationship: 'self',
            capabilities: [
              { action: 'view', scope: { kind: 'patient' } },
              { action: 'export', scope: { kind: 'patient' } },
            ],
          },
        ],
      },
    });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page)).toContainText('Checking owner access…');
  const during = (await dialog(page).boundingBox())!.height;
  expect(during).toBeGreaterThanOrEqual(before - 2);
  release();
  await expect(expiry).toHaveValue('48');
  await expect(dialog(page).getByRole('checkbox')).toBeChecked();
  await expect(expiry).toBeFocused();
});
