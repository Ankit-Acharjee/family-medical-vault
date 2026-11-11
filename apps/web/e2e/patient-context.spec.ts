import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const alice = {
  id: 'patient-a',
  displayName: 'Fixture Alice',
  relationship: 'self',
  capabilities: [{ action: 'view', scope: { kind: 'patient' } }],
};
const bob = {
  id: 'patient-b',
  displayName: 'Fixture Bob',
  relationship: 'caregiver',
  capabilities: [{ action: 'view', scope: { kind: 'patient' } }],
};
async function mount(page: Page) {
  await page.route('**/api/auth/bootstrap', (route) =>
    route.fulfill({ json: { enabled: false, csrf: null } }),
  );
  await page.goto('/');
  await page.evaluate(async () => {
    const fixturePath = '/src/features/patients/test-fixture.tsx';
    const fixture = (await import(/* @vite-ignore */ fixturePath)) as {
      mount: () => void;
    };
    fixture.mount();
  });
}
test('explicit selection, refresh revocation and no patient browser storage', async ({
  page,
}) => {
  let patients = [alice, bob];
  await page.route('**/api/patients', (route) =>
    route.fulfill({ json: { patients } }),
  );
  await mount(page);
  await expect(page.getByText('Selected: none')).toBeVisible();
  await page.getByRole('button', { name: /Fixture Alice/ }).click();
  await expect(page.getByText('Selected: Fixture Alice')).toBeVisible();
  patients = [bob];
  await page.getByRole('button', { name: 'Refresh profiles' }).click();
  await expect(page.getByText('Selected: none')).toBeVisible();
  await expect(page.getByRole('button', { name: /Fixture Alice/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: /Fixture Bob/ })).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toContain('Fixture Alice');
  expect(storage).not.toContain('patient-a');
  expect(storage).not.toContain('Fixture Bob');
  expect(storage).not.toContain('patient-b');
});
test('empty, denial and malformed responses have truthful retry states', async ({
  page,
}) => {
  let step = 0;
  await page.route('**/api/patients', (route) => {
    step += 1;
    if (step === 1) return route.fulfill({ status: 403 });
    if (step === 2)
      return route.fulfill({
        json: { patients: [{ ...alice, capabilities: 'invalid' }] },
      });
    return route.fulfill({ json: { patients: [] } });
  });
  await mount(page);
  await expect(page.getByRole('alert')).toContainText(
    'unavailable for this session',
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByText('No patient profiles are available.'),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Your account' }),
  ).toHaveAttribute('href', '#account');
});
test('a delayed previous session list cannot overwrite the new session', async ({
  page,
}) => {
  let count = 0;
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const firstStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/patients', async (route) => {
    count += 1;
    if (count === 1) {
      started?.();
      await gate;
      await route.fulfill({ json: { patients: [alice] } }).catch(() => {});
    } else await route.fulfill({ json: { patients: [bob] } });
  });
  await mount(page);
  await firstStarted;
  await page.getByRole('button', { name: 'Change session' }).click();
  await expect(page.getByRole('button', { name: /Fixture Bob/ })).toBeVisible();
  release?.();
  await expect(page.getByRole('button', { name: /Fixture Alice/ })).toHaveCount(
    0,
  );
  await expect(page.getByText('Selected: none')).toBeVisible();
});
test('a failed refresh clears the selected context and can be retried', async ({
  page,
}) => {
  let fail = false;
  await page.route('**/api/patients', (route) =>
    fail
      ? route.fulfill({ status: 503 })
      : route.fulfill({ json: { patients: [alice] } }),
  );
  await mount(page);
  await page.getByRole('button', { name: /Fixture Alice/ }).click();
  fail = true;
  await page.getByRole('button', { name: 'Refresh profiles' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Selected: none')).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('button', { name: /Fixture Alice/ }),
  ).toBeVisible();
  await expect(page.getByText('Selected: none')).toBeVisible();
});
for (const theme of ['light', 'dark'])
  test(`picker is accessible at 320px in ${theme}`, async ({ page }) => {
    await page.route('**/api/patients', (route) =>
      route.fulfill({ json: { patients: [alice, bob] } }),
    );
    await page.setViewportSize({ width: 320, height: 800 });
    await mount(page);
    await page.locator('html').evaluate((element, value) => {
      element.dataset['theme'] = value;
    }, theme);
    await expect(
      page.getByRole('button', { name: /Fixture Alice/ }),
    ).toBeVisible();
    await page.getByRole('button', { name: /Fixture Alice/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Selected: Fixture Alice')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(result.violations).toEqual([]);
  });
