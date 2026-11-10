import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  test(`resource states communicate loading, denial, failure and retry in ${theme} theme`, async ({
    page,
  }) => {
    await page.goto('/e2e/fixtures/states.html');
    await page
      .locator('html')
      .evaluate((element, value) => (element.dataset['theme'] = value), theme);
    await expect(page.locator('[data-state="loading"]')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await expect(page.locator('[data-state="pending"]')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await expect(page.getByRole('alert')).toHaveCount(2);
    await page
      .locator('[data-state="error"]')
      .getByRole('button', { name: 'Try again' })
      .click();
    await expect(
      page.getByText('Retry requested', { exact: true }),
    ).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}

test('overview visual review in both themes', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile')
    await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/auth/bootstrap', (route) =>
    route.fulfill({ json: { enabled: true, csrf: 'synthetic-csrf' } }),
  );
  await page.route('**/api/auth/account', (route) =>
    route.fulfill({ json: { email: 'fixture@example.test' } }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Overview');
  await page.screenshot({
    path: testInfo.outputPath('overview-light.png'),
    fullPage: testInfo.project.name !== 'mobile',
    scale: 'css',
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({
    path: testInfo.outputPath('overview-dark.png'),
    fullPage: testInfo.project.name !== 'mobile',
    scale: 'css',
    animations: 'disabled',
  });
});
