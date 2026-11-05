import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const navigationItems = [
  'Overview',
  'Documents',
  'Trends',
  'Medications',
  'Family Access',
];

test('light default, theme persistence, and no stored patient data', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Overview');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toEqual(['fmv.theme']);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('all destinations reachable, with browser history and no clinical fixtures', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', {
    name: isMobile ? 'Mobile navigation' : 'Main navigation',
    exact: true,
  });
  for (const name of navigationItems) {
    const link = nav.getByRole('link', { name, exact: true });
    await link.click();
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
    if (name !== 'Overview')
      await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(page).toHaveTitle(`${name} | Family Medical Vault`);
  }
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Medications',
  );
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Family Access',
  );
  await expect(
    page.getByRole('searchbox', { name: 'Search documents' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: 'Search documents' }),
  ).toBeDisabled();
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
});

test('patient and upload entries explain unavailable access with keyboard-safe dialogs', async ({
  page,
}) => {
  await page.goto('/');
  const trigger = page.getByRole('button', {
    name: 'Select patient: No patient selected',
    exact: true,
  });
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText(
    'No patient profiles are available',
  );
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="dialog"]')),
    ),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'Select a patient first',
  );
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Upload', exact: true }),
  ).toBeFocused();
});

test('skip link focuses main and desktop navigation expands without hover', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  if (!isMobile) {
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: 'Skip to main content' }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
    await page.getByRole('button', { name: 'Expand navigation' }).click();
    await expect(
      page.getByRole('button', { name: 'Collapse navigation' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Collapse navigation' }).click();
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} theme passes automated WCAG checks on every destination and dialog`, async ({
    page,
    isMobile,
  }) => {
    await page.goto('/');
    if (theme === 'dark')
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    const nav = page.getByRole('navigation', {
      name: isMobile ? 'Mobile navigation' : 'Main navigation',
      exact: true,
    });
    for (const name of navigationItems) {
      await nav.getByRole('link', { name, exact: true }).click();
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    }
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    const dialogResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(dialogResults.violations).toEqual([]);
  });
}

test('narrow layouts, 200% equivalent zoom, and touch targets remain usable', async ({
  page,
}) => {
  for (const width of [320, 390, 720, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBe(false);
    await expect(
      page.getByRole('button', { name: 'Upload', exact: true }),
    ).toBeVisible();
    if (width < 768) {
      for (const name of navigationItems) {
        const box = await page
          .getByRole('navigation', { name: 'Mobile navigation' })
          .getByRole('link', { name, exact: true })
          .boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
    }
  }
});

test('reduced motion and blocked storage keep navigation and theme usable', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'getItem', {
      value: () => {
        throw new Error('Storage unavailable');
      },
    });
    Object.defineProperty(Storage.prototype, 'setItem', {
      value: () => {
        throw new Error('Storage unavailable');
      },
    });
  });
  await page.goto('/#documents');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Documents');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
