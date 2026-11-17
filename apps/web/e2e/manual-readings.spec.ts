import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { isSaveManualReading, type ManualReadingEntry } from '@fmv/contracts';
const p = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const patient = {
  id: p,
  displayName: 'Synthetic manual patient',
  relationship: 'self',
  capabilities: [{ action: 'view', scope: { kind: 'patient' } }],
};
const entry = (
  id = '11111111-1111-4111-8111-111111111111',
  revision = 1,
): ManualReadingEntry => ({
  readingId: id,
  patientId: p,
  revision,
  action: revision === 1 ? 'record' : 'correction',
  reading: {
    kind: 'weight',
    unit: 'kg',
    observedAt: '2026-11-17T10:30:00+05:30',
    values: { value: '72.000000000000000001' },
  },
  recordedAt: '2026-11-17T00:00:00.000Z',
  provenance: 'manual',
});
async function setup(page: Page, owner = true, categoryOnly = false) {
  let records: ManualReadingEntry[] = [entry()],
    mode = 'normal',
    entered = false,
    manualReads = 0,
    hold: Promise<void> | null = null,
    release: (() => void) | null = null;
  const histories = new Map([[records[0]!.readingId, [records[0]!]]]),
    writes: string[] = [],
    unexpected: string[] = [],
    errors: string[] = [];
  const prof = {
    ...patient,
    relationship: owner ? 'self' : 'caregiver',
    capabilities: categoryOnly
      ? [
          {
            action: 'view',
            scope: { kind: 'category', categoryId: 'synthetic-category' },
          },
        ]
      : patient.capabilities,
  };
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    if (path === '/api/auth/bootstrap')
      return route.fulfill({ json: { enabled: true, csrf: 'c'.repeat(43) } });
    if (path === '/api/auth/account')
      return route.fulfill({
        json: { email: 'fixture@example.test', contextId: 'manual-session' },
      });
    if (path === '/api/patients')
      return route.fulfill({
        json: { patients: mode === 'revoked' ? [] : [prof] },
      });
    if (path.endsWith('/measurement-workspace'))
      return route.fulfill({
        json: {
          patientId: p,
          canConfirm: owner,
          measurements: [],
          sources: [],
          comparisons: [],
          measurementsLimited: false,
          comparisonsLimited: false,
        },
      });
    if (path.endsWith('/manual-readings')) {
      manualReads++;
      entered = true;
      if (hold) await hold;
      if (mode === 'failed') return route.fulfill({ status: 503, json: {} });
      if (mode === 'denied') return route.fulfill({ status: 404, json: {} });
      return route.fulfill({
        json: {
          patientId: mode === 'malformed' ? 'wrong' : p,
          canWrite: owner,
          entries: (() => {
            const c = url.searchParams.get('cursor');
            const cursor = c ? JSON.parse(c) : null;
            return [...records]
              .sort(
                (a, b) =>
                  b.recordedAt.localeCompare(a.recordedAt) ||
                  b.readingId.localeCompare(a.readingId),
              )
              .filter(
                (r) =>
                  !cursor ||
                  r.recordedAt < cursor.recordedAt ||
                  (r.recordedAt === cursor.recordedAt &&
                    r.readingId < cursor.readingId),
              )
              .slice(0, 20);
          })(),
          nextCursor: (() => {
            const c = url.searchParams.get('cursor');
            const cursor = c ? JSON.parse(c) : null;
            const rows = [...records]
              .sort(
                (a, b) =>
                  b.recordedAt.localeCompare(a.recordedAt) ||
                  b.readingId.localeCompare(a.readingId),
              )
              .filter(
                (r) =>
                  !cursor ||
                  r.recordedAt < cursor.recordedAt ||
                  (r.recordedAt === cursor.recordedAt &&
                    r.readingId < cursor.readingId),
              );
            return rows.length > 20
              ? {
                  recordedAt: rows[19]!.recordedAt,
                  readingId: rows[19]!.readingId,
                }
              : null;
          })(),
        },
      });
    }
    const match = path.match(/\/manual-readings\/([^/]+)(\/withdraw)?$/);
    if (match) {
      const id = match[1]!;
      if (req.method() === 'GET') {
        if (mode === 'history-failed')
          return route.fulfill({ status: 503, json: {} });
        const history = histories.get(id);
        if (!history) return route.fulfill({ status: 404, json: {} });
        const current = history[0]!;
        const before = Number(
            url.searchParams.get('beforeRevision') ?? current.revision,
          ),
          visible = history.filter((e) => e.revision <= before);
        return route.fulfill({
          json: {
            current,
            canWrite: owner && current.action !== 'withdrawal',
            history: visible.slice(0, 20),
            nextBeforeRevision:
              visible.length > 20 ? visible[19]!.revision - 1 : null,
          },
        });
      }
      writes.push(req.postData()!);
      entered = true;
      if (hold) await hold;
      expect(req.headers()['x-csrf-token']).toBe('c'.repeat(43));
      if (mode === 'uncertain') {
        mode = 'normal';
        return route.abort('failed');
      }
      if (mode === 'conflict') return route.fulfill({ status: 409, json: {} });
      if (mode === 'denied') return route.fulfill({ status: 404, json: {} });
      const body = req.postDataJSON(),
        old = histories.get(id)?.[0];
      if (!match[2]) expect(isSaveManualReading(body)).toBe(true);
      const saved = {
        ...entry(id, body.expectedRevision + 1),
        action: match[2] ? 'withdrawal' : old ? 'correction' : 'record',
        reading: body.reading ?? old!.reading,
      } as ManualReadingEntry;
      histories.set(id, [saved, ...(histories.get(id) ?? [])]);
      records = [saved, ...records.filter((r) => r.readingId !== id)];
      return route.fulfill({ json: { saved: true, revision: saved.revision } });
    }
    unexpected.push(path);
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('about:blank');
  await page.goto('/#trends');
  await page
    .getByRole('button', { name: 'Select patient: No patient selected' })
    .click();
  await page.getByRole('button', { name: /Synthetic manual patient/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Manual readings', exact: true }),
  ).toBeVisible();
  if (!categoryOnly)
    await expect(
      page.getByRole('button', { name: /History: Weight/ }),
    ).toBeVisible();
  return {
    histories,
    writes,
    unexpected,
    errors,
    setMode(v: string) {
      mode = v;
    },
    hold() {
      entered = false;
      hold = new Promise((r) => (release = r));
    },
    release() {
      release?.();
      hold = null;
    },
    get entered() {
      return entered;
    },
    get records() {
      return records;
    },
    get manualReads() {
      return manualReads;
    },
    set records(v) {
      records = v;
    },
  };
}
const modal = (page: Page) => page.getByRole('dialog');
async function add(page: Page) {
  await page.getByRole('button', { name: 'Add reading' }).click();
  await expect(
    modal(page).getByText('Patient: Synthetic manual patient', { exact: true }),
  ).toBeVisible();
  await modal(page).getByLabel('Systolic', { exact: true }).fill('120');
  await modal(page).getByLabel('Diastolic', { exact: true }).fill('80');
  await modal(page)
    .getByLabel('Observation date and time', { exact: true })
    .fill('2026-11-17T12:30');
  await modal(page)
    .getByLabel('UTC offset for this observation', { exact: true })
    .fill('+05:30');
  await modal(page).getByRole('checkbox').check();
}
test('owner adds, corrects and withdraws manual readings while retaining versions', async ({
  page,
}) => {
  const f = await setup(page);
  await add(page);
  await modal(page)
    .getByRole('button', { name: 'Save reading', exact: true })
    .click();
  await expect(modal(page)).toHaveCount(0);
  await expect(
    page.getByText('Manual reading saved.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Manual readings', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: /History: Blood pressure/ }).click();
  await modal(page)
    .getByRole('button', { name: 'Correct reading', exact: true })
    .click();
  await expect(
    modal(page).getByRole('combobox', { name: 'Reading type', exact: true }),
  ).toBeDisabled();
  await modal(page).getByLabel('Systolic', { exact: true }).fill('121.00');
  await modal(page).getByRole('checkbox').check();
  await modal(page).getByRole('button', { name: 'Save correction' }).click();
  await expect(modal(page)).toHaveCount(0);
  await page.getByRole('button', { name: /History: Blood pressure/ }).click();
  await expect(
    modal(page)
      .getByRole('region', { name: 'Manual version history' })
      .getByText('120 / 80 mmHg', { exact: true }),
  ).toBeVisible();
  await modal(page)
    .getByRole('button', { name: 'Withdraw reading', exact: true })
    .click();
  await modal(page).getByRole('checkbox').check();
  await modal(page).getByRole('button', { name: 'Confirm withdrawal' }).click();
  await expect(modal(page)).toHaveCount(0);
  await page.getByRole('button', { name: /History: Blood pressure/ }).click();
  await expect(
    modal(page).getByRole('region', { name: 'Current manual reading' }),
  ).toContainText('Withdrawn');
  await expect(
    modal(page).getByRole('button', { name: 'Correct reading', exact: true }),
  ).toHaveCount(0);
  expect(f.writes).toHaveLength(3);
  expect(f.unexpected).toEqual([]);
  expect(f.errors).toEqual([]);
});
test('same-context focus hides protected content, preserves the exact draft and resets acknowledgement on changes', async ({
  page,
}) => {
  const f = await setup(page);
  await add(page);
  const initialBox = await modal(page).boundingBox();
  f.hold();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => f.entered).toBe(true);
  await expect(
    modal(page).getByText('Checking manual-reading access…'),
  ).toBeVisible();
  await expect(modal(page).getByLabel('Systolic', { exact: true })).toHaveCount(
    0,
  );
  const checkingBox = await modal(page).boundingBox();
  expect(
    Math.abs(checkingBox!.height - initialBox!.height),
  ).toBeLessThanOrEqual(2);
  f.release();
  await expect(modal(page).getByLabel('Systolic', { exact: true })).toHaveValue(
    '120',
  );
  await expect(modal(page).getByRole('checkbox')).toBeChecked();
  await modal(page).getByLabel('Diastolic', { exact: true }).fill('81');
  await expect(modal(page).getByRole('checkbox')).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(modal(page)).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Manual readings', exact: true }),
  ).toBeFocused();
  expect(f.writes).toEqual([]);
});
test('uncertain save retries identical intent and pending cannot close', async ({
  page,
}) => {
  const f = await setup(page);
  await add(page);
  f.setMode('uncertain');
  await modal(page)
    .getByRole('button', { name: 'Save reading', exact: true })
    .click();
  await expect(
    modal(page).getByRole('button', { name: 'Retry safely' }),
  ).toBeVisible();
  await expect(
    modal(page).getByLabel('Systolic', { exact: true }),
  ).toBeDisabled();
  f.hold();
  await modal(page).getByRole('button', { name: 'Retry safely' }).click();
  await expect.poll(() => f.entered).toBe(true);
  await page.keyboard.press('Escape');
  await expect(modal(page)).toBeVisible();
  await expect(
    modal(page).getByRole('button', { name: 'Close dialog' }),
  ).toBeDisabled();
  f.release();
  await expect(modal(page)).toHaveCount(0);
  expect(f.writes[0]).toBe(f.writes[1]);
});
test('conflict requires fresh review; changed correction baseline cannot save', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: /History: Weight/ }).click();
  await modal(page)
    .getByRole('button', { name: 'Correct reading', exact: true })
    .click();
  await modal(page).getByRole('checkbox').check();
  const current = { ...entry(undefined, 2) };
  f.histories.set(current.readingId, [current, entry()]);
  f.records = [current];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(modal(page).getByRole('alert')).toContainText(
    'current reading changed',
  );
  expect(f.writes).toEqual([]);
  await page.keyboard.press('Escape');
  await add(page);
  f.setMode('conflict');
  await modal(page)
    .getByRole('button', { name: 'Save reading', exact: true })
    .click();
  await expect(modal(page).getByRole('alert')).toContainText(
    'no write will repeat automatically',
  );
});
test('delegate is read-only and category-only access does not fetch manual data', async ({
  page,
}) => {
  const f = await setup(page, false);
  await expect(page.getByRole('button', { name: 'Add reading' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: /History: Weight/ }).click();
  await expect(
    modal(page).getByRole('button', { name: 'Correct reading', exact: true }),
  ).toHaveCount(0);
  expect(f.writes).toEqual([]);
  await page.unrouteAll();
  const category = await setup(page, false, true);
  await expect(
    page.getByText('Patient-wide View is required', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /History: Weight/ }),
  ).toHaveCount(0);
  expect(category.manualReads).toBe(0);
});
test('history paging keeps current state; malformed/error/denied refresh clears protected values', async ({
  page,
}) => {
  const f = await setup(page),
    id = f.records[0]!.readingId;
  f.histories.set(
    id,
    Array.from({ length: 25 }, (_, i) => entry(id, 25 - i)),
  );
  f.records = [entry(id, 25)];
  await page.getByRole('button', { name: 'Refresh manual readings' }).click();
  await page.getByRole('button', { name: /History: Weight/ }).click();
  await modal(page).getByRole('button', { name: 'Older versions' }).click();
  await expect(
    modal(page).getByRole('region', { name: 'Current manual reading' }),
  ).toContainText('revision 25');
  await expect(
    modal(page).getByRole('region', { name: 'Manual version history' }),
  ).toContainText('revision 1');
  await page.keyboard.press('Escape');
  f.setMode('failed');
  await page.getByRole('button', { name: 'Refresh manual readings' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  f.setMode('normal');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /History: Weight/ }),
  ).toBeVisible();
  f.setMode('malformed');
  await page.getByRole('button', { name: 'Refresh manual readings' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  f.setMode('denied');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByText('Manual-reading access could not be validated.'),
  ).toBeVisible();
  await expect(
    page.getByText('72.000000000000000001 kg', { exact: true }),
  ).toHaveCount(0);
});
test('manual form validates explicit offset and both themes remain accessible at320px', async ({
  page,
}, testInfo) => {
  const f = await setup(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await add(page);
  await modal(page)
    .getByLabel('UTC offset for this observation', { exact: true })
    .fill('');
  await modal(page).getByRole('checkbox').check();
  await modal(page)
    .getByRole('button', { name: 'Save reading', exact: true })
    .click();
  await expect(modal(page).getByRole('alert')).toContainText(
    'explicit UTC offset',
  );
  expect(f.writes).toEqual([]);
  await modal(page)
    .getByLabel('UTC offset for this observation', { exact: true })
    .fill('+05:30');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
      document.documentElement.classList.toggle('dark', t === 'dark');
    }, theme);
    await modal(page).evaluate((e) => {
      (document.activeElement as HTMLElement | null)?.blur();
      e.scrollTop = 0;
    });
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({
      path: `../../.local/screenshots/manual-reading-${testInfo.project.name}-${theme}.png`,
    });
    if (testInfo.project.name === 'mobile') {
      await modal(page).evaluate((e) => {
        e.scrollTop = e.scrollHeight;
      });
      await page.screenshot({
        path: `../../.local/screenshots/manual-reading-mobile-${theme}-actions.png`,
      });
    }
  }
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 780 });
    expect(
      await modal(page).evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  expect(f.errors).toEqual([]);
  expect(f.unexpected).toEqual([]);
});

test('other manual metrics keep selected units and exact values; an empty profile can add a reading', async ({
  page,
}) => {
  const f = await setup(page);
  f.records = [];
  await page.getByRole('button', { name: 'Refresh manual readings' }).click();
  await expect(
    page.getByText('No manual readings are available.', { exact: false }),
  ).toBeVisible();
  for (const [kind, unit, value] of [
    ['weight', 'lb', '150.000000000000000001'],
    ['pulse', 'beats/min', '60.00'],
    ['glucose', 'mmol/L', '5.500000000000000001'],
  ]) {
    await page.getByRole('button', { name: 'Add reading' }).click();
    await modal(page)
      .getByRole('combobox', { name: 'Reading type', exact: true })
      .selectOption(kind!);
    await modal(page)
      .getByRole('combobox', { name: 'Unit', exact: true })
      .selectOption(unit!);
    await modal(page).getByLabel('Value', { exact: true }).fill(value!);
    await modal(page)
      .getByLabel('Observation date and time', { exact: true })
      .fill('2026-11-17T11:30');
    await modal(page)
      .getByLabel('UTC offset for this observation', { exact: true })
      .fill('Z');
    await modal(page).getByRole('checkbox').check();
    await modal(page)
      .getByRole('button', { name: 'Save reading', exact: true })
      .click();
    await expect(modal(page)).toHaveCount(0);
    expect(JSON.parse(f.writes.at(-1)!).reading).toEqual({
      kind,
      unit,
      values: { value },
      observedAt: '2026-11-17T11:30:00Z',
    });
  }
  expect(f.errors).toEqual([]);
  expect(f.unexpected).toEqual([]);
});
test('list paging and history retry preserve current context; revocation clears an open draft', async ({
  page,
}) => {
  const f = await setup(page);
  f.records = Array.from({ length: 22 }, (_, i) =>
    entry(`10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`),
  );
  f.records.forEach((r) => f.histories.set(r.readingId, [r]));
  await page.getByRole('button', { name: 'Refresh manual readings' }).click();
  await expect(
    page.getByRole('button', { name: /History: Weight/ }),
  ).toHaveCount(20);
  await page.getByRole('button', { name: 'Next readings' }).click();
  await expect(
    page.getByRole('button', { name: /History: Weight/ }),
  ).toHaveCount(2);
  await page.getByRole('button', { name: 'Previous readings' }).click();
  await expect(
    page.getByRole('button', { name: /History: Weight/ }),
  ).toHaveCount(20);
  f.setMode('history-failed');
  await page
    .getByRole('button', { name: /History: Weight/ })
    .first()
    .click();
  await expect(modal(page).getByRole('alert')).toContainText(
    'history could not be loaded',
  );
  f.setMode('normal');
  await modal(page)
    .getByRole('button', { name: 'Try again', exact: true })
    .click();
  await expect(
    modal(page).getByRole('region', { name: 'Current manual reading' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await add(page);
  f.setMode('revoked');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(modal(page)).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Choose a patient' }),
  ).toBeVisible();
  expect(f.writes).toEqual([]);
});

test('stalled manual read times out and an aborted response cannot replace refreshed data', async ({
  page,
}) => {
  const f = await setup(page);
  await page.clock.install();
  f.hold();
  await page.getByRole('button', { name: 'Refresh manual readings' }).click();
  await expect.poll(() => f.entered).toBe(true);
  await page.clock.fastForward(15001);
  await expect(page.getByRole('alert')).toContainText(
    'Manual readings could not be loaded',
  );
  await expect(
    page.getByText('72.000000000000000001 kg', { exact: true }),
  ).toHaveCount(0);
  f.release();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /History: Weight/ }),
  ).toBeVisible();
  expect(f.errors).toEqual([]);
});
