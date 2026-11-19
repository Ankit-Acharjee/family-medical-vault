import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const patient = '11111111-1111-4111-8111-111111111111',
  doc = '22222222-2222-4222-8222-222222222222';
async function setup(page: Page, owner = true) {
  let mode = 'ok',
    calls = 0;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      json = (v: unknown, status = 200) => route.fulfill({ json: v, status });
    if (path === '/api/auth/bootstrap')
      return json({ enabled: true, csrf: 'c'.repeat(43) });
    if (path === '/api/auth/account')
      return json({
        email: 'fixture@example.test',
        contextId: 'activity-session',
      });
    if (path === '/api/patients')
      return json({
        patients: [
          {
            id: patient,
            displayName: 'SYNTHETIC activity patient',
            relationship: owner ? 'self' : 'caregiver',
            capabilities: ['view', 'manage'].map((action) => ({
              action,
              scope: { kind: 'patient' },
            })),
          },
        ],
      });
    if (path.endsWith('/access')) return json({ grants: [], invitations: [] });
    if (path.endsWith('/access-activity')) {
      calls++;
      expect(req.method()).toBe('GET');
      if (mode === 'denied') return json({}, 404);
      if (mode === 'failed') return json({}, 503);
      if (mode === 'empty')
        return json({ patientId: patient, events: [], nextCursor: null });
      if (mode === 'mismatch')
        return json({ patientId: doc, events: [], nextCursor: null });
      if (url.searchParams.has('cursor'))
        return json({
          patientId: patient,
          events: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              source: 'shared-link',
              kind: 'link.opened',
              actor: 'anonymous-link-holder',
              recordedAt: '2026-11-19T00:00:00.000Z',
              documentId: null,
              documentLabel: null,
            },
          ],
          nextCursor: null,
        });
      return json({
        patientId: patient,
        events: Array.from({ length: 20 }, (_, i) => ({
          id: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`,
          source: 'document',
          kind: i % 2 ? 'document.exported' : 'document.viewed',
          actor: i % 3 ? 'you' : 'authenticated-account',
          recordedAt: '2026-11-19T01:00:00.000Z',
          documentId: doc,
          documentLabel: 'SYNTHETIC document.pdf',
        })),
        nextCursor: 'syntheticcursor',
      });
    }
    return json({}, 404);
  });
  await page.goto('/#family-access');
  await page.getByRole('button', { name: /Select patient:/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /SYNTHETIC activity patient/ })
    .click();
  return {
    mode: (v: string) => {
      mode = v;
    },
    calls: () => calls,
    errors,
  };
}
const dialog = (p: Page) => p.getByRole('dialog');
async function open(page: Page) {
  await page
    .getByRole('button', { name: 'Document access history', exact: true })
    .click();
  await expect(
    dialog(page).getByRole('heading', { name: 'Recent activity', exact: true }),
  ).toBeVisible();
}
test('owner activity has accurate verbs, pagination, focus, both themes and accessible mobile layout', async ({
  page,
}, info) => {
  const f = await setup(page);
  await open(page);
  await expect(
    dialog(page).getByText('Original accessed for export', { exact: true }),
  ).toHaveCount(10);
  await expect(
    dialog(page).getByText('Authenticated account · Access recorded', {
      exact: true,
    }),
  ).not.toHaveCount(0);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await dialog(page).evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({
      path: `/Users/ankitacharjee/personal/Project/family-medical-vault/.local/screenshots/activity-${info.project.name}-${theme}.png`,
      fullPage: false,
    });
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await dialog(page)
    .getByRole('button', { name: 'Earlier activity', exact: true })
    .click();
  await expect(
    dialog(page).getByRole('heading', {
      name: 'Earlier activity',
      exact: true,
    }),
  ).toBeFocused();
  await expect(
    dialog(page).getByText('Anonymous link holder · Access recorded'),
  ).toBeVisible();
  await dialog(page)
    .getByRole('button', { name: 'Back to recent activity' })
    .click();
  await expect(
    dialog(page).getByRole('heading', { name: 'Recent activity', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Document access history', exact: true }),
  ).toBeFocused();
  expect(f.errors).toEqual([]);
});
test('activity failure retries and ownership denial clears previously visible rows', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  f.mode('failed');
  await dialog(page).getByRole('button', { name: 'Refresh history' }).click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'could not be loaded',
  );
  await expect(
    dialog(page).getByText('Document information viewed', { exact: true }),
  ).toHaveCount(0);
  f.mode('empty');
  await dialog(page).getByRole('button', { name: 'Try history again' }).click();
  await expect(
    dialog(page).getByText(
      'No ordinary document access is recorded in the last 90 days.',
    ),
  ).toBeVisible();
  f.mode('ok');
  await dialog(page).getByRole('button', { name: 'Refresh history' }).click();
  await expect(
    dialog(page).getByText('Document information viewed', { exact: true }),
  ).toHaveCount(10);
  f.mode('denied');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page).getByRole('alert')).toContainText(
    'unavailable for your current access',
  );
  await expect(
    dialog(page).getByText('Document information viewed', { exact: true }),
  ).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
test('delegate does not receive aggregate history entry or request', async ({
  page,
}) => {
  const f = await setup(page, false);
  await expect(
    page.getByRole('button', {
      name: 'Private emergency profile',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Document access history', exact: true }),
  ).toHaveCount(0);
  expect(f.calls()).toBe(0);
});
test('wrong-patient response fails closed and 320px viewport remains scrollable', async ({
  page,
}) => {
  const f = await setup(page);
  if (test.info().project.name === 'mobile')
    await page.setViewportSize({ width: 320, height: 740 });
  f.mode('mismatch');
  await page
    .getByRole('button', { name: 'Document access history', exact: true })
    .click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'could not be loaded',
  );
  f.mode('ok');
  await dialog(page).getByRole('button', { name: 'Try history again' }).click();
  await expect(
    dialog(page).getByRole('button', { name: 'Earlier activity', exact: true }),
  ).toBeVisible();
  await dialog(page)
    .getByRole('button', { name: 'Earlier activity', exact: true })
    .click();
  await expect(
    dialog(page).getByText('Selected shared documents'),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
