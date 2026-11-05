import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const email = 'fixture@example.test';
const notice = 'If an account matches, instructions will be sent.';

async function mockAuth(
  page: import('@playwright/test').Page,
  options: {
    loggedIn?: boolean;
    bootstrap?: (count: number) => boolean;
    response?: (
      path: string,
      body: Record<string, unknown>,
    ) => { status?: number; json?: unknown };
  } = {},
) {
  let loggedIn = options.loggedIn ?? false;
  let bootCount = 0;
  await page.route('**/api/auth/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.split('/').pop() ?? '';
    const body = route.request().postDataJSON?.() as
      Record<string, unknown> | undefined;
    if (path === 'bootstrap') {
      bootCount += 1;
      return route.fulfill({
        json: {
          enabled: options.bootstrap?.(bootCount) ?? true,
          csrf: 'fixture-csrf',
        },
      });
    }
    if (path === 'account')
      return loggedIn
        ? route.fulfill({ json: { email } })
        : route.fulfill({ status: 401, json: { error: 'unauthenticated' } });
    if (path === 'login' && !options.response) loggedIn = true;
    if (path === 'logout') loggedIn = false;
    const result = options.response?.(path, body ?? {});
    return route.fulfill({
      status: result?.status ?? 200,
      json:
        result?.json ??
        (path === 'google'
          ? { url: 'https://evil.example/auth/v1/authorize' }
          : { message: notice }),
    });
  });
}

async function enterEmail(page: import('@playwright/test').Page) {
  await page.getByLabel('Email address').fill(email);
}

test('anonymous login, account view and logout use same-origin mocked requests', async ({
  page,
}) => {
  await mockAuth(page);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Sign in to your account' }),
  ).toBeVisible();
  await enterEmail(page);
  await page.getByLabel('Password').fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await page.locator('a[href="#account"]').click();
  await expect(
    page.getByRole('heading', { name: 'Your account' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to your account' }),
  ).toBeVisible();
});

test('registration presents generic verification notice and supports resend', async ({
  page,
}) => {
  await mockAuth(page);
  await page.goto('/#auth-register');
  await enterEmail(page);
  await page
    .getByRole('textbox', { name: 'New password', exact: true })
    .fill('fixture-password-123');
  await page.getByLabel('Confirm new password').fill('fixture-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(
    page.getByRole('heading', { name: 'Check your inbox' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText(notice);
  await enterEmail(page);
  await page.getByRole('button', { name: 'Resend verification email' }).click();
  await expect(page.getByRole('status')).toContainText(notice);
});

test('recovery stays generic and provider initiation rejects unsafe redirect URLs', async ({
  page,
}) => {
  await mockAuth(page);
  await page.goto('/#auth-recover');
  await enterEmail(page);
  await page.getByRole('button', { name: 'Send reset instructions' }).click();
  await expect(page.getByRole('status')).toContainText(notice);
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  const origin = page.url();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'The request could not be completed. Please try again.',
  );
  expect(page.url()).toBe(origin);
});

test('reset validates matching passwords and reports successful update', async ({
  page,
}) => {
  await mockAuth(page);
  await page.goto('/#auth-reset');
  await expect(
    page.getByRole('heading', { name: 'Choose a new password' }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'New password', exact: true })
    .fill('fixture-password-123');
  await page.getByLabel('Confirm new password').fill('different-password');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'The passwords do not match.',
  );
  await page.getByLabel('Confirm new password').fill('fixture-password-123');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to your account' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Password updated. Sign in again',
  );
});

test('rate limits are announced and unavailable auth can be retried', async ({
  page,
}) => {
  await mockAuth(page, {
    response: (path) => (path === 'login' ? { status: 429 } : {}),
  });
  await page.goto('/');
  await enterEmail(page);
  await page.getByLabel('Password').fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Too many attempts. Please wait before trying again.',
  );
  await page.unrouteAll();
  let authEnabled = false;
  await mockAuth(page, { bootstrap: () => authEnabled });
  await page.goto('/');
  await expect(
    page.getByText(
      'Sign-in is unavailable until the development authentication service is configured.',
    ),
  ).toBeVisible();
  authEnabled = true;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to your account' }),
  ).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`auth page labels, narrow layout and accessibility in ${theme} theme`, async ({
    page,
  }) => {
    await mockAuth(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    if (theme === 'dark')
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
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
