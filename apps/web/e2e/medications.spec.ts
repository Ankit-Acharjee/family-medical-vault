import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { MedicationReconciliationView } from '@fmv/contracts';
const p = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  d = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  id = '11111111-1111-4111-8111-111111111111';
const record = (
  revision = 2,
  status: 'current' | 'historical' = 'current',
): MedicationReconciliationView => ({
  sourceState: 'current-source',
  entry: {
    medicationId: id,
    patientId: p,
    revision,
    action: revision === 1 ? 'reconciliation' : 'correction',
    recordedAt: `2026-11-${revision === 1 ? '16' : '17'}T00:00:00.000Z`,
    meaning: 'owner-recorded-medication-context',
    source: {
      documentId: d,
      candidateId: 'page-1-medication-0',
      sourceRevision: 1,
      sourceSha256: 'a'.repeat(64),
      lifecycleVersion: 0,
      reviewRevision: 1,
    },
    recordedStatus: status,
    fields: {
      medication: 'SYNTHETIC prescription context',
      strength: null,
      dose:
        revision === 1
          ? 'Original literal dose'
          : 'Owner-corrected literal dose',
      frequency: 'if needed? uncertainty preserved',
      route: null,
      duration: null,
      start: 'as written, date unknown',
      end: null,
      instructions: null,
    },
  },
});
async function setup(page: Page, scope = 'patient') {
  let mode = 'normal',
    reads = 0,
    hold: Promise<void> | null = null,
    release: (() => void) | null = null;
  const writes: string[] = [],
    errors: string[] = [],
    unexpected: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (!['GET', 'HEAD'].includes(req.method())) writes.push(path);
    if (path === '/api/auth/bootstrap')
      return route.fulfill({ json: { enabled: true, csrf: 'c'.repeat(43) } });
    if (path === '/api/auth/account')
      return route.fulfill({
        json: {
          email: 'fixture@example.test',
          contextId: 'medication-session',
        },
      });
    if (path === '/api/patients')
      return route.fulfill({
        json: {
          patients:
            mode === 'revoked'
              ? []
              : [
                  {
                    id: p,
                    displayName: 'Synthetic medication patient',
                    relationship: scope === 'owner' ? 'self' : 'caregiver',
                    capabilities: [
                      {
                        action: 'view',
                        scope:
                          scope === 'category'
                            ? { kind: 'category', categoryId: d }
                            : { kind: 'patient' },
                      },
                    ],
                  },
                ],
        },
      });
    if (path.endsWith('/medication-reconciliations')) {
      reads++;
      if (hold) await hold;
      if (mode === 'failed') return route.fulfill({ status: 503, json: {} });
      if (mode === 'denied' || mode === 'revoked')
        return route.fulfill({ status: 404, json: {} });
      const historical = record(1, 'historical');
      historical.entry.medicationId = '22222222-2222-4222-8222-222222222222';
      historical.entry.fields.medication = 'SYNTHETIC historical context';
      historical.sourceState = 'source-review-required';
      if (mode === 'paged') {
        const items = [
          record(),
          ...Array.from({ length: 21 }, (_, i) => {
            const v = record();
            v.entry.medicationId = `33333333-3333-4333-8333-${String(i + 1).padStart(12, '0')}`;
            return v;
          }),
        ].sort((a, b) =>
          b.entry.medicationId.localeCompare(a.entry.medicationId),
        );
        const cursor = new URL(req.url()).searchParams.get('cursor');
        const visible = cursor ? items.slice(20) : items.slice(0, 20),
          last = visible.at(-1)!.entry;
        return route.fulfill({
          json: {
            patientId: p,
            canWrite: false,
            entries: visible,
            nextCursor: cursor
              ? null
              : {
                  recordedAt: last.recordedAt,
                  medicationId: last.medicationId,
                },
          },
        });
      }
      return route.fulfill({
        json: {
          patientId: mode === 'malformed' ? 'wrong' : p,
          canWrite: scope === 'owner',
          entries: mode === 'empty' ? [] : [record(), historical],
          nextCursor: null,
        },
      });
    }
    if (path.endsWith('/medication-reconciliations/' + id)) {
      if (hold) await hold;
      if (mode === 'failed-history')
        return route.fulfill({ status: 503, json: {} });
      if (mode === 'history-pages') {
        const older = new URL(req.url()).searchParams.has('beforeRevision');
        return route.fulfill({
          json: {
            current: record(22),
            canWrite: false,
            history: older
              ? [record(2), record(1)]
              : Array.from({ length: 20 }, (_, i) => record(22 - i)),
            nextBeforeRevision: older ? null : 2,
          },
        });
      }
      return route.fulfill({
        json: {
          current: record(),
          canWrite: scope === 'owner',
          history: [record(), record(1, 'historical')],
          nextBeforeRevision: null,
        },
      });
    }
    unexpected.push(path);
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/#medications');
  await page
    .getByRole('button', { name: 'Select patient: No patient selected' })
    .click();
  await page
    .getByRole('button', { name: /Synthetic medication patient/ })
    .click();
  return {
    writes,
    errors,
    unexpected,
    get reads() {
      return reads;
    },
    setMode(v: string) {
      mode = v;
    },
    hold() {
      hold = new Promise((r) => (release = r));
    },
    release() {
      release?.();
      hold = null;
    },
  };
}
test('current and historical context stay separate with exact unknowns, source state and preserved history', async ({
  page,
}) => {
  const f = await setup(page);
  await expect(
    page.getByRole('region', { name: 'Recorded current', exact: true }),
  ).toContainText('Owner-corrected literal dose');
  await expect(
    page.getByRole('region', { name: 'Recorded historical', exact: true }),
  ).toContainText('Source review required');
  await page
    .getByRole('button', {
      name: /Details and history for SYNTHETIC prescription/,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Patient: Synthetic medication patient');
  await expect(
    dialog.getByRole('region', { name: 'Current recorded version' }),
  ).toContainText('Unknown');
  await expect(dialog).toContainText(d);
  await expect(dialog).toContainText('Original literal dose');
  await expect(
    dialog.getByRole('button', { name: 'Older versions' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: /Details and history for SYNTHETIC prescription/,
    }),
  ).toBeFocused();
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
  expect(f.unexpected).toEqual([]);
});
test('category-only access sends no medication requests', async ({ page }) => {
  const f = await setup(page, 'category');
  await expect(
    page.getByRole('heading', { name: 'Patient-wide View required' }),
  ).toBeVisible();
  expect(f.reads).toBe(0);
  expect(f.writes).toEqual([]);
});
test('empty, failed and malformed responses recover without creating medication data', async ({
  page,
}) => {
  const f = await setup(page);
  await expect(
    page.getByRole('heading', { name: 'Recorded medication context' }),
  ).toBeVisible();
  for (const mode of ['failed', 'malformed']) {
    f.setMode(mode);
    await page.getByRole('button', { name: 'Refresh medications' }).click();
    await expect(
      page.getByRole('heading', { name: 'Medications could not be loaded' }),
    ).toBeVisible();
    f.setMode('normal');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Refresh medications' }),
    ).toBeVisible();
  }
  f.setMode('empty');
  await page.getByRole('button', { name: 'Refresh medications' }).click();
  await expect(
    page.getByRole('heading', { name: 'No recorded medications on this page' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Review prescription documents' }),
  ).toHaveAttribute('href', '#documents');
  expect(f.writes).toEqual([]);
});
test('history failure retries and same-context focus revalidation hides content without closing the dialog', async ({
  page,
}) => {
  const f = await setup(page);
  f.setMode('failed-history');
  await page
    .getByRole('button', {
      name: /Details and history for SYNTHETIC prescription/,
    })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Medication history could not be loaded',
  );
  f.setMode('normal');
  await page.getByRole('button', { name: 'Try history again' }).click();
  await expect(
    page.getByRole('region', { name: 'Current recorded version' }),
  ).toBeVisible();
  const initial = await page.getByRole('dialog').boundingBox();
  f.hold();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('dialog')).toContainText(
    'Checking medication access',
  );
  await expect(
    page.getByRole('region', { name: 'Current recorded version' }),
  ).toHaveCount(0);
  const during = await page.getByRole('dialog').boundingBox();
  expect(Math.abs(initial!.height - during!.height)).toBeLessThanOrEqual(2);
  f.release();
  await expect(
    page.getByRole('region', { name: 'Current recorded version' }),
  ).toBeVisible();
  expect(f.writes).toEqual([]);
});
test('lost patient access removes medication fields and closes history', async ({
  page,
}) => {
  const f = await setup(page);
  await page
    .getByRole('button', {
      name: /Details and history for SYNTHETIC prescription/,
    })
    .click();
  await expect(
    page.getByRole('region', { name: 'Current recorded version' }),
  ).toBeVisible();
  f.setMode('revoked');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Owner-corrected literal dose')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Choose a patient', exact: true }),
  ).toBeVisible();
});
test('both approved themes have accessible desktop/mobile layouts and 320px overflow protection', async ({
  page,
}, info) => {
  const f = await setup(page);
  await expect(
    page.getByRole('button', { name: 'Refresh medications' }),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
      localStorage.setItem('fmv-theme', t);
    }, theme);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: `../../.local/screenshots/medications-${info.project.name}-${theme}.png`,
      fullPage: false,
    });
    await page
      .getByRole('button', {
        name: /Details and history for SYNTHETIC prescription/,
      })
      .click();
    await expect(
      page.getByRole('region', { name: 'Current recorded version' }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press('Escape');
  }
  if (info.project.name === 'mobile') {
    const pages = page.getByRole('navigation', { name: 'Medication pages' });
    await pages.scrollIntoViewIfNeeded();
    const pageBox = await pages.boundingBox(),
      navBox = await page
        .getByRole('navigation', { name: 'Mobile navigation' })
        .boundingBox();
    expect(pageBox!.y + pageBox!.height).toBeLessThanOrEqual(navBox!.y);
  }
  await page.setViewportSize({ width: 320, height: 780 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole('button', {
      name: /Details and history for SYNTHETIC prescription/,
    })
    .click();
  await expect(
    page.getByRole('region', { name: 'Current recorded version' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(f.errors).toEqual([]);
  expect(f.unexpected).toEqual([]);
});

test('list and history page controls keep the separate current version authoritative', async ({
  page,
}) => {
  const f = await setup(page);
  await expect(
    page.getByRole('button', { name: 'Refresh medications' }),
  ).toBeVisible();
  f.setMode('paged');
  await page.getByRole('button', { name: 'Refresh medications' }).click();
  await expect(
    page.getByRole('button', { name: /Details and history/ }),
  ).toHaveCount(20);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Details and history/ }),
  ).toHaveCount(2);
  await page
    .getByRole('button', { name: 'Previous page', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: /Details and history/ }),
  ).toHaveCount(20);
  f.setMode('normal');
  await page.getByRole('button', { name: 'Refresh medications' }).click();
  await expect(
    page.getByRole('button', { name: /Details and history/ }),
  ).toHaveCount(2);
  f.setMode('history-pages');
  await page
    .getByRole('button', {
      name: /Details and history for SYNTHETIC prescription/,
    })
    .click();
  const current = page.getByRole('region', {
    name: 'Current recorded version',
  });
  await expect(current).toContainText('Revision 22');
  await page.getByRole('button', { name: 'Older versions' }).click();
  await expect(
    page.getByRole('button', { name: 'Older versions' }),
  ).toBeDisabled();
  await expect(current).toContainText('Revision 22');
  await expect(
    page.getByRole('region', { name: 'Preserved versions' }).locator('li'),
  ).toHaveCount(2);
  await page.getByRole('button', { name: 'Newer versions' }).click();
  await expect(
    page.getByRole('region', { name: 'Preserved versions' }).locator('li'),
  ).toHaveCount(20);
  expect(f.writes).toEqual([]);
});
