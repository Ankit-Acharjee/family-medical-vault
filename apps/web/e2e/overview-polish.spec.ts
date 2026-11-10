import { expect, test } from '@playwright/test';

// Overview presentation uses only a synthetic authenticated account.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/bootstrap', (route) =>
    route.fulfill({ json: { enabled: true, csrf: 'synthetic-csrf' } }),
  );
  await page.route('**/api/auth/account', (route) =>
    route.fulfill({ json: { email: 'fixture@example.test' } }),
  );
});

const widths = [320, 375, 390, 430, 1280, 1440];
const navigationItems = [
  'Overview',
  'Documents',
  'Trends',
  'Medications',
  'Family Access',
];

async function expectCenterHittable(
  locator: import('@playwright/test').Locator,
) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const hittable = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return target !== null && (target === element || element.contains(target));
  });
  expect(hittable).toBe(true);
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} overview stays polished and usable across viewport sizes`, async ({
    page,
  }, testInfo) => {
    const apiPaths: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) apiPaths.push(url.pathname);
    });
    if (theme === 'light') await page.emulateMedia({ reducedMotion: 'reduce' });

    for (const width of widths) {
      const mobile = width < 768;
      await page.setViewportSize({
        width,
        height: mobile ? 844 : 1000,
      });
      await page.goto('/');
      if (theme === 'dark' && width === widths[0]) {
        await page
          .getByRole('button', { name: 'Switch to dark theme' })
          .click();
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Overview',
      );
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.screenshot({
        path: testInfo.outputPath(`overview-${width}-${theme}.png`),
        animations: 'disabled',
      });

      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        `horizontal overflow at ${width}px in ${theme} theme`,
      ).toBe(false);

      const headerTargets = [
        page.getByRole('button', {
          name: 'Select patient: No patient selected',
        }),
        page.getByRole('link', { name: 'Account' }),
        page.getByRole('button', {
          name:
            theme === 'light'
              ? 'Switch to dark theme'
              : 'Switch to light theme',
        }),
        page.getByRole('button', { name: 'Upload', exact: true }),
      ];
      for (const target of headerTargets) {
        const box = await target.boundingBox();
        expect(box, `header target missing at ${width}px`).not.toBeNull();
        expect(
          box!.width,
          `header target too narrow at ${width}px`,
        ).toBeGreaterThanOrEqual(44);
        expect(
          box!.height,
          `header target too short at ${width}px`,
        ).toBeGreaterThanOrEqual(44);
        await expectCenterHittable(target);
      }

      const nav = page.getByRole('navigation', {
        name: mobile ? 'Mobile navigation' : 'Main navigation',
        exact: true,
      });
      for (const name of navigationItems) {
        const link = nav.getByRole('link', { name, exact: true });
        const box = await link.boundingBox();
        expect(box, `navigation target missing at ${width}px`).not.toBeNull();
        expect(
          box!.width,
          `${name} target too narrow at ${width}px`,
        ).toBeGreaterThanOrEqual(44);
        expect(
          box!.height,
          `${name} target too short at ${width}px`,
        ).toBeGreaterThanOrEqual(44);
        await expectCenterHittable(link);
      }

      const headline = page.getByRole('heading', {
        level: 2,
        name: 'Choose a patient to get started.',
      });
      const paragraph = page.locator('.welcome-copy p');
      const cta = page.getByRole('button', {
        name: 'Select patient',
        exact: true,
      });
      const art = page.locator('.overview-art');
      const artBox = await art.boundingBox();
      expect(artBox).not.toBeNull();
      for (const textBlock of [headline, paragraph, cta]) {
        const textBox = await textBlock.boundingBox();
        expect(textBox).not.toBeNull();
        const intersects =
          artBox!.x < textBox!.x + textBox!.width &&
          artBox!.x + artBox!.width > textBox!.x &&
          artBox!.y < textBox!.y + textBox!.height &&
          artBox!.y + artBox!.height > textBox!.y;
        expect(intersects, `hero art overlaps copy at ${width}px`).toBe(false);
      }
      await expect(
        page.getByRole('textbox', { name: 'Search documents' }),
      ).toBeDisabled();

      if (mobile) {
        await page.evaluate(() =>
          window.scrollTo(0, document.documentElement.scrollHeight),
        );
        const footer = await page.locator('.page-footer').boundingBox();
        const viewDocuments = await page
          .getByRole('link', { name: 'View documents' })
          .boundingBox();
        const mobileNav = await page
          .getByRole('navigation', { name: 'Mobile navigation' })
          .boundingBox();
        expect(footer).not.toBeNull();
        expect(viewDocuments).not.toBeNull();
        expect(mobileNav).not.toBeNull();
        expect(footer!.y).toBeGreaterThanOrEqual(0);
        expect(footer!.y + footer!.height).toBeLessThanOrEqual(mobileNav!.y);
        expect(viewDocuments!.y).toBeGreaterThanOrEqual(0);
        expect(viewDocuments!.y + viewDocuments!.height).toBeLessThanOrEqual(
          mobileNav!.y,
        );
        expect(mobileNav!.y + mobileNav!.height).toBeLessThanOrEqual(844);
      }
    }

    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto('/');
    const patientTrigger = page.getByRole('button', {
      name: 'Select patient',
      exact: true,
    });
    await patientTrigger.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(patientTrigger).toBeFocused();

    await page.getByRole('link', { name: 'View documents' }).click();
    await expect(page).toHaveURL(/#documents$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Documents',
    );
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Overview',
    );
    expect([...new Set(apiPaths)].sort()).toEqual([
      '/api/auth/account',
      '/api/auth/bootstrap',
    ]);
  });
}
