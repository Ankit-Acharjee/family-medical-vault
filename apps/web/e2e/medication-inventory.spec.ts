import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  isSaveMedicationInventory,
  type MedicationInventoryEntry,
} from '@fmv/contracts';
const patient = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  medication = '11111111-1111-4111-8111-111111111111';
async function setup(page: Page, owner = true) {
  let mode = 'normal',
    revision = 1,
    sourceState = 'current-source',
    rows: MedicationInventoryEntry[] = [],
    hold: Promise<void> | null = null,
    release: (() => void) | null = null,
    entered = false;
  const writes: string[] = [],
    unexpected: string[] = [],
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    const json = (value: unknown, status = 200) =>
      route.fulfill({ status, json: value });
    if (path === '/api/auth/bootstrap')
      return json({ enabled: true, csrf: 'c'.repeat(43) });
    if (path === '/api/auth/account')
      return json({
        email: 'fixture@example.test',
        contextId: 'inventory-session',
      });
    if (path === '/api/patients')
      return json({
        patients:
          mode === 'revoked'
            ? []
            : [
                {
                  id: patient,
                  displayName: 'Synthetic inventory patient',
                  relationship: owner ? 'self' : 'caregiver',
                  capabilities: [
                    { action: 'view', scope: { kind: 'patient' } },
                  ],
                },
              ],
      });
    if (path.endsWith('/medication-reconciliations'))
      return json({
        patientId: patient,
        canWrite: owner,
        entries: [
          {
            sourceState,
            entry: {
              patientId: patient,
              medicationId: medication,
              revision,
              action: revision === 1 ? 'reconciliation' : 'correction',
              recordedAt: '2026-11-17T00:00:00.000Z',
              meaning: 'owner-recorded-medication-context',
              recordedStatus: 'current',
              source: {
                documentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                candidateId: 'page-1-medication-0',
                sourceRevision: 1,
                sourceSha256: 'a'.repeat(64),
                lifecycleVersion: 0,
                reviewRevision: 1,
              },
              fields: {
                medication: 'SYNTHETIC prescription context',
                strength: null,
                dose: null,
                frequency: null,
                route: null,
                duration: null,
                start: null,
                end: null,
                instructions: null,
              },
            },
          },
        ],
        nextCursor: null,
      });
    if (path.endsWith(`/${medication}/inventory`)) {
      if (hold) await hold;
      if (mode === 'denied') return json({}, 404);
      if (req.method() === 'GET') {
        if (mode === 'failed') return json({}, 503);
        const before = Number(
            url.searchParams.get('beforeRevision') ?? rows[0]?.revision ?? 1,
          ),
          subset = rows.filter((r) => r.revision <= before);
        return json({
          patientId: mode === 'malformed' ? 'wrong' : patient,
          medicationId: medication,
          medicationRevision: revision,
          canWrite: owner,
          sourceState,
          current: rows[0] ?? null,
          history: subset.slice(0, 20),
          nextBeforeRevision:
            subset.length > 20 ? subset[19]!.revision - 1 : null,
        });
      }
      writes.push(req.postData()!);
      entered = true;
      if (mode === 'hold-save') {
        hold = new Promise((r) => (release = r));
        await hold;
      }
      if (mode === 'unavailable') return json({}, 503);
      if (mode === 'invalid') return json({}, 400);
      if (mode === 'conflict') return json({}, 409);
      const body = req.postDataJSON();
      if (
        !isSaveMedicationInventory(body) ||
        !owner ||
        sourceState !== 'current-source' ||
        body.medicationRevision !== revision ||
        body.expectedRevision !== (rows[0]?.revision ?? 0)
      )
        return json({}, 409);
      rows = [
        {
          patientId: patient,
          medicationId: medication,
          medicationRevision: revision,
          revision: body.expectedRevision + 1,
          recordedAt: new Date(
            Date.UTC(2026, 10, 17, 0, 0, body.expectedRevision + 1),
          ).toISOString(),
          meaning: body.meaning,
          fields: body.fields,
        },
        ...rows,
      ];
      if (mode === 'lost-ack') {
        mode = 'normal';
        return json({}, 503);
      }
      return json({ saved: true, revision: rows[0]!.revision });
    }
    unexpected.push(path);
    return json({}, 404);
  });
  await page.goto('/#medications');
  await page
    .getByRole('button', { name: 'Select patient: No patient selected' })
    .click();
  await page
    .getByRole('button', { name: /Synthetic inventory patient/ })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Recorded medication context' }),
  ).toBeVisible();
  return {
    writes,
    errors,
    unexpected,
    get rows() {
      return rows;
    },
    get entered() {
      return entered;
    },
    mode(v: string) {
      mode = v;
    },
    changeMedication() {
      revision++;
    },
    staleSource() {
      sourceState = 'source-review-required';
    },
    hold() {
      hold = new Promise((r) => (release = r));
    },
    release() {
      release?.();
      hold = null;
    },
    seed(count = 1) {
      rows = Array.from({ length: count }, (_, i) => ({
        patientId: patient,
        medicationId: medication,
        medicationRevision: 1,
        revision: count - i,
        recordedAt: new Date(
          Date.UTC(2026, 10, 17, 0, 0, count - i),
        ).toISOString(),
        meaning: 'owner-reported-inventory',
        fields: {
          quantity: 'SYNTHETIC 2 strips',
          expiry: '2027-11 (month only)',
          refill: null,
        },
      }));
    },
  };
}
const dialog = (p: Page) => p.getByRole('dialog');
async function open(p: Page) {
  await p.getByRole('button', { name: /^Inventory for/ }).click();
  await expect(
    dialog(p).getByRole('heading', {
      name: 'Medication inventory',
      exact: true,
    }),
  ).toBeVisible();
}
async function fill(p: Page) {
  await dialog(p)
    .getByRole('textbox', { name: /Quantity as reported/ })
    .fill('2 strips + uncertain remainder');
  await dialog(p)
    .getByRole('textbox', { name: /Expiry as reported/ })
    .fill('Nov 2027 (month only)');
  await dialog(p).getByRole('checkbox').check();
}
test('optional literal inventory saves, dismisses and preserves history on correction or clear', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await expect(
    dialog(page).getByText(
      'No inventory information recorded. It is optional.',
    ),
  ).toBeVisible();
  await fill(page);
  await dialog(page)
    .getByRole('button', { name: 'Save inventory', exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect(f.rows[0]!.fields).toEqual({
    quantity: '2 strips + uncertain remainder',
    expiry: 'Nov 2027 (month only)',
    refill: null,
  });
  await expect(
    page.getByRole('button', { name: /^Inventory for/ }),
  ).toBeFocused();
  await open(page);
  await expect(
    dialog(page).getByRole('textbox', { name: /Quantity as reported/ }),
  ).toHaveValue('2 strips + uncertain remainder');
  for (const name of [
    /Quantity as reported/,
    /Expiry as reported/,
    /Refill information/,
  ])
    await dialog(page).getByRole('textbox', { name }).fill('');
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('button', { name: 'Save inventory', exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect(f.rows).toHaveLength(2);
  expect(f.rows[0]!.fields).toEqual({
    quantity: null,
    expiry: null,
    refill: null,
  });
  expect(f.rows[1]!.fields.quantity).toBe('2 strips + uncertain remainder');
  expect(f.errors).toEqual([]);
  expect(f.unexpected).toEqual([]);
});
test('uncertain retries are sealed, pending close is blocked and lost acknowledgement can be checked', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await fill(page);
  f.mode('hold-save');
  await dialog(page)
    .getByRole('button', { name: 'Save inventory', exact: true })
    .click();
  await expect.poll(() => f.entered).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(1);
  await expect(
    dialog(page).getByRole('button', { name: 'Close dialog' }),
  ).toBeDisabled();
  f.mode('unavailable');
  f.release();
  await expect(
    dialog(page).getByRole('button', { name: 'Retry exact save' }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole('textbox', { name: /Quantity as reported/ }),
  ).toBeDisabled();
  f.mode('normal');
  await dialog(page).getByRole('button', { name: 'Retry exact save' }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(f.writes[1]).toBe(f.writes[0]);
  await open(page);
  await dialog(page)
    .getByRole('textbox', { name: /Refill information/ })
    .fill('No schedule inferred');
  await dialog(page).getByRole('checkbox').check();
  f.mode('lost-ack');
  await dialog(page)
    .getByRole('button', { name: 'Save inventory', exact: true })
    .click();
  await expect(
    dialog(page).getByRole('button', {
      name: 'Check latest inventory version',
    }),
  ).toBeVisible();
  await dialog(page)
    .getByRole('button', { name: 'Check latest inventory version' })
    .click();
  await expect(
    dialog(page).getByRole('button', { name: 'Discard draft and load latest' }),
  ).toBeVisible();
  expect(f.rows).toHaveLength(2);
  await dialog(page)
    .getByRole('button', { name: 'Discard draft and load latest' })
    .click();
  await expect(
    dialog(page).getByRole('textbox', { name: /Refill information/ }),
  ).toHaveValue('No schedule inferred');
  expect(f.writes).toHaveLength(3);
});
test('focus checks retain drafts and stable modal height; revoked access clears protected fields', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await fill(page);
  const size = await dialog(page).boundingBox();
  f.hold();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page).getByRole('textbox')).toHaveCount(0);
  expect(
    Math.abs((await dialog(page).boundingBox())!.height - size!.height),
  ).toBeLessThanOrEqual(2);
  f.release();
  await expect(
    dialog(page).getByRole('textbox', { name: /Quantity as reported/ }),
  ).toHaveValue('2 strips + uncertain remainder');
  f.mode('revoked');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByText('2 strips + uncertain remainder')).toHaveCount(0);
  expect(f.writes).toHaveLength(0);
});
test('delegates read history without controls, and stale sources never imply treatment stopped', async ({
  page,
}) => {
  const f = await setup(page, false);
  f.seed(23);
  await open(page);
  await expect(dialog(page).getByRole('textbox')).toHaveCount(0);
  await expect(dialog(page).getByRole('checkbox')).toHaveCount(0);
  await dialog(page)
    .getByRole('button', { name: 'Older inventory versions' })
    .click();
  await expect(
    dialog(page).getByText('Inventory revision 1 · Medication revision 1', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog(page).getByText('Inventory revision 23 · Medication revision 1', {
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  f.staleSource();
  await open(page);
  await expect(
    dialog(page).getByText(/prescription source needs review/),
  ).toBeVisible();
  expect(f.writes).toHaveLength(0);
});
test('failed loads retry, malformed responses stay hidden, and revision changes require explicit reload', async ({
  page,
}) => {
  const f = await setup(page);
  f.mode('failed');
  await open(page);
  await expect(dialog(page).getByRole('alert')).toHaveText(
    'Inventory could not be loaded.',
  );
  f.mode('malformed');
  await dialog(page).getByRole('button', { name: 'Try again' }).click();
  await expect(dialog(page).getByRole('alert')).toHaveText(
    'Inventory could not be loaded.',
  );
  f.mode('normal');
  await dialog(page).getByRole('button', { name: 'Try again' }).click();
  await fill(page);
  f.changeMedication();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    dialog(page).getByRole('button', { name: 'Discard draft and load latest' }),
  ).toBeVisible();
  await expect(dialog(page).getByRole('textbox')).toHaveCount(0);
  await dialog(page)
    .getByRole('button', { name: 'Discard draft and load latest' })
    .click();
  await expect(
    dialog(page).getByRole('textbox', { name: /Quantity as reported/ }),
  ).toHaveValue('');
  expect(f.writes).toHaveLength(0);
});
test('rejected fields remain editable and concurrent corrections require latest context', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await fill(page);
  f.mode('invalid');
  await dialog(page)
    .getByRole('button', { name: 'Save inventory', exact: true })
    .click();
  await expect(dialog(page).getByRole('alert')).toHaveText(/not accepted/);
  await dialog(page)
    .getByRole('textbox', { name: /Quantity as reported/ })
    .fill('0');
  await expect(dialog(page).getByRole('checkbox')).not.toBeChecked();
  await dialog(page).getByRole('checkbox').check();
  f.mode('conflict');
  await dialog(page)
    .getByRole('button', { name: 'Save inventory', exact: true })
    .click();
  await expect(
    dialog(page).getByRole('button', { name: 'Discard draft and load latest' }),
  ).toBeVisible();
  expect(JSON.parse(f.writes[0]!).requestId).not.toBe(
    JSON.parse(f.writes[1]!).requestId,
  );
  expect(f.rows).toHaveLength(0);
});
test('inventory uses both themes, accessible focus and narrow mobile scrolling', async ({
  page,
}, info) => {
  const f = await setup(page);
  f.seed();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await expect(
    dialog(page).getByRole('textbox', { name: /Quantity as reported/ }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole('heading', { name: 'Preserved inventory versions' }),
  ).toHaveCount(0);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await dialog(page).evaluate((e) => (e.scrollTop = 0));
    await page.screenshot({
      path: `../../.local/screenshots/medication-inventory-${info.project.name}-${theme}.png`,
    });
  }
  await page.setViewportSize({ width: 320, height: 780 });
  await dialog(page).getByRole('checkbox').scrollIntoViewIfNeeded();
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('button', { name: 'Save inventory', exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `../../.local/screenshots/medication-inventory-${info.project.name}-320-actions.png`,
  });
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(f.errors).toEqual([]);
  expect(f.unexpected).toEqual([]);
});
