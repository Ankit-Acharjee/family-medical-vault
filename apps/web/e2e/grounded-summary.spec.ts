import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  projectConfirmedMeasurements,
  measurementMember,
  projectGroundedSummary,
} from '@fmv/contracts';
const patient = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  doc = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  med = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  reading = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  stamp = '2026-11-18T00:00:00.000Z',
  sha = 'a'.repeat(64);
function inputs() {
  const fields = {
    analyte: 'SYNTHETIC analyte',
    result: '<0.123456789012345678901',
    unit: 'synthetic/unit',
    reference: null,
    specimen: null,
    method: null,
    date: '2024-02-29',
    laboratory: null,
  };
  const items = [
    fields,
    { ...fields, date: null },
    { ...fields, date: '2026-11-17' },
  ].map((fields, i) => ({
    fields,
    source: {
      id: `page-1-block-${i}`,
      page: 1,
      unverified: true,
      confidence: 'unrated',
      fields: Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [
          key,
          value === null ? null : { value, excerpt: `Label: ${value}` },
        ]),
      ),
    },
  }));
  const measurements = projectConfirmedMeasurements(patient, doc, {
    context: {
      sourceRevision: 1,
      sourceSha256: sha,
      lifecycleVersion: 0,
      revision: 1,
      canVerify: false,
    },
    candidates: [],
    snapshot: {
      action: 'confirmation',
      withdrawnItems: [],
      revision: 1,
      sourceRevision: 1,
      sourceSha256: sha,
      verifiedAt: stamp,
      ruleVersion: 'labeled-lab-blocks-v1',
      verified: true,
      extraction: {
        method: 'pdf-text',
        engineVersion: 'pdfjs-6.5.438',
        partial: false,
        partialReason: null,
        downsized: false,
      },
      items,
    },
  });
  const laboratory = {
    patientId: patient,
    canConfirm: false,
    measurements: measurements.map((measurement) => ({
      member: measurementMember(measurement),
      title: 'SYNTHETIC source report',
      measurement,
    })),
    measurementsLimited: true,
    comparisons: [],
    comparisonsLimited: false,
    sources: [
      {
        documentId: doc,
        title: 'SYNTHETIC source report',
        bytes: 10,
        mimeType: 'application/pdf',
      },
    ],
  };
  const manual = {
    patientId: patient,
    canWrite: false,
    entries: [
      {
        readingId: reading,
        patientId: patient,
        revision: 1,
        action: 'record',
        provenance: 'manual',
        recordedAt: stamp,
        reading: {
          kind: 'glucose',
          unit: 'mg/dL',
          observedAt: '2024-02-29T00:30:00+14:00',
          values: { value: '100.00000000000001' },
        },
      },
    ],
    nextCursor: null,
  };
  const medications = {
    patientId: patient,
    canWrite: false,
    entries: [
      {
        sourceState: 'current-source',
        entry: {
          medicationId: med,
          patientId: patient,
          revision: 1,
          action: 'reconciliation',
          recordedAt: stamp,
          meaning: 'owner-recorded-medication-context',
          recordedStatus: 'historical',
          source: {
            documentId: doc,
            candidateId: 'page-1-medication-0',
            sourceRevision: 1,
            sourceSha256: sha,
            lifecycleVersion: 0,
            reviewRevision: 1,
          },
          fields: {
            medication: 'SYNTHETIC medication',
            strength: null,
            dose: 'uncertain as written?',
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
  };
  return { laboratory, manual, medications };
}
async function setup(page: Page, owner = true) {
  let mode = 'normal',
    revoked = false,
    gate: Promise<void> | null = null,
    release: (() => void) | null = null;
  const errors: string[] = [],
    unexpected: string[] = [],
    queries: URLSearchParams[] = [];
  let writes = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const r = route.request(),
      url = new URL(r.url()),
      path = url.pathname;
    const json = (value: unknown, status = 200) =>
      route.fulfill({ status, json: value });
    if (r.method() !== 'GET') {
      writes++;
      return json({}, 404);
    }
    if (path === '/api/auth/bootstrap')
      return json({ enabled: true, csrf: 'c'.repeat(43) });
    if (path === '/api/auth/account')
      return json({
        email: 'fixture@example.test',
        contextId: 'summary-session',
      });
    if (path === '/api/patients') {
      if (gate) await gate;
      return json({
        patients: revoked
          ? []
          : [
              {
                id: patient,
                displayName: 'Synthetic summary patient',
                relationship: owner ? 'self' : 'caregiver',
                capabilities: [{ action: 'view', scope: { kind: 'patient' } }],
              },
            ],
      });
    }
    if (path.endsWith('/medication-reconciliations'))
      return json({
        patientId: patient,
        canWrite: owner,
        entries: [],
        nextCursor: null,
      });
    if (path.endsWith('/measurement-workspace'))
      return json({
        ...inputs().laboratory,
        measurements: [],
        sources: [],
        measurementsLimited: false,
      });
    if (path.endsWith('/manual-readings'))
      return json({ ...inputs().manual, entries: [] });
    if (path.endsWith('/summary')) {
      queries.push(url.searchParams);
      if (mode === 'denied') return json({}, 404);
      if (mode === 'failed') return json({}, 503);
      const scope = url.searchParams.get('scope') ?? 'patient',
        fromDate = url.searchParams.get('fromDate'),
        toDate = url.searchParams.get('toDate');
      const value = projectGroundedSummary({
        patientId: patient,
        generatedAt: stamp,
        request: { scope, period: fromDate ? { fromDate, toDate } : null },
        ...inputs(),
      });
      if (mode === 'malformed') return json({ ...value, patientId: 'wrong' });
      if (mode === 'empty')
        return json(
          projectGroundedSummary({
            patientId: patient,
            generatedAt: stamp,
            request: { scope, period: fromDate ? { fromDate, toDate } : null },
            laboratory: {
              ...inputs().laboratory,
              measurements: [],
              sources: [],
              measurementsLimited: false,
            },
            manual: { ...inputs().manual, entries: [] },
            medications: { ...inputs().medications, entries: [] },
          }),
        );
      return json(
        value?.period
          ? {
              ...value,
              period: {
                toDate: value.period.toDate,
                fromDate: value.period.fromDate,
              },
            }
          : value,
      );
    }
    if (path.endsWith(`/${doc}/preview`)) return json({}, 503);
    unexpected.push(path);
    return json({}, 404);
  });
  await page.goto('/#medications');
  await page
    .getByRole('button', { name: 'Select patient: No patient selected' })
    .click();
  await page.getByRole('button', { name: /Synthetic summary patient/ }).click();
  await expect(
    page.getByRole('button', { name: 'Patient summary', exact: true }),
  ).toBeVisible();
  return {
    errors,
    unexpected,
    queries,
    get writes() {
      return writes;
    },
    mode(v: string) {
      mode = v;
    },
    revoke() {
      revoked = true;
    },
    hold() {
      gate = new Promise((r) => (release = r));
    },
    release() {
      release?.();
      gate = null;
    },
  };
}
const dialog = (p: Page) => p.getByRole('dialog');
async function open(p: Page) {
  await p.getByRole('button', { name: 'Patient summary', exact: true }).click();
  await expect(
    dialog(p).getByRole('heading', { name: 'Patient summary', exact: true }),
  ).toBeVisible();
  await dialog(p)
    .locator('summary')
    .filter({ hasText: 'Summary scope and dates' })
    .click();
}
async function period(p: Page) {
  await dialog(p)
    .getByLabel('From reported date', { exact: true })
    .fill('2024-02-29');
  await dialog(p)
    .getByLabel('To reported date', { exact: true })
    .fill('2024-02-29');
  await dialog(p).getByRole('button', { name: 'Apply summary scope' }).click();
  await expect(dialog(p)).toContainText(
    'Reported-date period: 2024-02-29 through 2024-02-29',
  );
}
test('summary keeps qualifiers, unknown dates, manual offsets, medication snapshot and source navigation', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await period(page);
  await expect(dialog(page)).toContainText('<0.123456789012345678901');
  await expect(dialog(page)).toContainText(
    'Unknown or imprecise collection dates',
  );
  await expect(dialog(page)).toContainText('2024-02-29T00:30:00+14:00');
  await expect(dialog(page)).toContainText('100.00000000000001');
  await expect(dialog(page)).toContainText(
    'does not reconstruct treatment during the requested period',
  );
  const labs = dialog(page).getByRole('region', {
    name: 'Summary laboratory results',
  });
  await expect(labs.locator(':scope > details')).toHaveCount(2);
  await labs.locator('details').first().locator('summary').first().click();
  await expect(labs).toContainText('Reference interval');
  await expect(labs).toContainText('Unknown');
  await labs
    .getByRole('button', { name: 'Compare original', exact: true })
    .first()
    .click();
  await expect(
    labs.getByRole('button', { name: 'Retry original comparison' }),
  ).toBeVisible();
  const original = dialog(page).getByRole('link', {
    name: /Open original source/,
  });
  await expect(original).toHaveAttribute(
    'href',
    `/api/patients/${patient}/documents/${doc}/preview`,
  );
  await expect(original).toHaveAttribute('rel', 'noreferrer');
  await dialog(page).getByRole('button', { name: 'Close dialog' }).click();
  await expect(
    page.getByRole('button', { name: 'Patient summary', exact: true }),
  ).toBeFocused();
  await open(page);
  await dialog(page)
    .getByRole('button', { name: 'View readings and preserved history' })
    .click();
  await expect(page).toHaveURL(/#trends$/);
  await expect(dialog(page)).toHaveCount(0);
  expect(f.writes).toBe(0);
  expect(f.errors).toEqual([]);
  expect(f.unexpected).toEqual([]);
});
test('filter validation, scope selection and reset retain empty/unknown distinctions', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  const before = f.queries.length;
  await dialog(page)
    .getByLabel('From reported date', { exact: true })
    .fill('2024-02-29');
  await dialog(page)
    .getByRole('button', { name: 'Apply summary scope' })
    .click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'both exact, ordered dates',
  );
  expect(f.queries.length).toBe(before);
  await dialog(page)
    .getByLabel('To reported date', { exact: true })
    .fill('2024-02-29');
  await dialog(page)
    .getByLabel('Summary scope', { exact: true })
    .selectOption('medication');
  await dialog(page)
    .getByRole('button', { name: 'Apply summary scope' })
    .click();
  await expect(
    dialog(page).getByRole('region', { name: 'Summary medication snapshot' }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole('region', { name: 'Summary laboratory results' }),
  ).toHaveCount(0);
  f.mode('empty');
  await dialog(page).getByRole('button', { name: 'Reset scope' }).click();
  await expect(dialog(page)).toContainText(
    'No dated results in the available window.',
  );
  await expect(dialog(page)).toContainText('No active user-reported readings');
  await expect(dialog(page)).toContainText('does not establish absence');
  await expect(
    dialog(page).getByLabel('From reported date', { exact: true }),
  ).toHaveValue('');
  expect(f.writes).toBe(0);
});
test('failed or malformed responses hide protected content and explicit retry uses fresh scope', async ({
  page,
}) => {
  const f = await setup(page);
  f.mode('failed');
  await open(page);
  await expect(dialog(page).getByRole('alert')).toContainText(
    'Summary could not be loaded',
  );
  await expect(dialog(page)).not.toContainText('SYNTHETIC analyte');
  f.mode('malformed');
  await dialog(page).getByRole('button', { name: 'Try summary again' }).click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'Summary could not be loaded',
  );
  f.mode('normal');
  await dialog(page).getByRole('button', { name: 'Try summary again' }).click();
  await expect(dialog(page)).toContainText('SYNTHETIC analyte');
  expect(f.errors).toEqual([]);
  expect(f.writes).toBe(0);
});
test('same-context revalidation retains filter drafts and denied access clears the summary', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await expect(dialog(page)).toContainText('SYNTHETIC analyte');
  await dialog(page)
    .getByLabel('From reported date', { exact: true })
    .fill('2024-02-29');
  const height = await dialog(page).evaluate(
    (e) => e.getBoundingClientRect().height,
  );
  f.hold();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page)).toContainText('Checking summary access');
  await expect(dialog(page)).not.toContainText('SYNTHETIC analyte');
  expect(
    await dialog(page).evaluate((e) => e.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(height - 1);
  f.release();
  await expect(dialog(page)).toContainText('SYNTHETIC analyte');
  await expect(
    dialog(page).getByLabel('From reported date', { exact: true }),
  ).toHaveValue('2024-02-29');
  f.mode('denied');
  await dialog(page).getByRole('button', { name: 'Reset scope' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByText('SYNTHETIC analyte')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
test('delegates read with no write affordance; both themes, focus and 320px scrolling are accessible', async ({
  page,
}, info) => {
  const f = await setup(page, false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await expect(dialog(page)).toContainText('SYNTHETIC analyte');
  await expect(
    dialog(page).getByRole('button', { name: /Confirm|Save|Export|Share/ }),
  ).toHaveCount(0);
  await dialog(page)
    .locator('summary')
    .filter({ hasText: 'Summary scope and dates' })
    .click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await dialog(page).evaluate((e) => (e.scrollTop = 0));
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `../../.local/screenshots/grounded-summary-${info.project.name}-${theme}.png`,
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 320, height: 780 });
  await expect(dialog(page)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await dialog(page).evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
  ).toBe(true);
  await dialog(page)
    .getByRole('link', { name: /Open original source/ })
    .scrollIntoViewIfNeeded();
  await expect(
    dialog(page).getByRole('link', { name: /Open original source/ }),
  ).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Patient summary', exact: true }),
  ).toBeFocused();
  expect(f.errors).toEqual([]);
  expect(f.unexpected).toEqual([]);
  expect(f.writes).toBe(0);
});
