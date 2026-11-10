import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const personId = '00000000-0000-4000-8000-000000000001';

async function mockPersonApi(
  page: import('@playwright/test').Page,
  options: { initialPerson?: { id: string; displayName: string } | null } = {},
) {
  let person = options.initialPerson ?? null;
  let createCount = 0;
  let failFirstCreate = false;
  let holdCreate = false;
  let releaseCreate: (() => void) | undefined;
  let createStarted: (() => void) | undefined;
  const createStartedPromise = new Promise<void>((resolve) => {
    createStarted = resolve;
  });

  await page.route('**/api/auth/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.split('/').pop() ?? '';
    if (path === 'bootstrap')
      return route.fulfill({ json: { enabled: true, csrf: 'fixture-csrf' } });
    if (path === 'account')
      return route.fulfill({ json: { email: 'fixture@example.test' } });
    if (path !== 'person') return route.fulfill({ status: 404 });

    if (route.request().method() === 'GET')
      return route.fulfill({ json: { person } });

    createCount += 1;
    const body = route.request().postDataJSON() as { displayName: string };
    if (holdCreate) {
      createStarted?.();
      await new Promise<void>((resolve) => (releaseCreate = resolve));
    }
    if (failFirstCreate && createCount === 1)
      return route.fulfill({ status: 503, json: { error: 'unavailable' } });
    person = { id: personId, displayName: body.displayName };
    return route.fulfill({ json: { person } });
  });

  return {
    failFirstCreate: () => {
      failFirstCreate = true;
    },
    holdNextCreate: () => {
      holdCreate = true;
      return {
        started: createStartedPromise,
        release: () => releaseCreate?.(),
      };
    },
    createCount: () => createCount,
  };
}

test('creates a personal profile with the keyboard and shows its stable ID', async ({
  page,
}) => {
  const api = await mockPersonApi(page);
  await page.goto('/#account');
  await expect(
    page.getByRole('heading', { name: 'Create your personal profile' }),
  ).toBeVisible();
  const name = page.getByRole('textbox', { name: 'Your name' });
  await name.fill('Fixture Person');
  await name.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Your personal profile' }),
  ).toBeVisible();
  await expect(page.getByText('Person ID')).toBeVisible();
  await expect(page.getByText(personId)).toBeVisible();
  expect(api.createCount()).toBe(1);
  await expect(
    page.getByRole('heading', { name: 'Your account' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});

test('creation failure can be retried without leaving the form', async ({
  page,
}) => {
  const api = await mockPersonApi(page);
  api.failFirstCreate();
  await page.goto('/#account');
  await page.getByRole('textbox', { name: 'Your name' }).fill('Fixture Person');
  await page.getByRole('button', { name: 'Create my profile' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Create your personal profile' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create my profile' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your personal profile' }),
  ).toBeVisible();
  expect(api.createCount()).toBe(2);
});

test('existing profile and Person ID remain stable after reload', async ({
  page,
}) => {
  await mockPersonApi(page, {
    initialPerson: { id: personId, displayName: 'Fixture Person' },
  });
  await page.goto('/#account');
  await expect(
    page.getByRole('heading', { name: 'Your personal profile' }),
  ).toBeVisible();
  await expect(page.getByText(personId)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Your personal profile' }),
  ).toBeVisible();
  await expect(page.getByText(personId)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create my profile' }),
  ).toHaveCount(0);
});

test('duplicate submits are blocked while profile creation is pending', async ({
  page,
}) => {
  const api = await mockPersonApi(page);
  const creationHeld = api.holdNextCreate();
  await page.goto('/#account');
  await page.getByRole('textbox', { name: 'Your name' }).fill('Fixture Person');
  const create = page.getByRole('button', {
    name: /create my profile|creating profile/i,
  });
  await create.click();
  await creationHeld.started;
  await expect(create).toBeDisabled();
  await expect(create).toHaveText(/creating/i);
  await page.keyboard.press('Enter');
  expect(api.createCount()).toBe(1);
  creationHeld.release();
  await expect(
    page.getByRole('heading', { name: 'Your personal profile' }),
  ).toBeVisible();
});

test('a delayed creation response from a signed-out account cannot replace the next account profile', async ({
  page,
}) => {
  let loggedIn = true;
  let currentEmail = 'account-a@example.test';
  let markCreateStarted: (() => void) | undefined;
  let releaseCreate: (() => void) | undefined;
  const createStarted = new Promise<void>((resolve) => {
    markCreateStarted = resolve;
  });
  const createGate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });

  await page.route('**/api/auth/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.split('/').pop() ?? '';
    if (path === 'bootstrap')
      return route.fulfill({ json: { enabled: true, csrf: 'fixture-csrf' } });
    if (path === 'account')
      return loggedIn
        ? route.fulfill({ json: { email: currentEmail } })
        : route.fulfill({ status: 401, json: { error: 'unauthenticated' } });
    if (path === 'logout') {
      loggedIn = false;
      return route.fulfill({ json: {} });
    }
    if (path === 'login') {
      currentEmail = (route.request().postDataJSON() as { email: string })
        .email;
      loggedIn = true;
      return route.fulfill({ json: {} });
    }
    if (path !== 'person') return route.fulfill({ status: 404 });
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          person:
            currentEmail === 'account-b@example.test'
              ? {
                  id: '00000000-0000-4000-8000-000000000002',
                  displayName: 'Account B Person',
                }
              : null,
        },
      });

    markCreateStarted?.();
    await createGate;
    return route.fulfill({
      json: {
        person: {
          id: '00000000-0000-4000-8000-000000000001',
          displayName: 'Account A Person',
        },
      },
    });
  });

  await page.goto('/#account');
  await page
    .getByRole('textbox', { name: 'Your name' })
    .fill('Account A Person');
  await page.getByRole('button', { name: 'Create my profile' }).click();
  await createStarted;

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to your account' }),
  ).toBeVisible();
  await page.getByLabel('Email address').fill('account-b@example.test');
  await page.getByLabel('Password').fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await page.locator('a[href="#account"]').click();
  await expect(
    page.getByRole('heading', { name: 'Your personal profile' }),
  ).toBeVisible();
  await expect(page.getByText('Account B Person')).toBeVisible();
  const accountBId = '00000000-0000-4000-8000-000000000002';
  await expect(page.getByText(accountBId)).toBeVisible();

  const delayedCreateResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith('/api/auth/person') &&
      response.request().method() === 'POST'
    );
  });
  releaseCreate?.();
  await delayedCreateResponse;
  await expect(page.getByText('Account B Person')).toBeVisible();
  await expect(page.getByText(accountBId)).toBeVisible();
  await expect(page.getByText('Account A Person')).toHaveCount(0);
  await expect(
    page.getByText('00000000-0000-4000-8000-000000000001'),
  ).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} person view is accessible and fits a mobile viewport`, async ({
    page,
  }) => {
    await mockPersonApi(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/#account');
    if (theme === 'dark')
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(
      page.getByRole('heading', { name: 'Create your personal profile' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Create my profile' }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
