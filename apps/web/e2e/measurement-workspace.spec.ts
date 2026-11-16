import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import {
  classifyMeasurementDate,
  classifyMeasurementResult,
  measurementMember,
  isMeasurementWorkspace,
  type ConfirmedMeasurement,
  type MeasurementWorkspace,
  type MeasurementComparisonResult,
} from '@fmv/contracts';

const patient = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  displayName: 'Synthetic comparison patient',
  relationship: 'self',
  capabilities: [{ action: 'view', scope: { kind: 'patient' } }],
};
const docIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP7sAAAAASUVORK5CYII=',
  'base64',
);
const sha = createHash('sha256').update(image).digest('hex');
function measurement(documentId: string, index: number): ConfirmedMeasurement {
  const fields = {
    analyte: 'Synthetic marker',
    result: index ? '2.5' : '1.230000000000000001',
    unit: 'synthetic/unit',
    reference: null,
    specimen: null,
    method: null,
    date: `2026-11-${index ? '12' : '11'}`,
    laboratory: null,
  };
  return {
    fields,
    source: {
      id: 'page-1-block-0',
      page: 1,
      unverified: true,
      confidence: 'unrated',
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [
          k,
          v === null ? null : { value: v, excerpt: `${k}: ${v}` },
        ]),
      ) as ConfirmedMeasurement['source']['fields'],
    },
    provenance: {
      patientId: patient.id,
      documentId,
      reviewRevision: 1,
      sourceRevision: 1,
      sourceSha256: sha,
      lifecycleVersion: 0,
      verifiedAt: '2026-11-16T00:00:00.000Z',
    },
    result: classifyMeasurementResult(fields.result),
    collectionDate: classifyMeasurementDate(fields.date),
    comparability: { status: 'unconfirmed' },
  };
}
function fixture(): MeasurementWorkspace {
  const measurements = docIds.map((id, i) => {
    const m = measurement(id, i);
    return {
      member: measurementMember(m),
      measurement: m,
      title: `Synthetic report ${i + 1}.png`,
    };
  });
  const value: MeasurementWorkspace = {
    patientId: patient.id,
    canConfirm: true,
    measurements,
    measurementsLimited: false,
    comparisons: [],
    comparisonsLimited: false,
    sources: measurements.map((o) => ({
      documentId: o.member.documentId,
      title: o.title,
      bytes: image.length,
      mimeType: 'image/png',
    })),
  };
  expect(isMeasurementWorkspace(value)).toBe(true);
  return value;
}
async function setup(page: Page, owner = true) {
  const data = fixture();
  data.canConfirm = owner;
  const sets = new Map<string, MeasurementComparisonResult>();
  const writes: string[] = [],
    unexpected: string[] = [],
    errors: string[] = [];
  let mode = 'normal',
    reads = 0,
    entered = false,
    release: (() => void) | null = null,
    hold: Promise<void> | null = null;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path === '/api/auth/bootstrap')
      return route.fulfill({ json: { enabled: true, csrf: 'c'.repeat(43) } });
    if (path === '/api/auth/account')
      return route.fulfill({
        json: {
          email: 'fixture@example.test',
          contextId: 'comparison-session',
        },
      });
    if (path === '/api/patients')
      return route.fulfill({
        json: { patients: mode === 'revoked' ? [] : [patient] },
      });
    if (path.endsWith('/measurement-workspace')) {
      reads++;
      entered = true;
      if (hold) await hold;
      return route.fulfill({
        status: mode === 'failed' ? 503 : mode === 'denied' ? 404 : 200,
        json: mode === 'malformed' ? { ...data, patientId: docIds[0] } : data,
      });
    }
    const match = path.match(
      /\/measurement-comparisons\/([^/]+)(\/withdraw)?$/,
    );
    if (match) {
      const id = match[1]!;
      if (req.method() === 'GET')
        return route.fulfill({
          json: sets.get(id) ?? {
            setId: id,
            revision: 0,
            status: 'missing',
            canConfirm: owner,
            members: [],
            measurements: [],
          },
        });
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
      const body = req.postDataJSON();
      const old = sets.get(id),
        revision = (old?.revision ?? 0) + 1;
      sets.set(id, {
        setId: id,
        revision,
        status: match[2] ? 'withdrawn' : 'current',
        canConfirm: owner,
        members: body.members ?? old!.members,
        measurements: match[2]
          ? []
          : data.measurements.map((o) => o.measurement),
      });
      data.comparisons = [
        {
          setId: id,
          revision,
          status: match[2] ? 'withdrawn' : 'current',
          analyte: match[2] ? null : 'Synthetic marker',
          memberCount: 2,
          recordedAt: '2026-11-16T00:00:00.000Z',
        },
      ];
      return route.fulfill({ json: { saved: true, revision } });
    }
    if (path.endsWith('/preview'))
      return route.fulfill({
        body: image,
        contentType: 'image/png',
        headers: { 'content-length': String(image.length) },
      });
    unexpected.push(path);
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/#trends');
  await page
    .getByRole('button', { name: 'Select patient: No patient selected' })
    .click();
  await page
    .getByRole('button', {
      name: /Synthetic comparison patient \(Your profile\)/,
    })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Verified results' }),
  ).toBeVisible();
  return {
    data,
    sets,
    writes,
    unexpected,
    errors,
    get reads() {
      return reads;
    },
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
  };
}
const dialog = (page: Page) => page.getByRole('dialog');
async function select(page: Page) {
  const checks = page.getByRole('checkbox', {
    name: /^Select Synthetic marker/,
  });
  await checks.nth(0).check();
  await checks.nth(1).check();
  await page.getByRole('button', { name: 'Review selection' }).click();
  await expect(
    dialog(page).getByRole('heading', { name: 'Review comparability' }),
  ).toBeVisible();
}
const ack = (page: Page) => dialog(page).getByRole('checkbox');

test('owner explicitly confirms, sees sources, dismisses, reads and withdraws', async ({
  page,
}) => {
  const f = await setup(page);
  await select(page);
  await expect(
    dialog(page).getByRole('button', { name: 'Confirm comparability' }),
  ).toBeDisabled();
  await expect(
    dialog(page).getByText('Some source fields are unknown.', { exact: false }),
  ).toBeVisible();
  await dialog(page)
    .getByText('Source details', { exact: true })
    .first()
    .click();
  await expect(
    dialog(page)
      .getByRole('blockquote')
      .filter({ hasText: 'result: 1.230000000000000001' }),
  ).toBeVisible();
  await ack(page).check();
  await dialog(page)
    .getByRole('button', { name: 'Confirm comparability' })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByText('Comparability confirmed.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('#page-title')).toBeFocused();
  await page.getByRole('button', { name: 'View comparison' }).click();
  await dialog(page)
    .getByRole('button', { name: 'Withdraw confirmation' })
    .click();
  await ack(page).check();
  await dialog(page)
    .getByRole('button', { name: 'Confirm withdrawal' })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByText('Withdrawn · 2 results')).toBeVisible();
  expect(f.writes).toHaveLength(2);
  expect(f.unexpected).toEqual([]);
  expect(f.errors).toEqual([]);
});
test('uncertain request retries the identical body; pending cannot dismiss', async ({
  page,
}) => {
  const f = await setup(page);
  await select(page);
  await ack(page).check();
  f.setMode('uncertain');
  await dialog(page)
    .getByRole('button', { name: 'Confirm comparability' })
    .click();
  await expect(
    dialog(page).getByRole('button', { name: 'Retry safely' }),
  ).toBeVisible();
  f.hold();
  await dialog(page).getByRole('button', { name: 'Retry safely' }).click();
  await expect.poll(() => f.entered).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeVisible();
  await expect(
    dialog(page).getByRole('button', { name: 'Close' }),
  ).toBeDisabled();
  f.release();
  await expect(dialog(page)).toHaveCount(0);
  expect(f.writes).toHaveLength(2);
  expect(f.writes[0]).toBe(f.writes[1]);
});
test('source conflict requires fresh review and never repeats writes automatically', async ({
  page,
}) => {
  const f = await setup(page);
  await select(page);
  await ack(page).check();
  f.setMode('conflict');
  await dialog(page)
    .getByRole('button', { name: 'Confirm comparability' })
    .click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'source or comparison changed',
  );
  await expect(
    dialog(page).getByRole('button', { name: 'Confirm comparability' }),
  ).toBeDisabled();
  expect(f.writes).toHaveLength(1);
});
test('focus revalidation hides protected content, preserves selection and rejects changed source', async ({
  page,
}) => {
  const f = await setup(page);
  await select(page);
  await ack(page).check();
  f.hold();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => f.entered).toBe(true);
  await expect(
    dialog(page).getByText('Checking patient access…'),
  ).toBeVisible();
  await expect(
    dialog(page).getByText('1.230000000000000001', { exact: false }),
  ).toHaveCount(0);
  f.release();
  await expect(ack(page)).toBeChecked();
  f.data.measurements[0]!.member.reviewRevision = 2;
  f.data.measurements[0]!.measurement.provenance.reviewRevision = 2;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page).getByRole('alert')).toContainText(
    'Selected results changed',
  );
  expect(f.writes).toEqual([]);
});
test('read-only delegates have sources but no comparison write controls', async ({
  page,
}) => {
  const f = await setup(page, false);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(
    page.getByText(
      'Only the profile owner can confirm or withdraw comparability.',
      { exact: false },
    ),
  ).toBeVisible();
  await page.getByText('Source details', { exact: true }).first().click();
  await expect(
    page
      .getByRole('blockquote')
      .filter({ hasText: 'result: 1.230000000000000001' }),
  ).toBeVisible();
  expect(f.writes).toEqual([]);
});
test('error retries, malformed response fails closed, revocation clears data', async ({
  page,
}) => {
  const f = await setup(page);
  f.setMode('failed');
  await page.getByRole('button', { name: 'Refresh results' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  f.setMode('normal');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('heading', { name: 'Verified results' }),
  ).toBeVisible();
  f.setMode('malformed');
  await page.getByRole('button', { name: 'Refresh results' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  f.setMode('denied');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('heading', { name: 'Choose a patient' }),
  ).toBeVisible();
  await expect(
    page.getByText('1.230000000000000001', { exact: false }),
  ).toHaveCount(0);
});
test('filter, empty and limit messages; both themes accessible and responsive', async ({
  page,
}, testInfo) => {
  const f = await setup(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('searchbox', { name: 'Find a result' }).fill('no match');
  await expect(
    page.getByText('No results match this filter.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('searchbox', { name: 'Find a result' }).fill('');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.classList.toggle('dark', t === 'dark');
      document.documentElement.dataset.theme = t;
    }, theme);
    await expect(page.locator('body')).toBeVisible();
    const axe = await new AxeBuilder({ page })
      .include('#main-content')
      .analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({
      path: `../../.local/screenshots/measurement-workspace-${testInfo.project.name}-${theme}.png`,
      fullPage: true,
    });
  }
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 780 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await select(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
    await page.keyboard.press('Escape');
  }
  await page
    .getByRole('button', { name: 'Review selection' })
    .scrollIntoViewIfNeeded();
  if (testInfo.project.name === 'mobile') {
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    const action = await page
      .getByRole('button', { name: 'Review selection' })
      .boundingBox();
    const nav = await page
      .getByRole('navigation', { name: 'Mobile navigation' })
      .boundingBox();
    expect(action!.y + action!.height).toBeLessThanOrEqual(nav!.y);
  }
  f.data.measurementsLimited = true;
  f.data.comparisonsLimited = true;
  await page.getByRole('button', { name: 'Refresh results' }).click();
  await expect(
    page.getByText('This recent verified-result list is limited.', {
      exact: false,
    }),
  ).toBeVisible();
  f.data.measurements = [];
  await page.getByRole('button', { name: 'Refresh results' }).click();
  await expect(
    page.getByText('No current verified laboratory results are available.'),
  ).toBeVisible();
  expect(f.errors).toEqual([]);
  expect(f.unexpected).toEqual([]);
});

test('source original is hash checked; cancel preserves draft and focus', async ({
  page,
}) => {
  const f = await setup(page);
  await select(page);
  await dialog(page)
    .getByText('Source details', { exact: true })
    .first()
    .click();
  await dialog(page)
    .getByRole('button', { name: 'Compare original', exact: true })
    .first()
    .click();
  await expect(
    dialog(page).getByText("Original source matches this saved text's file.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Review selection' }),
  ).toBeFocused();
  await expect(
    page.getByRole('checkbox', { name: /^Select Synthetic marker/ }).first(),
  ).toBeChecked();
  expect(f.writes).toEqual([]);
});
test('selection is capped at twenty and stale sets require explicit reconfirmation', async ({
  page,
}) => {
  const f = await setup(page);
  f.data.measurements = Array.from({ length: 21 }, (_, i) => {
    const option = structuredClone(f.data.measurements[i % 2]!);
    option.member.candidateId = `page-1-block-${i}`;
    option.measurement.source.id = option.member.candidateId;
    return option;
  });
  await page.getByRole('button', { name: 'Refresh results' }).click();
  const checks = page.getByRole('checkbox', {
    name: /^Select Synthetic marker/,
  });
  await expect(checks).toHaveCount(21);
  for (let i = 0; i < 20; i++) await checks.nth(i).check();
  await expect(checks.nth(20)).toBeDisabled();
  await expect(page.getByText('20 of 20 results selected')).toBeVisible();
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await expect(checks.nth(20)).toBeEnabled();
  const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  f.sets.set(id, {
    setId: id,
    revision: 3,
    status: 'invalid',
    canConfirm: true,
    members: f.data.measurements.slice(0, 2).map((o) => o.member),
    measurements: [],
  });
  f.data.comparisons = [
    {
      setId: id,
      revision: 3,
      status: 'invalid',
      analyte: null,
      recordedAt: '2026-11-16T00:00:00.000Z',
      memberCount: 2,
    },
  ];
  await page.getByRole('button', { name: 'Refresh results' }).click();
  await page.getByRole('button', { name: 'View comparison' }).click();
  await dialog(page)
    .getByRole('button', { name: 'Select current results' })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect(f.writes).toEqual([]);
  await page.getByRole('button', { name: 'Review selection' }).click();
  await ack(page).check();
  // Existing set and exact expected revision are retained in the write.
  f.setMode('conflict');
  await dialog(page)
    .getByRole('button', { name: 'Confirm comparability' })
    .click();
  await expect.poll(() => f.writes.length).toBe(1);
  expect(JSON.parse(f.writes[0]!).expectedRevision).toBe(3);
});
test('lost patient access clears drafts; refreshed comparison revision requires new acknowledgement', async ({
  page,
}) => {
  const f = await setup(page);
  await select(page);
  await ack(page).check();
  await dialog(page)
    .getByRole('button', { name: 'Confirm comparability' })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'View comparison' }).click();
  await dialog(page)
    .getByRole('button', { name: 'Withdraw confirmation' })
    .click();
  await ack(page).check();
  const value = [...f.sets.values()][0]!;
  value.revision = 2;
  f.data.comparisons[0]!.revision = 2;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(ack(page)).not.toBeChecked();
  await expect(
    dialog(page).getByRole('button', { name: 'Confirm withdrawal' }),
  ).toBeDisabled();
  f.setMode('revoked');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Choose a patient' }),
  ).toBeVisible();
  await expect(
    page.getByText('1.230000000000000001', { exact: false }),
  ).toHaveCount(0);
  expect(f.writes).toHaveLength(1);
});

test('stalled discovery has an actionable timeout and late responses stay hidden', async ({
  page,
}) => {
  const f = await setup(page);
  await page.clock.install();
  f.hold();
  await page.getByRole('button', { name: 'Refresh results' }).click();
  await expect.poll(() => f.entered).toBe(true);
  await page.clock.fastForward(15001);
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await expect(
    page.getByText('1.230000000000000001', { exact: false }),
  ).toHaveCount(0);
  f.release();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('heading', { name: 'Verified results' }),
  ).toBeVisible();
});
