import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const patient = '11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222',
  ref = '33333333-3333-4333-8333-333333333333',
  secret = 'v'.repeat(43);
async function setup(page: Page, creator = false) {
  let row: Record<string, unknown> | null = null,
    mode = 'ok';
  const urls: string[] = [],
    writes: unknown[] = [],
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      json = (v: unknown, status = 200) => route.fulfill({ json: v, status });
    urls.push(req.url());
    expect(req.url()).not.toContain(secret);
    if (path === '/api/auth/bootstrap')
      return json({ enabled: true, csrf: 'c'.repeat(43) });
    if (path === '/api/auth/account')
      return json({
        email: 'fixture@example.test',
        contextId: creator ? 'creator-session' : 'claim-session',
      });
    if (path === '/api/patients')
      return json({
        patients: [
          {
            id: patient,
            displayName: 'SYNTHETIC managed person',
            relationship: 'caregiver',
            capabilities: ['view', 'manage'].map((action) => ({
              action,
              scope: { kind: 'patient' },
            })),
          },
        ],
      });
    if (path.endsWith('/access')) return json({ grants: [], invitations: [] });
    if (path.endsWith('/activations') && req.method() === 'GET')
      return mode === 'denied'
        ? json({}, 404)
        : json({
            patientId: patient,
            activations: row ? [row] : [],
            limited: false,
          });
    if (
      path.includes('/activations') ||
      path.startsWith('/api/profile-activation/')
    ) {
      expect(req.headers()['x-csrf-token']).toBe('c'.repeat(43));
      writes.push(req.postDataJSON());
      if (!creator) {
        expect(new URL(page.url()).hash).toBe('#activate');
        expect(req.postDataJSON().token).toBe(secret);
        if (mode === 'failed') return json({}, 503);
        if (mode === 'deferred') return json({}, 409);
        if (mode === 'denied') return json({}, 404);
        if (path.endsWith('/inspect'))
          return json({
            patientId: patient,
            patientName: 'SYNTHETIC intended profile',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            claimantRef: null,
            state: 'pending',
          });
        return json({
          patientId: patient,
          claimantRef: ref,
          state: mode === 'accepted' ? 'accepted' : 'claimed',
        });
      }
      if (path.endsWith('/approve')) {
        expect(req.postDataJSON().claimantRef).toBe(ref);
        if (row) row = { ...row, state: 'accepted' };
        return json({ activated: true, patientId: patient });
      }
      if (path.endsWith('/revoke')) {
        if (row) row = { ...row, state: 'revoked' };
        return json({ revoked: true });
      }
      if (row) return json({ activation: row, created: false, token: null });
      row = {
        id,
        patientId: patient,
        state: 'pending',
        claimantRef: null,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
      if (mode === 'uncertain') {
        mode = 'ok';
        return json({}, 503);
      }
      return json({ activation: row, created: true, token: secret });
    }
    return json({}, 404);
  });
  await page.goto(creator ? '/#family-access' : '/#activate=' + secret);
  if (creator) {
    await page.getByRole('button', { name: /Select patient:/ }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /SYNTHETIC managed person/ })
      .click();
    await page
      .getByRole('button', { name: 'Managed-profile activation', exact: true })
      .click();
    await expect(
      page
        .getByRole('dialog')
        .getByRole('button', { name: 'Issue activation link', exact: true }),
    ).toBeVisible();
  } else
    await expect(
      page.getByRole('heading', { name: 'Activate your managed profile' }),
    ).toBeVisible();
  return {
    urls,
    writes,
    errors,
    mode: (v: string) => {
      mode = v;
    },
    claim: () => {
      if (row) row = { ...row, state: 'claimed', claimantRef: ref };
    },
  };
}
const dialog = (page: Page) => page.getByRole('dialog');
async function issue(page: Page) {
  await dialog(page).getByLabel('Expiry in hours (1–168)').fill('24');
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('button', { name: 'Issue activation link', exact: true })
    .click();
}
async function screenshots(page: Page, name: string, project: string) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
      document.documentElement.classList.toggle('dark', t === 'dark');
    }, theme);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `../../.local/screenshots/activation-${name}-${project}-${theme}.png`,
    });
  }
}
test('creator issues one-time fragment link and independently approves the exact verified claimant', async ({
  page,
}, info) => {
  const f = await setup(page, true);
  await expect(
    dialog(page).getByRole('button', {
      name: 'Issue activation link',
      exact: true,
    }),
  ).toBeDisabled();
  await issue(page);
  await expect(
    dialog(page).getByLabel('Secret activation link — copy now'),
  ).toHaveValue(new RegExp('#activate=' + secret + '$'));
  await screenshots(page, 'creator', info.project.name);
  f.claim();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await dialog(page)
    .getByRole('button', { name: 'Review claimant approval' })
    .click();
  await expect(
    dialog(page).getByRole('button', {
      name: 'Approve profile activation',
      exact: true,
    }),
  ).toBeDisabled();
  await dialog(page)
    .getByLabel('Type the claimant reference you verified separately')
    .fill(ref);
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('button', { name: 'Approve profile activation', exact: true })
    .click();
  await expect(
    dialog(page)
      .getByRole('status')
      .filter({ hasText: 'Activation approved.' }),
  ).toBeVisible();
  expect(f.writes).toHaveLength(2);
  await expect(
    dialog(page).getByText('State: accepted', { exact: true }),
  ).toBeVisible();
  expect(f.errors).toEqual([]);
});
test('uncertain issue retries identical request without recovering secret; revocation stays usable at 320px', async ({
  page,
}) => {
  const f = await setup(page, true);
  f.mode('uncertain');
  await issue(page);
  await expect(dialog(page).getByRole('alert')).toContainText(
    'may have completed',
  );
  await dialog(page)
    .getByRole('button', { name: 'Retry same activation operation' })
    .click();
  await expect(
    dialog(page).getByRole('status').filter({ hasText: 'cannot be recovered' }),
  ).toBeVisible();
  expect(f.writes[1]).toEqual(f.writes[0]);
  await expect(
    dialog(page).getByLabel('Secret activation link — copy now'),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await dialog(page)
    .getByRole('button', { name: 'Revoke activation link', exact: true })
    .click();
  await dialog(page)
    .getByRole('button', { name: 'Confirm activation revocation' })
    .click();
  await expect(
    dialog(page).getByText('State: revoked', { exact: true }),
  ).toBeVisible();
});
test('claimant reviews exact target and explicitly claims without vault access before distinct approval', async ({
  page,
}, info) => {
  const f = await setup(page);
  await expect(page).toHaveURL(/#activate$/);
  expect(f.writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Review activation request' }).click();
  await expect(
    page.getByText('Profile: SYNTHETIC intended profile', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Request creator approval' }),
  ).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Request creator approval' }).click();
  await expect(
    page.getByRole('heading', { name: 'Waiting for creator approval' }),
  ).toBeVisible();
  expect(f.writes[1]).toEqual({ token: secret, confirmed: true });
  await screenshots(page, 'claimant', info.project.name);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(f.urls.some((url) => new URL(url).pathname === '/api/patients')).toBe(
    false,
  );
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain(secret);
  f.mode('accepted');
  await page.getByRole('button', { name: 'Check approval status' }).click();
  await expect(page.getByRole('status')).toContainText('Profile activated');
  expect(f.errors).toEqual([]);
});
test('existing identities are deferred; failed or denied requests retain no protected target metadata', async ({
  page,
}) => {
  const f = await setup(page);
  f.mode('failed');
  await page.getByRole('button', { name: 'Review activation request' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  f.mode('ok');
  await page
    .getByRole('button', { name: 'Retry activation operation' })
    .click();
  await expect(
    page.getByText('Profile: SYNTHETIC intended profile', { exact: true }),
  ).toBeVisible();
  f.mode('deferred');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Request creator approval' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'No profiles were merged',
  );
  await expect(
    page.getByText('Profile: SYNTHETIC intended profile', { exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Reopen the original');
  expect(f.urls.some((url) => new URL(url).pathname === '/api/patients')).toBe(
    false,
  );
});

test('creator authority refresh preserves expiry draft but resets consent, then clears secrets after denial', async ({
  page,
}) => {
  const f = await setup(page, true);
  await dialog(page).getByLabel('Expiry in hours (1–168)').fill('48');
  await dialog(page).getByRole('checkbox').check();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page).getByLabel('Expiry in hours (1–168)')).toHaveValue(
    '48',
  );
  await expect(dialog(page).getByRole('checkbox')).not.toBeChecked();
  await issue(page);
  await expect(
    dialog(page).getByLabel('Secret activation link — copy now'),
  ).toBeVisible();
  f.mode('denied');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page).getByRole('alert')).toContainText('unavailable');
  await expect(
    dialog(page).getByLabel('Secret activation link — copy now'),
  ).toHaveCount(0);
});
test('claimant refresh requires fresh review consent and hides denied target metadata', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Review activation request' }).click();
  await page.getByRole('checkbox').check();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(
    page.getByText('Profile: SYNTHETIC intended profile', { exact: true }),
  ).toBeVisible();
  f.mode('denied');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert')).toContainText('unavailable');
  await expect(
    page.getByText('Profile: SYNTHETIC intended profile', { exact: true }),
  ).toHaveCount(0);
});
