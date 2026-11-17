import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  extractMedicationFields,
  isSaveMedicationReconciliation,
  type MedicationReconciliationEntry,
  type MedicationSourceBinding,
} from '@fmv/contracts';
const p = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  doc = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  existingId = '11111111-1111-4111-8111-111111111111';
const source = extractMedicationFields([
  {
    page: 1,
    text: 'Medication: SYNTHETIC stopped? uncertain wording\nDose: source literal dose\nFrequency: if needed?',
  },
])[0]!;
const fields = {
  medication: source.fields.medication.value,
  strength: null,
  dose: 'owner-corrected literal dose',
  frequency: 'owner recorded frequency',
  route: null,
  duration: null,
  start: null,
  end: null,
  instructions: null,
};
async function setup(page: Page, owner = true) {
  let rows: MedicationReconciliationEntry[] = [],
    mode = 'normal',
    reviewRevision = 1,
    lifecycleVersion = 0,
    hold: Promise<void> | null = null,
    release: (() => void) | null = null;
  const writes: { id: string; body: string }[] = [],
    unexpected: string[] = [],
    errors: string[] = [];
  let optionsReads = 0,
    entered = false;
  const binding = (): MedicationSourceBinding => ({
    documentId: doc,
    candidateId: source.id,
    sourceRevision: 1,
    sourceSha256: 'a'.repeat(64),
    lifecycleVersion,
    reviewRevision,
  });
  const latest = () => rows[0];
  const view = (entry: MedicationReconciliationEntry) => ({
    entry,
    sourceState:
      entry.source.reviewRevision === reviewRevision &&
      entry.source.lifecycleVersion === lifecycleVersion
        ? 'current-source'
        : 'source-review-required',
  });
  const seed = (status: 'current' | 'historical' = 'historical') => {
    rows = [
      {
        medicationId: existingId,
        patientId: p,
        revision: 1,
        action: 'reconciliation',
        recordedAt: '2026-11-17T00:00:01.000Z',
        meaning: 'owner-recorded-medication-context',
        source: binding(),
        recordedStatus: status,
        fields: { ...fields },
      },
    ];
  };
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
          contextId: 'medication-owner-session',
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
                    displayName: 'Synthetic owner patient',
                    relationship: owner ? 'self' : 'caregiver',
                    capabilities: [
                      { action: 'view', scope: { kind: 'patient' } },
                    ],
                  },
                ],
        },
      });
    if (path.endsWith('/medication-reconciliations'))
      return route.fulfill({
        json: {
          patientId: p,
          canWrite: owner,
          entries: latest() ? [view(latest()!)] : [],
          nextCursor: null,
        },
      });
    if (path.endsWith('/medication-reconciliations/source-options')) {
      optionsReads++;
      if (hold) await hold;
      if (mode === 'choices-failed')
        return route.fulfill({ status: 503, json: {} });
      if (mode === 'denied' || !owner)
        return route.fulfill({ status: 404, json: {} });
      return route.fulfill({
        json: {
          patientId: mode === 'bad-choices' ? 'wrong' : p,
          canWrite: true,
          options:
            mode === 'empty-choices'
              ? []
              : [
                  {
                    title: 'SYNTHETIC prescription.pdf',
                    source,
                    binding: binding(),
                    existingRecord:
                      rows.some(
                        (row) =>
                          row.source.lifecycleVersion === lifecycleVersion,
                      ) && latest()
                        ? {
                            medicationId: latest()!.medicationId,
                            revision: latest()!.revision,
                          }
                        : null,
                  },
                ],
          limited: false,
        },
      });
    }
    if (path.includes('/medication-reconciliations/')) {
      const id = path.split('/').at(-1)!;
      if (req.method() === 'GET') {
        const versions = rows.filter((row) => row.medicationId === id);
        if (!versions.length) return route.fulfill({ status: 404, json: {} });
        return route.fulfill({
          json: {
            current: view(versions[0]!),
            canWrite: owner,
            history: versions.map(view),
            nextBeforeRevision: null,
          },
        });
      }
      if (req.method() === 'PUT') {
        const raw = req.postData()!;
        writes.push({ id, body: raw });
        entered = true;
        if (hold) await hold;
        if (mode === 'fail') return route.fulfill({ status: 503, json: {} });
        if (mode === 'invalid') return route.fulfill({ status: 400, json: {} });
        if (mode === 'denied' || !owner)
          return route.fulfill({ status: 404, json: {} });
        const body = JSON.parse(raw);
        expect(isSaveMedicationReconciliation(body)).toBe(true);
        if (
          mode === 'conflict' ||
          body.source.reviewRevision !== reviewRevision ||
          body.source.lifecycleVersion !== lifecycleVersion ||
          rows.some(
            (row) =>
              row.source.lifecycleVersion === lifecycleVersion &&
              row.medicationId !== id,
          ) ||
          body.expectedRevision !==
            (rows.find((row) => row.medicationId === id)?.revision ?? 0)
        )
          return route.fulfill({ status: 409, json: {} });
        const revision = body.expectedRevision + 1;
        rows = [
          {
            medicationId: id,
            patientId: p,
            revision,
            action: revision === 1 ? 'reconciliation' : 'correction',
            recordedAt: `2026-11-17T00:00:${String(revision).padStart(2, '0')}.000Z`,
            meaning: body.meaning,
            source: body.source,
            recordedStatus: body.recordedStatus,
            fields: body.fields,
          },
          ...rows,
        ];
        if (mode === 'lost-ack') {
          mode = 'normal';
          return route.fulfill({ status: 503, json: {} });
        }
        return route.fulfill({ json: { saved: true, revision } });
      }
    }
    unexpected.push(path);
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/#medications');
  await page
    .getByRole('button', { name: 'Select patient: No patient selected' })
    .click();
  await page.getByRole('button', { name: /Synthetic owner patient/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Recorded medication context' }),
  ).toBeVisible();
  return {
    writes,
    unexpected,
    errors,
    seed,
    get rows() {
      return rows;
    },
    get optionsReads() {
      return optionsReads;
    },
    get entered() {
      return entered;
    },
    setMode(v: string) {
      mode = v;
    },
    renewSource() {
      reviewRevision++;
    },
    restoreAndReviewSource() {
      lifecycleVersion += 2;
      reviewRevision++;
    },
    hold() {
      entered = false;
      hold = new Promise((r) => (release = r));
    },
    release() {
      release?.();
      hold = null;
    },
  };
}
const dialog = (page: Page) => page.getByRole('dialog');
async function begin(page: Page) {
  await page
    .getByRole('button', { name: 'Record medication', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Reviewed prescription source' })
    .selectOption({ index: 1 });
  await expect(
    dialog(page).getByRole('textbox', { name: 'Medication name', exact: true }),
  ).toBeVisible();
}
async function confirm(page: Page, status = 'current') {
  await dialog(page)
    .getByRole('combobox', { name: 'Recorded status' })
    .selectOption(status);
  await dialog(page).getByRole('checkbox').check();
}
test('owner explicitly records reviewed source context and success dismisses the modal', async ({
  page,
}) => {
  const f = await setup(page);
  await begin(page);
  await expect(
    dialog(page).getByRole('combobox', { name: 'Recorded status' }),
  ).toHaveValue('');
  await expect(dialog(page).getByRole('textbox', { name: /Dose/ })).toHaveValue(
    'source literal dose',
  );
  await expect(
    dialog(page).getByRole('button', { name: 'Confirm medication record' }),
  ).toBeDisabled();
  await confirm(page, 'historical');
  await dialog(page)
    .getByRole('button', { name: 'Confirm medication record' })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Recorded historical', exact: true }),
  ).toContainText(source.fields.medication.value);
  expect(f.rows).toHaveLength(1);
  expect(f.rows[0]!.fields.strength).toBeNull();
  expect(f.rows[0]!.recordedStatus).toBe('historical');
  expect(f.writes).toHaveLength(1);
  expect(f.errors).toEqual([]);
  expect(f.unexpected).toEqual([]);
});
test('an already-recorded source reuses its identity and preserves owner corrections after re-review', async ({
  page,
}) => {
  const f = await setup(page);
  f.seed();
  f.renewSource();
  await page.getByRole('button', { name: 'Refresh medications' }).click();
  await begin(page);
  await expect(dialog(page)).toContainText('Existing record · revision 1');
  await expect(dialog(page).getByRole('textbox', { name: /Dose/ })).toHaveValue(
    'owner-corrected literal dose',
  );
  await expect(
    dialog(page).getByRole('combobox', { name: 'Recorded status' }),
  ).toHaveValue('historical');
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('textbox', { name: /Frequency/ })
    .fill('explicit revised wording');
  await expect(dialog(page).getByRole('checkbox')).not.toBeChecked();
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('button', { name: 'Save medication update' })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect(new Set(f.rows.map((r) => r.medicationId)).size).toBe(1);
  expect(f.rows[0]!.medicationId).toBe(existingId);
  expect(f.rows[0]!.revision).toBe(2);
  expect(f.rows[1]!.fields.frequency).toBe('owner recorded frequency');
  expect(f.rows[0]!.source.reviewRevision).toBe(2);
});
test('direct correction uses one dialog and preserves current history while recording historical status', async ({
  page,
}) => {
  const f = await setup(page);
  f.seed('current');
  await page.getByRole('button', { name: 'Refresh medications' }).click();
  await page.getByRole('button', { name: /Details and history/ }).click();
  await page
    .getByRole('button', { name: 'Update recorded medication' })
    .click();
  await expect(dialog(page)).toHaveCount(1);
  await expect(
    dialog(page).getByRole('heading', { name: 'Update recorded medication' }),
  ).toBeVisible();
  await confirm(page, 'historical');
  await dialog(page)
    .getByRole('button', { name: 'Save medication update' })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect(f.rows[0]!.recordedStatus).toBe('historical');
  expect(f.rows[1]!.recordedStatus).toBe('current');
  await expect(
    page.getByRole('heading', { name: 'Recorded medication context' }),
  ).toBeFocused();
});
test('pending saves cannot close; uncertain retries reuse the exact sealed request', async ({
  page,
}) => {
  const f = await setup(page);
  await begin(page);
  await confirm(page);
  f.hold();
  await dialog(page)
    .getByRole('button', { name: 'Confirm medication record' })
    .click();
  await expect.poll(() => f.entered).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeVisible();
  await expect(
    dialog(page).getByRole('button', { name: 'Close dialog' }),
  ).toBeDisabled();
  f.setMode('fail');
  f.release();
  await expect(
    dialog(page).getByRole('button', { name: 'Retry exact save' }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole('textbox', { name: /Dose/ }),
  ).toBeDisabled();
  f.setMode('normal');
  await dialog(page).getByRole('button', { name: 'Retry exact save' }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(f.writes).toHaveLength(2);
  expect(f.writes[0]).toEqual(f.writes[1]);
  expect(f.rows).toHaveLength(1);
});
test('lost acknowledgement checks the existing saved record without a second creation', async ({
  page,
}) => {
  const f = await setup(page);
  await begin(page);
  await dialog(page)
    .getByRole('textbox', { name: /Dose/ })
    .fill('owner exact draft');
  await confirm(page);
  f.setMode('lost-ack');
  await dialog(page)
    .getByRole('button', { name: 'Confirm medication record' })
    .click();
  await expect(
    dialog(page).getByRole('button', { name: 'Retry exact save' }),
  ).toBeVisible();
  await dialog(page)
    .getByRole('button', { name: 'Check latest recorded version' })
    .click();
  await expect(dialog(page)).toContainText(
    'The source or recorded version changed',
  );
  await dialog(page)
    .getByRole('button', { name: 'Discard draft and load latest' })
    .click();
  await expect(dialog(page).getByRole('textbox', { name: /Dose/ })).toHaveValue(
    'owner exact draft',
  );
  await expect(
    dialog(page).getByRole('button', { name: 'Save medication update' }),
  ).toBeDisabled();
  await dialog(page)
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Recorded current', exact: true }),
  ).toContainText('owner exact draft');
  expect(f.rows).toHaveLength(1);
  expect(f.writes).toHaveLength(1);
});
test('drafts survive same-context focus checks, and lost access clears the form', async ({
  page,
}) => {
  const f = await setup(page);
  await begin(page);
  await dialog(page)
    .getByRole('textbox', { name: /Dose/ })
    .fill('retained owner draft');
  await confirm(page);
  const initial = await dialog(page).boundingBox();
  f.hold();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page).getByRole('textbox', { name: /Dose/ })).toHaveCount(
    0,
  );
  const checking = await dialog(page).boundingBox();
  expect(Math.abs(initial!.height - checking!.height)).toBeLessThanOrEqual(2);
  f.release();
  await expect(dialog(page).getByRole('textbox', { name: /Dose/ })).toHaveValue(
    'retained owner draft',
  );
  f.setMode('revoked');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByText('retained owner draft')).toHaveCount(0);
  expect(f.writes).toHaveLength(0);
});
test('source changes, empty choices and recoverable errors never infer a new medication', async ({
  page,
}) => {
  const f = await setup(page);
  f.setMode('choices-failed');
  await page
    .getByRole('button', { name: 'Record medication', exact: true })
    .click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'could not be loaded',
  );
  f.setMode('empty-choices');
  await dialog(page).getByRole('button', { name: 'Try loading again' }).click();
  await expect(dialog(page)).toContainText(
    'No current owner-reviewed prescription blocks',
  );
  await expect(
    dialog(page).getByRole('button', { name: 'Review prescription documents' }),
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  f.setMode('normal');
  await begin(page);
  f.renewSource();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page)).toContainText('selected source changed');
  await expect(
    dialog(page).getByRole('button', { name: 'Confirm medication record' }),
  ).toHaveCount(0);
  expect(f.writes).toHaveLength(0);
});
test('delegates cannot open recording or correction actions', async ({
  page,
}) => {
  const f = await setup(page, false);
  f.seed('current');
  await page.getByRole('button', { name: 'Refresh medications' }).click();
  await expect(
    page.getByRole('button', { name: 'Record medication', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: /Details and history/ }).click();
  await expect(
    page.getByRole('button', { name: 'Update recorded medication' }),
  ).toHaveCount(0);
  expect(f.optionsReads).toBe(0);
  expect(f.writes).toHaveLength(0);
});
test('owner form supports both themes, keyboard, axe and narrow overflow', async ({
  page,
}, info) => {
  const f = await setup(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await begin(page);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await dialog(page).evaluate((e) => (e.scrollTop = 0));
    await page.screenshot({
      path: `../../.local/screenshots/medication-owner-${info.project.name}-${theme}.png`,
    });
    if (info.project.name === 'mobile') {
      await dialog(page).evaluate((e) => (e.scrollTop = e.scrollHeight));
      await page.screenshot({
        path: `../../.local/screenshots/medication-owner-mobile-${theme}-actions.png`,
      });
    }
  }
  await page.setViewportSize({ width: 320, height: 780 });
  await confirm(page);
  await dialog(page)
    .getByRole('button', { name: 'Confirm medication record' })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(f.errors).toEqual([]);
  expect(f.unexpected).toEqual([]);
  expect(f.writes).toHaveLength(0);
});

test('validation and rejected input remain editable and require renewed confirmation', async ({
  page,
}) => {
  const f = await setup(page);
  await begin(page);
  await confirm(page);
  await dialog(page)
    .getByRole('textbox', { name: 'Medication name', exact: true })
    .fill('');
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('button', { name: 'Confirm medication record' })
    .click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'enter a medication name',
  );
  expect(f.writes).toHaveLength(0);
  await dialog(page)
    .getByRole('textbox', { name: 'Medication name', exact: true })
    .fill('SYNTHETIC explicit entry');
  await dialog(page).getByRole('checkbox').check();
  f.setMode('invalid');
  await dialog(page)
    .getByRole('button', { name: 'Confirm medication record' })
    .click();
  await expect(dialog(page).getByRole('alert')).toContainText('not accepted');
  await expect(
    dialog(page).getByRole('textbox', { name: /Dose/ }),
  ).toBeEnabled();
  f.setMode('normal');
  await dialog(page)
    .getByRole('textbox', { name: /Dose/ })
    .fill('explicit correction');
  await expect(dialog(page).getByRole('checkbox')).not.toBeChecked();
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('button', { name: 'Confirm medication record' })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect(f.rows).toHaveLength(1);
  expect(f.writes).toHaveLength(2);
  expect(JSON.parse(f.writes[0]!.body).requestId).not.toBe(
    JSON.parse(f.writes[1]!.body).requestId,
  );
});
test('a concurrent source claim reloads the existing identity instead of creating another record', async ({
  page,
}) => {
  const f = await setup(page);
  await begin(page);
  await confirm(page);
  f.seed();
  await dialog(page)
    .getByRole('button', { name: 'Confirm medication record' })
    .click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'source already has a record',
  );
  await expect(
    dialog(page).getByRole('textbox', { name: /Dose/ }),
  ).toBeDisabled();
  await dialog(page)
    .getByRole('button', { name: 'Discard draft and load latest' })
    .click();
  await expect(dialog(page).getByRole('textbox', { name: /Dose/ })).toHaveValue(
    'owner-corrected literal dose',
  );
  await expect(
    dialog(page).getByRole('combobox', { name: 'Recorded status' }),
  ).toHaveValue('historical');
  await expect(dialog(page).getByRole('checkbox')).not.toBeChecked();
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('button', { name: 'Save medication update' })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect(new Set(f.rows.map((r) => r.medicationId)).size).toBe(1);
  expect(f.rows).toHaveLength(2);
  expect(f.writes[0]!.id).not.toBe(existingId);
  expect(f.writes[1]!.id).toBe(existingId);
  expect(f.errors).toEqual([]);
});

test('an explicitly re-reviewed restored source relinks the same record and retains prior context', async ({
  page,
}) => {
  const f = await setup(page);
  f.seed('historical');
  f.restoreAndReviewSource();
  await page.getByRole('button', { name: 'Refresh medications' }).click();
  await page.getByRole('button', { name: /Details and history/ }).click();
  await expect(dialog(page)).toContainText('Source review required');
  await page
    .getByRole('button', { name: 'Review source and update record' })
    .click();
  await expect(dialog(page)).toHaveCount(1);
  await dialog(page)
    .getByRole('combobox', { name: 'Reviewed prescription source' })
    .selectOption({ index: 1 });
  await expect(dialog(page).getByRole('textbox', { name: /Dose/ })).toHaveValue(
    'owner-corrected literal dose',
  );
  await expect(
    dialog(page).getByRole('combobox', { name: 'Recorded status' }),
  ).toHaveValue('historical');
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('button', { name: 'Save medication update' })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect(f.rows[0]!.medicationId).toBe(existingId);
  expect(f.rows[0]!.revision).toBe(2);
  expect(f.rows[0]!.source.lifecycleVersion).toBe(2);
  expect(f.rows[1]!.source.lifecycleVersion).toBe(0);
  expect(f.rows[0]!.recordedStatus).toBe('historical');
  expect(new Set(f.rows.map((row) => row.medicationId)).size).toBe(1);
  expect(f.errors).toEqual([]);
});
