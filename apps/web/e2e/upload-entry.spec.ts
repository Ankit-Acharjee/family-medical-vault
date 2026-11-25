import { Buffer } from 'node:buffer';
import { expect, test, type Page } from '@playwright/test';
import type { CreateManagedProfile } from '@fmv/contracts';

const allowed = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'SYNTHETIC Upload Patient',
  relationship: 'self',
  capabilities: [{ action: 'upload', scope: { kind: 'patient' } }],
};
const denied = {
  ...allowed,
  id: '22222222-2222-4222-8222-222222222222',
  displayName: 'SYNTHETIC View Only Patient',
  capabilities: [{ action: 'view', scope: { kind: 'patient' } }],
};
const globalUpload = (page: Page) =>
  page.getByRole('button', { name: 'Upload', exact: true });
const dialog = (page: Page) => page.getByRole('dialog');
const chooseFiles = (page: Page) => dialog(page).getByLabel(/Choose files/);

async function setup(
  page: Page,
  initialPatients = [allowed, denied],
  initialStatus = 200,
) {
  let patients = initialPatients,
    status = initialStatus;
  let patientsGate: Promise<void> | undefined,
    releasePatients = () => {},
    uncertainManaged = false,
    managedCreated = false;
  const errors: string[] = [],
    storageReads: string[] = [];
  const uploads: { method: string; path: string }[] = [];
  const managedWrites: CreateManagedProfile[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const json = (value: unknown, code = 200) =>
      route.fulfill({ status: code, json: value });
    if (path === '/api/auth/bootstrap')
      return json({ enabled: true, csrf: 'c'.repeat(43) });
    if (path === '/api/auth/account')
      return json({
        email: 'fixture@example.test',
        contextId: 'upload-entry-context',
      });
    if (path === '/api/patients') {
      if (patientsGate) await patientsGate;
      return json({ patients }, status);
    }
    if (path === '/api/patients/managed') {
      expect(request.method()).toBe('POST');
      expect(request.headers()['x-csrf-token']).toBe('c'.repeat(43));
      const body = request.postDataJSON() as CreateManagedProfile;
      managedWrites.push(body);
      const wasCreated = managedCreated;
      managedCreated = true;
      const managedId = '33333333-3333-4333-8333-333333333333';
      if (!patients.some((patient) => patient.id === managedId))
        patients = [
          ...patients,
          {
            ...allowed,
            id: managedId,
            displayName: body.displayName,
            relationship: 'caregiver',
          },
        ];
      if (uncertainManaged && managedWrites.length === 1) return json({}, 503);
      return json({
        id: managedId,
        displayName: body.displayName,
        relationship: 'caregiver',
        created: !wasCreated,
      });
    }
    if (/^\/api\/patients\/[^/]+\/documents$/.test(path)) {
      storageReads.push(path);
      return json({ documents: [], storageReady: true });
    }
    if (/^\/api\/patients\/[^/]+\/categories$/.test(path)) {
      storageReads.push(path);
      return json({ categories: [] });
    }
    if (/^\/api\/patients\/[^/]+\/uploads(?:\/.*)?$/.test(path)) {
      uploads.push({ method: request.method(), path });
      // Authoritative permission denial only: no content or finalize can occur.
      return json({}, 403);
    }
    return json({}, 404);
  });
  await page.goto('/#overview');
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  return {
    errors,
    uploads,
    storageReads,
    managedWrites,
    uncertainManagedCreation() {
      uncertainManaged = true;
    },
    holdPatients() {
      patientsGate = new Promise<void>((resolve) => {
        releasePatients = resolve;
      });
    },
    releasePatients() {
      patientsGate = undefined;
      releasePatients();
    },
    recover() {
      patients = [allowed];
      status = 200;
    },
  };
}

async function selectInsideUpload(
  page: Page,
  patient = allowed,
  method: 'keyboard' | 'pointer' = 'pointer',
) {
  const choice = dialog(page).getByRole('button', {
    name: `${patient.displayName} (Your profile)`,
    exact: true,
  });
  if (method === 'keyboard') {
    await choice.focus();
    await page.keyboard.press('Enter');
  } else await choice.click();
}

test('global Upload never associates a patient automatically and explicit choice continues in the same dialog', async ({
  page,
}, testInfo) => {
  const api = await setup(page);
  if (testInfo.project.name === 'mobile')
    await page
      .getByRole('button', { name: 'Switch to dark theme', exact: true })
      .click();
  await globalUpload(page).click();
  await expect(
    dialog(page).getByRole('heading', {
      name: 'Select a patient first',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole('button', {
      name: `${allowed.displayName} (Your profile)`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole('button', {
      name: `${denied.displayName} (Your profile)`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: 'Select patient: No patient selected',
      includeHidden: true,
      exact: true,
    }),
  ).toBeAttached();
  expect(api.storageReads).toEqual([]);
  expect(api.uploads).toEqual([]);
  await page.screenshot({
    path: `../../.local/screenshots/upload-entry-patient-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const originalDialog = await dialog(page).elementHandle();
  await selectInsideUpload(page, allowed, 'keyboard');
  await expect(
    dialog(page).getByRole('heading', {
      name: 'Upload documents',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole('heading', {
      name: 'Upload documents',
      exact: true,
    }),
  ).toBeFocused();
  await expect(
    dialog(page).getByRole('region', {
      name: `Upload documents for ${allowed.displayName}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(chooseFiles(page)).toBeEnabled();
  await page.screenshot({
    path: `../../.local/screenshots/upload-entry-files-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(await originalDialog!.evaluate((element) => element.isConnected)).toBe(
    true,
  );
  expect([...new Set(api.storageReads)].sort()).toEqual([
    `/api/patients/${allowed.id}/categories`,
    `/api/patients/${allowed.id}/documents`,
  ]);
  expect(api.uploads).toEqual([]);
  expect(api.errors).toEqual([]);
});

test('choosing a patient without Upload authority preserves the existing server denial without sending content', async ({
  page,
}) => {
  const api = await setup(page);
  await globalUpload(page).click();
  await selectInsideUpload(page, denied);
  await expect(
    dialog(page).getByRole('region', {
      name: `Upload documents for ${denied.displayName}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(chooseFiles(page)).toBeEnabled();
  await chooseFiles(page).setInputFiles({
    name: 'synthetic-denied.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 SYNTHETIC permission fixture'),
  });
  await dialog(page)
    .getByRole('button', { name: 'Upload selected files', exact: true })
    .click();
  await expect(
    dialog(page).getByText(
      'This action is unavailable for your current access.',
      { exact: false },
    ),
  ).toBeVisible();
  expect(api.uploads).toEqual([
    { method: 'POST', path: `/api/patients/${denied.id}/uploads` },
  ]);
  await expect(dialog(page)).toBeVisible();
  expect(api.errors).toEqual([]);
});

test('empty patient availability explains the limitation without exposing a file input', async ({
  page,
}) => {
  const api = await setup(page, []);
  await globalUpload(page).click();
  await expect(
    dialog(page).getByText('No patient profiles are available.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  expect(api.storageReads).toEqual([]);
  expect(api.uploads).toEqual([]);
  await dialog(page)
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(globalUpload(page)).toBeFocused();
  expect(api.errors).toEqual([]);
});

test('patient loading failure retries inside the upload entry and still requires explicit patient choice', async ({
  page,
}) => {
  const api = await setup(page, [], 503);
  await globalUpload(page).click();
  await expect(
    dialog(page).getByText('Patient profiles could not be loaded.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  api.recover();
  await dialog(page)
    .getByRole('button', { name: 'Try again', exact: true })
    .click();
  await expect(
    dialog(page).getByRole('button', {
      name: `${allowed.displayName} (Your profile)`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  expect(api.storageReads).toEqual([]);
  await selectInsideUpload(page);
  await expect(chooseFiles(page)).toBeEnabled();
  expect(api.uploads).toEqual([]);
  expect(api.errors).toEqual([]);
});

test('Escape during patient choice and closing the continued form restore the global Upload trigger', async ({
  page,
}) => {
  const api = await setup(page);
  await globalUpload(page).click();
  await expect(
    dialog(page).getByRole('button', {
      name: `${allowed.displayName} (Your profile)`,
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(globalUpload(page)).toBeFocused();
  await globalUpload(page).click();
  await selectInsideUpload(page);
  await expect(chooseFiles(page)).toBeEnabled();
  await dialog(page)
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(globalUpload(page)).toBeFocused();
  expect(api.uploads).toEqual([]);
  expect(api.errors).toEqual([]);
});

test('managed profile draft survives held focus revalidation in upload entry and renews confirmation', async ({
  page,
}) => {
  const api = await setup(page);
  await globalUpload(page).click();
  await dialog(page)
    .getByRole('button', { name: 'Create managed profile', exact: true })
    .click();
  await dialog(page)
    .getByLabel('Patient display name')
    .fill('SYNTHETIC managed upload draft');
  await dialog(page).getByRole('checkbox').check();
  const originalDialog = await dialog(page).elementHandle();
  api.holdPatients();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    dialog(page).getByText('Checking profile creation access…', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  expect(await originalDialog!.evaluate((element) => element.isConnected)).toBe(
    true,
  );
  api.releasePatients();
  await expect(dialog(page).getByLabel('Patient display name')).toHaveValue(
    'SYNTHETIC managed upload draft',
  );
  await expect(dialog(page).getByRole('checkbox')).not.toBeChecked();
  await expect(
    dialog(page).getByRole('button', {
      name: 'Create managed profile',
      exact: true,
    }),
  ).toBeDisabled();
  await dialog(page).getByRole('checkbox').check();
  await expect(
    dialog(page).getByRole('button', {
      name: 'Create managed profile',
      exact: true,
    }),
  ).toBeEnabled();
  expect(api.managedWrites).toEqual([]);
  expect(api.storageReads).toEqual([]);
  expect(api.uploads).toEqual([]);
  expect(api.errors).toEqual([]);
});

test('uncertain managed creation keeps its request identity through upload-entry focus revalidation', async ({
  page,
}) => {
  const api = await setup(page);
  await globalUpload(page).click();
  await dialog(page)
    .getByRole('button', { name: 'Create managed profile', exact: true })
    .click();
  await dialog(page)
    .getByLabel('Patient display name')
    .fill('SYNTHETIC uncertain upload profile');
  await dialog(page).getByRole('checkbox').check();
  api.uncertainManagedCreation();
  await dialog(page)
    .getByRole('button', { name: 'Create managed profile', exact: true })
    .click();
  await expect(dialog(page).getByRole('alert')).toContainText(
    'may have completed',
  );
  await expect(dialog(page).getByLabel('Patient display name')).toBeDisabled();
  expect(api.managedWrites).toHaveLength(1);
  const firstBody = api.managedWrites[0]!;
  expect(firstBody).toMatchObject({
    displayName: 'SYNTHETIC uncertain upload profile',
    confirmed: true,
  });
  expect(firstBody.requestId).toMatch(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  );
  api.holdPatients();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    dialog(page).getByText('Checking profile creation access…', {
      exact: true,
    }),
  ).toBeVisible();
  api.releasePatients();
  await expect(dialog(page).getByLabel('Patient display name')).toHaveValue(
    'SYNTHETIC uncertain upload profile',
  );
  await expect(dialog(page).getByLabel('Patient display name')).toBeDisabled();
  await expect(dialog(page).getByRole('checkbox')).not.toBeChecked();
  await expect(
    dialog(page).getByRole('button', {
      name: 'Retry same creation',
      exact: true,
    }),
  ).toBeDisabled();
  await dialog(page).getByRole('checkbox').check();
  await dialog(page)
    .getByRole('button', { name: 'Retry same creation', exact: true })
    .click();
  await expect(
    dialog(page)
      .getByRole('status')
      .filter({ hasText: 'Managed profile created.' }),
  ).toContainText('Select it from the patient list');
  expect(api.managedWrites).toHaveLength(2);
  expect(api.managedWrites[1]).toEqual(firstBody);
  await expect(
    dialog(page).getByRole('button', {
      name: 'SYNTHETIC uncertain upload profile (Caregiver access)',
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  expect(api.storageReads).toEqual([]);
  expect(api.uploads).toEqual([]);
  expect(api.errors).toEqual([]);
});

test('opening Upload during selection revalidation preserves the later file queue on another refresh', async ({
  page,
}) => {
  const api = await setup(page);
  await page
    .getByRole('button', {
      name: 'Select patient: No patient selected',
      exact: true,
    })
    .click();
  await selectInsideUpload(page);
  await expect(dialog(page)).toHaveCount(0);
  api.holdPatients();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByRole('searchbox', { name: 'Search documents', exact: true }),
  ).toBeDisabled();
  await globalUpload(page).click();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  api.releasePatients();
  await expect(chooseFiles(page)).toBeEnabled();
  const input = await chooseFiles(page).elementHandle();
  await chooseFiles(page).setInputFiles({
    name: 'synthetic-context.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 SYNTHETIC context fixture'),
  });
  await expect(dialog(page).getByText(/synthetic-context.pdf/)).toBeVisible();
  api.holdPatients();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    dialog(page).getByRole('region', {
      name: `Upload documents for ${allowed.displayName}`,
      exact: true,
    }),
  ).toHaveAttribute('aria-busy', 'true');
  await expect(dialog(page).getByText(/synthetic-context.pdf/)).toBeVisible();
  api.releasePatients();
  await expect(chooseFiles(page)).toBeEnabled();
  expect(await input!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(dialog(page).getByText(/synthetic-context.pdf/)).toBeVisible();
  expect(api.uploads).toEqual([]);
  expect(api.errors).toEqual([]);
});
