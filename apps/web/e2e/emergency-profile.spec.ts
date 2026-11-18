import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const patient = '11111111-1111-4111-8111-111111111111';
const empty = {
  contactName: null,
  contactRelationship: null,
  contactPhone: null,
  note: null,
};
async function setup(page: Page, canWrite = true) {
  let current: null | {
      revision: number;
      recordedAt: string;
      provenance: string;
      fields: typeof empty | Record<string, unknown>;
    } = null,
    mode = 'ok';
  const writes: Record<string, unknown>[] = [],
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
        contextId: 'emergency-session',
      });
    if (path === '/api/patients')
      return json({
        patients: [
          {
            id: patient,
            displayName: 'SYNTHETIC emergency patient',
            relationship: canWrite ? 'self' : 'caregiver',
            capabilities: [{ action: 'view', scope: { kind: 'patient' } }],
          },
        ],
      });
    if (path.endsWith('/access')) return json({ grants: [], invitations: [] });
    if (path.endsWith('/emergency-profile')) {
      if (req.method() === 'GET')
        return mode === 'denied'
          ? json({}, 404)
          : mode === 'failed'
            ? json({}, 503)
            : json({ patientId: patient, canWrite, profile: current });
      const body = req.postDataJSON();
      expect(req.headers()['x-csrf-token']).toBe('c'.repeat(43));
      writes.push(body);
      if (mode === 'conflict') {
        current = {
          revision: 2,
          recordedAt: new Date().toISOString(),
          provenance: 'owner-reported',
          fields: { ...empty, note: 'SYNTHETIC concurrent note' },
        };
        mode = 'ok';
        return json({}, 409);
      }
      if (!current || current.revision === body.expectedRevision)
        current = {
          revision: body.expectedRevision + 1,
          recordedAt: new Date().toISOString(),
          provenance: 'owner-reported',
          fields: body.fields,
        };
      if (mode === 'uncertain') {
        mode = 'ok';
        return json({}, 503);
      }
      return json({ saved: true, revision: current.revision });
    }
    return json({}, 404);
  });
  await page.goto('/#family-access');
  await page.getByRole('button', { name: /Select patient:/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /SYNTHETIC emergency patient/ })
    .click();
  await page
    .getByRole('button', { name: 'Private emergency profile', exact: true })
    .click();
  await expect(
    page
      .getByRole('dialog')
      .getByText('No private emergency information has been provided.'),
  ).toBeVisible();
  return {
    writes,
    errors,
    mode: (v: string) => {
      mode = v;
    },
  };
}
const dialog = (page: Page) => page.getByRole('dialog');
async function edit(page: Page) {
  await dialog(page)
    .getByRole('button', { name: 'Edit private emergency profile' })
    .click();
  await dialog(page)
    .getByLabel('Emergency contact name')
    .fill('SYNTHETIC contact');
  await dialog(page).getByLabel('Emergency note').fill('Owner-reported note');
  await dialog(page).getByRole('checkbox').check();
}
test('owner creates and clears optional private fields with accessible both-theme mobile/desktop layout', async ({
  page,
}, info) => {
  const f = await setup(page);
  await edit(page);
  await dialog(page)
    .getByRole('button', { name: 'Save private profile', exact: true })
    .click();
  await expect(
    dialog(page).getByText('Private emergency profile saved.'),
  ).toBeVisible();
  await expect(
    dialog(page).getByText('SYNTHETIC contact', { exact: true }),
  ).toBeVisible();
  expect(f.writes[0]).toMatchObject({
    expectedRevision: 0,
    fields: {
      ...empty,
      contactName: 'SYNTHETIC contact',
      note: 'Owner-reported note',
    },
    confirmed: true,
  });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
      document.documentElement.classList.toggle('dark', t === 'dark');
    }, theme);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `../../.local/screenshots/emergency-${info.project.name}-${theme}.png`,
    });
  }
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await dialog(page)
    .getByRole('button', { name: 'Edit private emergency profile' })
    .click();
  await dialog(page).getByLabel('Emergency contact name').fill('');
  await dialog(page).getByLabel('Emergency note').fill('');
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('button', { name: 'Save private profile', exact: true })
    .click();
  await expect(
    dialog(page).getByText('Not provided', { exact: true }),
  ).toHaveCount(4);
  await dialog(page)
    .getByRole('button', { name: 'Close emergency profile', exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Private emergency profile',
      exact: true,
    }),
  ).toBeFocused();
  expect(f.errors).toEqual([]);
});
test('patient-wide reader has no edit, while failed/revoked profile displays no private fields', async ({
  page,
}) => {
  const f = await setup(page, false);
  await expect(
    dialog(page).getByRole('button', {
      name: 'Edit private emergency profile',
    }),
  ).toHaveCount(0);
  f.mode('denied');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page).getByRole('alert')).toContainText('unavailable');
  expect(f.writes).toHaveLength(0);
});
test('uncertain save retries identical body and conflict retains draft for explicit review', async ({
  page,
}) => {
  const f = await setup(page);
  await edit(page);
  f.mode('uncertain');
  await dialog(page)
    .getByRole('button', { name: 'Save private profile', exact: true })
    .click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'may have completed',
  );
  await dialog(page).getByRole('button', { name: 'Retry same save' }).click();
  await expect(
    dialog(page).getByText('Private emergency profile saved.'),
  ).toBeVisible();
  expect(f.writes[1]).toEqual(f.writes[0]);
  await edit(page);
  f.mode('conflict');
  await dialog(page)
    .getByRole('button', { name: 'Save private profile', exact: true })
    .click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'changed elsewhere',
  );
  await expect(dialog(page).getByLabel('Emergency note')).toHaveValue(
    'Owner-reported note',
  );
  await dialog(page)
    .getByRole('button', { name: 'Load latest private profile' })
    .click();
  await expect(
    dialog(page).getByRole('button', {
      name: 'Use displayed revision 2 for this draft',
    }),
  ).toBeVisible();
});
test('same-patient access recheck keeps draft and footprint, with confirmation reset', async ({
  page,
}) => {
  await setup(page);
  await edit(page);
  const box = await dialog(page).boundingBox();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page).getByLabel('Emergency note')).toHaveValue(
    'Owner-reported note',
  );
  await expect(dialog(page).getByRole('checkbox')).not.toBeChecked();
  expect((await dialog(page).boundingBox())!.height).toBeGreaterThanOrEqual(
    box!.height - 2,
  );
});

test('failed private reads hide fields and recover only after an explicit retry', async ({
  page,
}) => {
  const f = await setup(page);
  f.mode('failed');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page).getByRole('alert')).toContainText(
    'could not be loaded',
  );
  await expect(
    dialog(page).getByRole('button', {
      name: 'Edit private emergency profile',
    }),
  ).toHaveCount(0);
  f.mode('ok');
  await dialog(page).getByRole('button', { name: 'Try profile again' }).click();
  await expect(
    dialog(page).getByText(
      'No private emergency information has been provided.',
    ),
  ).toBeVisible();
});
