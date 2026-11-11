import { expect, test, type Page } from '@playwright/test';
const token = 'x'.repeat(43);
const patient = {
  id: 'patient',
  displayName: 'Fixture',
  relationship: 'self',
  capabilities: [{ action: 'manage', scope: { kind: 'patient' } }],
};
async function setup(page: Page) {
  await page.route('**/api/auth/bootstrap', (route) =>
    route.fulfill({ json: { enabled: true, csrf: 'c'.repeat(43) } }),
  );
  await page.route('**/api/auth/account', (route) =>
    route.fulfill({ status: 401 }),
  );
  await page.route('**/api/patients', (route) =>
    route.fulfill({ json: { patients: [patient] } }),
  );
}
async function mount(page: Page, hash = '') {
  await page.goto(`/${hash}`);
  await page.evaluate(async () => {
    const path = '/src/features/access/test-fixture.tsx';
    const fixture = (await import(/* @vite-ignore */ path)) as {
      mount: () => void;
    };
    fixture.mount();
  });
}
test('opening an invitation clears the URL and never claims automatically', async ({
  page,
}) => {
  await setup(page);
  let claims = 0;
  await page.route('**/api/access/claim', (route) => {
    claims++;
    return route.fulfill({ json: { id: 'invitation', state: 'claimed' } });
  });
  await page.route('**/api/access/inspect', (route) =>
    route.fulfill({
      json: {
        kind: 'invitation',
        actions: ['view'],
        scope: { kind: 'patient' },
        expiresAt: '2026-12-01T00:00:00Z',
        requesterName: 'Fixture Sender',
        requesterPersonId: '00000000-0000-4000-8000-000000000001',
      },
    }),
  );
  await mount(page, `#family-access?invite=${token}`);
  await expect(page.getByLabel('Invitation code')).toHaveValue(token);
  expect(new URL(page.url()).hash).toBe('#family-access');
  expect(claims).toBe(0);
  await expect(
    page.getByRole('button', { name: 'Claim invitation' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Review invitation' }).click();
  await expect(
    page.getByText(/Fixture Sender; Person ID: .*; rights: view/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Claim invitation' }).click();
  await expect(page.getByRole('status')).toContainText(
    'requires manager approval',
  );
  expect(claims).toBe(1);
});
test('manager sees scope and explicitly approves a claimed invitation', async ({
  page,
}) => {
  await setup(page);
  let approvals = 0;
  await page.route('**/api/patients/patient/access', (route) =>
    route.fulfill({
      json: {
        grants: [],
        invitations: [
          {
            id: 'i',
            actions: ['view'],
            scope: { kind: 'patient' },
            expiresAt: '2026-12-01T00:00:00Z',
            state: 'claimed',
            recipientName: 'Fixture Caregiver',
            recipientPersonId: '00000000-0000-4000-8000-000000000002',
          },
        ],
      },
    }),
  );
  await page.route(
    '**/api/patients/patient/access/invitations/i/approve',
    (route) => {
      approvals++;
      return route.fulfill({ json: {} });
    },
  );
  await mount(page);
  await page.getByRole('button', { name: /Fixture/ }).click();
  await expect(
    page.getByText(
      /Fixture Caregiver; Person ID: .*; view; Whole patient profile/,
    ),
  ).toBeVisible();
  expect(approvals).toBe(0);
  await page.getByRole('button', { name: 'Approve invitation' }).click();
  await expect(page.getByText('Invitation approved.')).toBeVisible();
  expect(approvals).toBe(1);
});
test('proposal requires rights and produces an explicit scoped link', async ({
  page,
}) => {
  await setup(page);
  let calls = 0;
  await page.route('**/api/access/requests', (route) => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({
      actions: ['view'],
      scope: { kind: 'patient' },
      expiresInHours: 24,
    });
    return route.fulfill({
      json: { id: 'r', token, expiresAt: '2026-12-01T00:00:00Z' },
    });
  });
  await mount(page);
  await page.getByRole('button', { name: 'Create caregiver request' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Choose at least one right',
  );
  expect(calls).toBe(0);
  await page.getByRole('checkbox', { name: 'view' }).check();
  await page.getByRole('button', { name: 'Create caregiver request' }).click();
  await expect(page.getByLabel('Secure request link')).toHaveValue(
    new RegExp(`#family-access\\?request=${token}$`),
  );
  expect(calls).toBe(1);
});
test('a request requires inspection and a known Person ID before approval', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/patients/patient/access', (route) =>
    route.fulfill({ json: { grants: [], invitations: [] } }),
  );
  let requesterPersonId: string | null = null;
  let approvals = 0;
  await page.route('**/api/access/inspect', (route) =>
    route.fulfill({
      json: {
        kind: 'request',
        actions: ['view'],
        scope: { kind: 'patient' },
        expiresAt: '2026-12-01T00:00:00Z',
        requesterName: 'Fixture Requester',
        requesterPersonId,
      },
    }),
  );
  await page.route(
    '**/api/patients/patient/access/requests/approve',
    (route) => {
      approvals++;
      return route.fulfill({ json: {} });
    },
  );
  await mount(page);
  await page.getByRole('button', { name: /Fixture/ }).click();
  await page.getByLabel('Caregiver request code').fill(token);
  await expect(
    page.getByRole('button', { name: 'Approve request' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Review request' }).click();
  await expect(
    page.getByText(/Fixture Requester; Person ID: unavailable/),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Approve request' }),
  ).toBeDisabled();
  requesterPersonId = '00000000-0000-4000-8000-000000000003';
  await page.getByRole('button', { name: 'Review request' }).click();
  await expect(
    page.getByText(/Fixture Requester; Person ID: 00000000/),
  ).toBeVisible();
  expect(approvals).toBe(0);
  await page.getByRole('button', { name: 'Approve request' }).click();
  await expect(page.getByText('Request approved.')).toBeVisible();
  expect(approvals).toBe(1);
});
