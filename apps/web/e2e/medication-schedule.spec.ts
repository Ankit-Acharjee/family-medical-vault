import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  isSaveMedicationSchedule,
  medicationScheduleDefinitionValue,
  type MedicationScheduleEntry,
  type MedicationScheduleDefinition,
} from '@fmv/contracts';
const patient = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  medication = '11111111-1111-4111-8111-111111111111';
const clock: MedicationScheduleDefinition = {
  timing: {
    kind: 'clock-times',
    timeZone: 'Asia/Kolkata',
    weekdays: [1, 3, 5],
    times: ['08:30', '20:00'],
  },
  startDate: '2028-02-29',
  endDate: null,
  instructions: null,
};
async function setup(page: Page, owner = true) {
  let mode = 'normal',
    revision = 1,
    medicationName = 'SYNTHETIC prescription context',
    sourceState = 'current-source',
    rows: MedicationScheduleEntry[] = [],
    hold: Promise<void> | null = null,
    release: (() => void) | null = null,
    entered = false;
  const writes: string[] = [],
    unexpected: string[] = [],
    errors: string[] = [],
    saved = new Map<string, { body: string; revision: number }>();
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
        contextId: 'schedule-session',
      });
    if (path === '/api/patients')
      return json({
        patients:
          mode === 'revoked'
            ? []
            : [
                {
                  id: patient,
                  displayName: 'Synthetic schedule patient',
                  relationship: owner ? 'self' : 'caregiver',
                  capabilities: [
                    { action: 'view', scope: { kind: 'patient' } },
                  ],
                },
              ],
      });
    if (path === `/api/patients/${patient}/documents`)
      return json({ documents: [], storageReady: false });
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
    if (path.endsWith(`/${medication}/schedule`)) {
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
          medicationName,
          medicationStatus: 'current',
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
      if (!owner) return json({}, 404);
      if (mode === 'unavailable') return json({}, 503);
      if (mode === 'invalid') return json({}, 400);
      if (mode === 'conflict') return json({}, 409);
      const body = req.postDataJSON();
      if (
        !isSaveMedicationSchedule(body) ||
        body.medicationRevision !== revision
      )
        return json({}, 409);
      const previous = saved.get(body.requestId);
      if (previous)
        return previous.body === req.postData()
          ? json({ saved: true, revision: previous.revision })
          : json({}, 409);
      const latest = rows[0],
        retirement =
          !!latest &&
          latest.recordedState === 'recorded' &&
          body.recordedState === 'retired' &&
          JSON.stringify(
            medicationScheduleDefinitionValue(latest.definition),
          ) ===
            JSON.stringify(medicationScheduleDefinitionValue(body.definition));
      if (
        body.expectedRevision !== (latest?.revision ?? 0) ||
        (!latest && body.recordedState === 'retired') ||
        (sourceState !== 'current-source' && !retirement)
      )
        return json({}, 409);
      const next = body.expectedRevision + 1;
      rows = [
        {
          patientId: patient,
          medicationId: medication,
          medicationRevision: revision,
          revision: next,
          action:
            next === 1 ? 'recording' : retirement ? 'retirement' : 'correction',
          recordedAt: new Date(
            Date.UTC(2026, 10, 17, 0, 0, next),
          ).toISOString(),
          meaning: body.meaning,
          recordedState: body.recordedState,
          definition: medicationScheduleDefinitionValue(body.definition),
        },
        ...rows,
      ];
      saved.set(body.requestId, { body: req.postData()!, revision: next });
      if (mode === 'lost-ack') {
        mode = 'normal';
        return json({}, 503);
      }
      return json({ saved: true, revision: next });
    }
    unexpected.push(path);
    return json({}, 404);
  });
  await page.goto('/#medications');
  await page
    .getByRole('button', { name: 'Select patient: No patient selected' })
    .click();
  await page
    .getByRole('button', { name: /Synthetic schedule patient/ })
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
      medicationName = 'SYNTHETIC revised medication context';
    },
    source(v = 'source-review-required') {
      sourceState = v;
    },
    hold() {
      hold = new Promise((r) => (release = r));
    },
    release() {
      release?.();
      hold = null;
    },
    seed(count = 1, definition = clock) {
      rows = Array.from({ length: count }, (_, i) => ({
        patientId: patient,
        medicationId: medication,
        medicationRevision: 1,
        revision: count - i,
        action: count - i === 1 ? 'recording' : 'correction',
        recordedAt: new Date(
          Date.UTC(2026, 10, 17, 0, 0, count - i),
        ).toISOString(),
        meaning: 'owner-recorded-informational-schedule',
        recordedState: 'recorded',
        definition: structuredClone(definition),
      }));
    },
  };
}
const dialog = (p: Page) => p.getByRole('dialog');
async function open(p: Page) {
  await p.getByRole('button', { name: /^Schedule for/ }).click();
  await expect(
    dialog(p).getByRole('heading', {
      name: 'Medication schedule',
      exact: true,
    }),
  ).toBeVisible();
}
async function begin(p: Page) {
  await dialog(p)
    .getByRole('button', { name: 'Record schedule', exact: true })
    .click();
  await expect(
    dialog(p).getByRole('textbox', { name: 'Timing as reported', exact: true }),
  ).toBeVisible();
}
const confirm = (p: Page, retirement = false) =>
  dialog(p)
    .getByRole('checkbox', {
      name: retirement ? /I confirm retiring only/ : /I reviewed this timing/,
    })
    .check();
async function literal(p: Page) {
  await dialog(p)
    .getByRole('textbox', { name: 'Timing as reported', exact: true })
    .fill('SYNTHETIC as needed? uncertainty retained');
  await confirm(p);
}
const save = (p: Page) =>
  dialog(p)
    .getByRole('button', { name: 'Confirm recorded schedule', exact: true })
    .click();
test('literal recording and correction preserve timing, dismiss success and restore focus', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await expect(dialog(page).getByText(/No schedule recorded/)).toBeVisible();
  await begin(page);
  await literal(page);
  await save(page);
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /^Schedule for/ }),
  ).toBeFocused();
  expect(f.rows[0]!.definition.timing).toEqual({
    kind: 'literal',
    text: 'SYNTHETIC as needed? uncertainty retained',
  });
  expect(f.rows[0]!.definition.startDate).toBeNull();
  await open(page);
  await dialog(page)
    .getByRole('button', { name: 'Edit schedule', exact: true })
    .click();
  await expect(
    dialog(page).getByRole('textbox', {
      name: 'Timing as reported',
      exact: true,
    }),
  ).toHaveValue('SYNTHETIC as needed? uncertainty retained');
  await dialog(page)
    .getByRole('textbox', { name: 'Instructions (optional)' })
    .fill('Owner reported wording');
  await confirm(page);
  await save(page);
  await expect(dialog(page)).toHaveCount(0);
  expect(f.rows).toHaveLength(2);
  expect(f.rows[1]!.definition.instructions).toBeNull();
  expect(JSON.parse(f.writes[0]!)).not.toHaveProperty('recordedStatus');
  expect(f.errors).toEqual([]);
  expect(f.unexpected).toEqual([]);
});
test('clock times require explicit days and zone, retain exact dates and sort without dose inference', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await begin(page);
  await dialog(page)
    .getByRole('combobox', { name: 'Timing style' })
    .selectOption('clock-times');
  await dialog(page)
    .getByRole('textbox', { name: 'Timezone for these clock times' })
    .fill('Asia/Kolkata');
  await dialog(page).getByRole('button', { name: 'Select every day' }).click();
  await dialog(page).getByLabel('Clock time 1', { exact: true }).fill('20:00');
  await dialog(page).getByRole('button', { name: 'Add clock time' }).click();
  await dialog(page).getByLabel('Clock time 2', { exact: true }).fill('08:30');
  await dialog(page)
    .getByLabel('Schedule starts (optional)')
    .fill('2028-02-29');
  await confirm(page);
  await save(page);
  await expect(dialog(page)).toHaveCount(0);
  expect(f.rows[0]!.definition).toEqual({
    timing: {
      kind: 'clock-times',
      timeZone: 'Asia/Kolkata',
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      times: ['08:30', '20:00'],
    },
    startDate: '2028-02-29',
    endDate: null,
    instructions: null,
  });
  await open(page);
  await expect(
    dialog(page).getByText('08:30, 20:00 · Asia/Kolkata', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog(page).getByText('2028-02-29 / Not recorded', { exact: true }),
  ).toBeVisible();
});
test('invalid timing remains editable and requires renewed explicit confirmation', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await begin(page);
  await confirm(page);
  await save(page);
  await expect(dialog(page).getByRole('alert')).toHaveText(
    /Enter timing as reported/,
  );
  expect(f.writes).toHaveLength(0);
  await literal(page);
  f.mode('invalid');
  await save(page);
  await expect(dialog(page).getByRole('alert')).toHaveText(/not accepted/);
  await dialog(page)
    .getByRole('textbox', { name: 'Timing as reported', exact: true })
    .fill('Corrected literal wording');
  await expect(
    dialog(page).getByRole('checkbox', { name: /I reviewed this timing/ }),
  ).not.toBeChecked();
  await confirm(page);
  f.mode('normal');
  await save(page);
  await expect(dialog(page)).toHaveCount(0);
  expect(JSON.parse(f.writes[0]!).requestId).not.toBe(
    JSON.parse(f.writes[1]!).requestId,
  );
});
test('retirement preserves history and source review never silently reactivates a schedule', async ({
  page,
}) => {
  const f = await setup(page);
  f.seed();
  f.source();
  await open(page);
  await expect(
    dialog(page).getByRole('button', {
      name: 'Review and record schedule',
      exact: true,
    }),
  ).toBeDisabled();
  await dialog(page)
    .getByRole('button', { name: 'Retire schedule', exact: true })
    .click();
  await expect(dialog(page).getByRole('textbox')).toHaveCount(0);
  await expect(
    dialog(page).getByRole('button', { name: 'Confirm schedule retirement' }),
  ).toBeDisabled();
  await confirm(page, true);
  await dialog(page)
    .getByRole('button', { name: 'Confirm schedule retirement' })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect(f.rows[0]!.recordedState).toBe('retired');
  expect(f.rows[0]!.definition).toEqual(f.rows[1]!.definition);
  f.source('current-source');
  f.changeMedication();
  await open(page);
  await expect(
    dialog(page).getByText('Retired schedule · Version 2', { exact: true }),
  ).toBeVisible();
  await expect(dialog(page).getByRole('textbox')).toHaveCount(0);
  await expect(
    dialog(page).getByText('Medication: SYNTHETIC revised medication context', {
      exact: true,
    }),
  ).toBeVisible();
  await dialog(page)
    .getByRole('button', { name: 'Review and record schedule', exact: true })
    .click();
  await expect(
    dialog(page).getByRole('checkbox', { name: /I reviewed this timing/ }),
  ).not.toBeChecked();
  await confirm(page);
  await save(page);
  await expect(dialog(page)).toHaveCount(0);
  expect(f.rows[0]!.medicationRevision).toBe(2);
  expect(f.rows[0]!.recordedState).toBe('recorded');
  expect(f.rows[1]!.recordedState).toBe('retired');
});
test('pending saves cannot dismiss; exact retries and lost acknowledgement checks do not duplicate', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await begin(page);
  await literal(page);
  f.mode('hold-save');
  await save(page);
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
    dialog(page).getByRole('textbox', {
      name: 'Timing as reported',
      exact: true,
    }),
  ).toBeDisabled();
  f.mode('normal');
  await dialog(page).getByRole('button', { name: 'Retry exact save' }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(f.writes[1]).toBe(f.writes[0]);
  await open(page);
  await dialog(page)
    .getByRole('button', { name: 'Edit schedule', exact: true })
    .click();
  await confirm(page);
  f.mode('lost-ack');
  await save(page);
  await dialog(page)
    .getByRole('button', { name: 'Check latest schedule version' })
    .click();
  await expect(
    dialog(page).getByRole('button', { name: 'Discard draft and load latest' }),
  ).toBeVisible();
  await dialog(page)
    .getByRole('button', { name: 'Discard draft and load latest' })
    .click();
  await expect(
    dialog(page).getByText('Recorded schedule · Version 2', { exact: true }),
  ).toBeVisible();
  expect(f.rows).toHaveLength(2);
  expect(f.writes).toHaveLength(3);
});
test('same-context focus checks retain clock drafts and modal height; revocation clears them', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await begin(page);
  await dialog(page)
    .getByRole('combobox', { name: 'Timing style' })
    .selectOption('clock-times');
  await dialog(page)
    .getByRole('textbox', { name: 'Timezone for these clock times' })
    .fill('Asia/Kolkata');
  await dialog(page)
    .getByRole('checkbox', { name: 'Monday', exact: true })
    .check();
  await dialog(page).getByLabel('Clock time 1', { exact: true }).fill('08:30');
  await confirm(page);
  const initial = await dialog(page).boundingBox();
  f.hold();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page).getByRole('textbox')).toHaveCount(0);
  expect(
    Math.abs((await dialog(page).boundingBox())!.height - initial!.height),
  ).toBeLessThanOrEqual(2);
  f.release();
  await expect(
    dialog(page).getByRole('textbox', {
      name: 'Timezone for these clock times',
    }),
  ).toHaveValue('Asia/Kolkata');
  await expect(
    dialog(page).getByLabel('Clock time 1', { exact: true }),
  ).toHaveValue('08:30');
  await expect(
    dialog(page).getByRole('checkbox', { name: 'Monday', exact: true }),
  ).toBeChecked();
  f.mode('revoked');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page)).toHaveCount(0);
  expect(f.writes).toHaveLength(0);
});
test('delegates read bounded preserved history without schedule write controls', async ({
  page,
}) => {
  const f = await setup(page, false);
  f.seed(23);
  await open(page);
  await expect(dialog(page).getByRole('textbox')).toHaveCount(0);
  await expect(
    dialog(page).getByRole('button', { name: 'Edit schedule', exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog(page).getByRole('button', { name: 'Retire schedule', exact: true }),
  ).toHaveCount(0);
  await dialog(page)
    .getByRole('button', { name: 'Older schedule versions' })
    .click();
  await expect(
    dialog(page).getByText('Recorded schedule · Version 23', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog(page).getByText('Recorded schedule · Version 1', { exact: true }),
  ).toBeVisible();
  expect(f.writes).toHaveLength(0);
});
test('failed and malformed loads retry; changed source or concurrent versions require explicit reload', async ({
  page,
}) => {
  const f = await setup(page);
  f.mode('failed');
  await open(page);
  await expect(dialog(page).getByRole('alert')).toHaveText(
    'Schedule could not be loaded.',
  );
  f.mode('malformed');
  await dialog(page).getByRole('button', { name: 'Try again' }).click();
  await expect(dialog(page).getByRole('alert')).toHaveText(
    'Schedule could not be loaded.',
  );
  f.mode('normal');
  await dialog(page).getByRole('button', { name: 'Try again' }).click();
  await begin(page);
  await literal(page);
  f.changeMedication();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    dialog(page).getByRole('button', { name: 'Discard draft and load latest' }),
  ).toBeVisible();
  await dialog(page)
    .getByRole('button', { name: 'Discard draft and load latest' })
    .click();
  await expect(
    dialog(page).getByText('Medication: SYNTHETIC revised medication context', {
      exact: true,
    }),
  ).toBeVisible();
  await begin(page);
  await literal(page);
  f.mode('conflict');
  await save(page);
  await expect(
    dialog(page).getByRole('button', { name: 'Discard draft and load latest' }),
  ).toBeVisible();
  expect(f.rows).toHaveLength(0);
});
test('schedule editor supports both themes, accessible controls and 320px scrolling', async ({
  page,
}, info) => {
  const f = await setup(page);
  f.seed();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await dialog(page)
    .getByRole('button', { name: 'Edit schedule', exact: true })
    .click();
  await expect(
    dialog(page).getByRole('checkbox', { name: 'Monday', exact: true }),
  ).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await dialog(page).evaluate((e) => (e.scrollTop = 0));
    await page.screenshot({
      path: `../../.local/screenshots/medication-schedule-${info.project.name}-${theme}.png`,
    });
  }
  await page.setViewportSize({ width: 320, height: 780 });
  await confirm(page);
  await dialog(page)
    .getByRole('button', { name: 'Confirm recorded schedule', exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await dialog(page).evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({
    path: `../../.local/screenshots/medication-schedule-${info.project.name}-320-actions.png`,
  });
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(f.errors).toEqual([]);
  expect(f.unexpected).toEqual([]);
});

test('clock controls enforce weekday, duplicate-time and row limits without losing remaining values', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await begin(page);
  await dialog(page)
    .getByRole('combobox', { name: 'Timing style' })
    .selectOption('clock-times');
  await dialog(page)
    .getByRole('textbox', { name: 'Timezone for these clock times' })
    .fill('UTC');
  await dialog(page).getByLabel('Clock time 1', { exact: true }).fill('08:30');
  await confirm(page);
  await save(page);
  await expect(dialog(page).getByRole('alert')).toHaveText(
    /Enter timing as reported/,
  );
  expect(f.writes).toHaveLength(0);
  await dialog(page)
    .getByRole('checkbox', { name: 'Monday', exact: true })
    .check();
  await dialog(page).getByRole('button', { name: 'Add clock time' }).click();
  await dialog(page).getByLabel('Clock time 2', { exact: true }).fill('08:30');
  await confirm(page);
  await save(page);
  await expect(dialog(page).getByRole('alert')).toHaveText(
    /unique clock times/,
  );
  expect(f.writes).toHaveLength(0);
  await dialog(page).getByLabel('Clock time 2', { exact: true }).fill('20:00');
  for (let n = 2; n < 8; n++)
    await dialog(page).getByRole('button', { name: 'Add clock time' }).click();
  await expect(
    dialog(page).getByRole('button', { name: 'Add clock time' }),
  ).toBeDisabled();
  await dialog(page)
    .getByRole('button', { name: 'Remove clock time 1', exact: true })
    .click();
  await expect(
    dialog(page).getByLabel('Clock time 1', { exact: true }),
  ).toHaveValue('20:00');
  await expect(
    dialog(page).getByRole('button', { name: 'Add clock time' }),
  ).toBeEnabled();
  expect(f.writes).toHaveLength(0);
});

const reminderClock: MedicationScheduleDefinition = {
  timing: {
    kind: 'clock-times',
    timeZone: 'UTC',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    times: ['12:01'],
  },
  startDate: null,
  endDate: null,
  instructions: null,
};
async function reminderSetup(
  page: Page,
  owner = true,
  definition = reminderClock,
) {
  await page.clock.install({ time: new Date('2026-11-18T12:00:00Z') });
  const f = await setup(page, owner);
  f.seed(1, definition);
  await open(page);
  await page.clock.pauseAt(new Date('2026-11-18T12:00:10Z'));
  return f;
}
async function enableReminder(page: Page) {
  await dialog(page)
    .getByRole('button', { name: 'Enable page reminder', exact: true })
    .click();
  for (let n = 0; n < 8; n++) {
    await page.clock.runFor(1000);
    if (
      await dialog(page)
        .getByText('Page reminder enabled for this schedule.', { exact: true })
        .isVisible()
    )
      return;
  }
  await expect(
    dialog(page).getByText('Page reminder enabled for this schedule.', {
      exact: true,
    }),
  ).toBeVisible();
}
test('page reminders remain after dialog close, emit generic notices, stop and clear on route departure', async ({
  page,
}, testInfo) => {
  const f = await reminderSetup(page);
  await enableReminder(page);
  await dialog(page)
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  await page.clock.runFor(55000);
  const region = page.getByRole('region', {
    name: 'Page reminders',
    exact: true,
  });
  await expect(
    region.getByText('A page reminder is due. Review your recorded schedule.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(region).not.toContainText('SYNTHETIC');
  expect(f.writes).toHaveLength(0);
  await page.clock.resume();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await region.getByRole('button', { name: 'Stop page reminders' }).focus();
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await page.screenshot({
      path: `../../.local/screenshots/page-reminder-${testInfo.project.name}-${theme}.png`,
      fullPage: false,
      animations: 'disabled',
    });
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await region.getByRole('button', { name: 'Stop page reminders' }).click();
  await expect(region).toHaveCount(0);
  await open(page);
  await enableReminder(page);
  await dialog(page)
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  await page.evaluate(() => {
    window.location.hash = 'overview';
  });
  await expect(region).toHaveCount(0);
  await page.evaluate(() => {
    window.location.hash = 'medications';
  });
  await expect(
    page.getByRole('heading', { name: 'Recorded medication context' }),
  ).toBeVisible();
  await expect(region).toHaveCount(0);
  expect(f.errors).toEqual([]);
  expect(f.unexpected).toEqual([]);
});
test('reminder due checks stop on changed source and cannot dispatch stale context', async ({
  page,
}) => {
  const f = await reminderSetup(page);
  await enableReminder(page);
  await dialog(page)
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  f.source();
  await page.clock.runFor(55000);
  const region = page.getByRole('region', {
    name: 'Page reminders',
    exact: true,
  });
  await expect(region).toContainText('A reminder stopped');
  await expect(region).not.toContainText('A page reminder is due');
  expect(f.writes).toHaveLength(0);
  expect(f.errors).toEqual([]);
});
test('reminders are owner-only and literal timing remains informational', async ({
  page,
}) => {
  const f = await reminderSetup(page, false);
  await expect(
    dialog(page).getByRole('button', { name: 'Enable page reminder' }),
  ).toHaveCount(0);
  expect(f.writes).toHaveLength(0);
});
test('ambiguous clock day requires review without choosing an occurrence', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-01T04:00:00Z') });
  const f = await setup(page);
  f.seed(1, {
    ...reminderClock,
    timing: {
      kind: 'clock-times',
      timeZone: 'America/New_York',
      weekdays: [7],
      times: ['01:30'],
    },
  });
  await open(page);
  await page.clock.pauseAt(new Date('2026-11-01T04:00:10Z'));
  await dialog(page)
    .getByRole('button', { name: 'Enable page reminder' })
    .click();
  for (let n = 0; n < 8; n++) await page.clock.runFor(1000);
  await expect(dialog(page)).toContainText(
    'Owner review is required; no occurrence was chosen.',
  );
  expect(f.writes).toHaveLength(0);
  expect(f.errors).toEqual([]);
});
test('hidden-page return skips the elapsed clock minute and pagehide clears opt-in', async ({
  page,
}) => {
  const f = await reminderSetup(page);
  await enableReminder(page);
  await dialog(page)
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(55000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(10000);
  const region = page.getByRole('region', {
    name: 'Page reminders',
    exact: true,
  });
  await expect(region).not.toContainText('A page reminder is due');
  await open(page);
  await expect(dialog(page)).toContainText(
    'Page reminder enabled for this schedule.',
  );
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide')),
  );
  await expect(
    dialog(page).getByRole('button', {
      name: 'Enable page reminder',
      exact: true,
    }),
  ).toBeEnabled();
  expect(f.writes).toHaveLength(0);
  expect(f.errors).toEqual([]);
});
test('literal timing has no reminder occurrence and failed opt-in can be explicitly retried', async ({
  page,
}) => {
  const f = await reminderSetup(page, true, {
    ...reminderClock,
    timing: { kind: 'literal', text: 'SYNTHETIC uncertain timing' },
  });
  await expect(
    dialog(page).getByRole('button', {
      name: 'Enable page reminder',
      exact: true,
    }),
  ).toBeDisabled();
  await dialog(page)
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  f.seed(1, reminderClock);
  await open(page);
  f.mode('failed');
  await dialog(page)
    .getByRole('button', { name: 'Enable page reminder', exact: true })
    .click();
  await page.clock.runFor(1000);
  await expect(dialog(page)).toContainText(
    'Reminder stopped. Reload and review the current schedule before trying again.',
  );
  await dialog(page)
    .getByRole('button', { name: 'Stop this page reminder' })
    .click();
  f.mode('normal');
  await enableReminder(page);
  expect(f.writes).toHaveLength(0);
  expect(f.errors).toEqual([]);
});
