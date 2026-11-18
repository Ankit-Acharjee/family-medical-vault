import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const personal = '11111111-1111-4111-8111-111111111111',
  managed = '22222222-2222-4222-8222-222222222222';
async function setup(page: Page) {
  let created = false,
    mode = 'ok';
  const writes: unknown[] = [],
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      json = (v: unknown, status = 200) => route.fulfill({ json: v, status });
    if (path === '/api/auth/bootstrap')
      return json({ enabled: true, csrf: 'c'.repeat(43) });
    if (path === '/api/auth/account')
      return json({
        email: 'fixture@example.test',
        contextId: 'managed-session',
      });
    if (path === '/api/patients')
      return json({
        patients: [
          {
            id: personal,
            displayName: 'SYNTHETIC personal',
            relationship: 'self',
            capabilities: [{ action: 'view', scope: { kind: 'patient' } }],
          },
          ...(created
            ? [
                {
                  id: managed,
                  displayName: 'SYNTHETIC managed',
                  relationship: 'caregiver',
                  capabilities: [
                    'view',
                    'upload',
                    'edit',
                    'export',
                    'manage',
                  ].map((action) => ({ action, scope: { kind: 'patient' } })),
                },
              ]
            : []),
        ],
      });
    if (path === '/api/patients/managed') {
      const body = req.postDataJSON();
      writes.push(body);
      expect(req.headers()['x-csrf-token']).toBe('c'.repeat(43));
      if (mode === 'denied') return json({}, 404);
      const wasCreated = created;
      created = true;
      if (mode === 'uncertain') {
        mode = 'ok';
        return json({}, 503);
      }
      return json({
        id: managed,
        displayName: body.displayName,
        relationship: 'caregiver',
        created: !wasCreated,
      });
    }
    return json({}, 404);
  });
  await page.goto('/#overview');
  await page.getByRole('button', { name: /Select patient:/ }).click();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: 'Create managed profile', exact: true }),
  ).toBeVisible();
  return {
    writes,
    errors,
    mode: (value: string) => {
      mode = value;
    },
  };
}
const dialog = (page: Page) => page.getByRole('dialog');
async function edit(page: Page) {
  await dialog(page)
    .getByRole('button', { name: 'Create managed profile', exact: true })
    .click();
  await dialog(page)
    .getByLabel('Patient display name')
    .fill('SYNTHETIC managed');
}
test('managed creation requires explicit caregiver confirmation and leaves patient selection explicit', async ({
  page,
}, info) => {
  const f = await setup(page);
  await edit(page);
  await expect(
    dialog(page).getByRole('button', {
      name: 'Create managed profile',
      exact: true,
    }),
  ).toBeDisabled();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
      document.documentElement.classList.toggle('dark', t === 'dark');
    }, theme);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `../../.local/screenshots/managed-${info.project.name}-${theme}.png`,
    });
  }
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('button', { name: 'Create managed profile', exact: true })
    .click();
  await expect(
    dialog(page)
      .getByRole('status')
      .filter({ hasText: 'Managed profile created.' }),
  ).toContainText('Select it from the patient list');
  await expect(
    dialog(page).getByRole('button', { name: /SYNTHETIC managed/ }),
  ).toBeVisible();
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]).toMatchObject({
    displayName: 'SYNTHETIC managed',
    confirmed: true,
  });
  await dialog(page)
    .getByRole('button', { name: /SYNTHETIC managed/ })
    .click();
  await expect(
    page.getByRole('button', { name: /Select patient: SYNTHETIC managed/ }),
  ).toBeVisible();
  expect(f.errors).toEqual([]);
});
test('uncertain managed creation retries identical identity and never adds duplicate profiles', async ({
  page,
}) => {
  const f = await setup(page);
  await edit(page);
  await dialog(page).getByRole('checkbox').check();
  f.mode('uncertain');
  await dialog(page)
    .getByRole('button', { name: 'Create managed profile', exact: true })
    .click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'may have completed',
  );
  await expect(dialog(page).getByLabel('Patient display name')).toBeDisabled();
  await dialog(page)
    .getByRole('button', { name: 'Retry same creation' })
    .click();
  await expect(
    dialog(page)
      .getByRole('status')
      .filter({ hasText: 'Managed profile created.' }),
  ).toContainText('created');
  expect(f.writes[1]).toEqual(f.writes[0]);
  await expect(
    dialog(page).getByRole('button', { name: /SYNTHETIC managed/ }),
  ).toHaveCount(1);
});
test('access rechecks retain managed name draft and reset consent; denial clears the form', async ({
  page,
}) => {
  const f = await setup(page);
  await edit(page);
  await dialog(page).getByRole('checkbox').check();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page).getByLabel('Patient display name')).toHaveValue(
    'SYNTHETIC managed',
  );
  await expect(dialog(page).getByRole('checkbox')).not.toBeChecked();
  f.mode('denied');
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('button', { name: 'Create managed profile', exact: true })
    .click();
  await expect(dialog(page).getByRole('alert')).toContainText('unavailable');
  await expect(dialog(page).getByLabel('Patient display name')).toHaveCount(0);
});
