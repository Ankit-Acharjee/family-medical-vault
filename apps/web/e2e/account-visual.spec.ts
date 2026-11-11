import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const personId = '8b51a2b7-4e19-4f32-9f8c-7d5a6b4c3e21';
const email =
  'fixture.with.a.deliberately.long.account.address.for.layout@example.test';
const widths = [320, 390, 720, 1440];

async function mockAccount(page: import('@playwright/test').Page) {
  let existingPerson: { id: string; displayName: string } | null = null;
  await page.route('**/api/auth/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.split('/').pop() ?? '';
    if (path === 'bootstrap')
      return route.fulfill({ json: { enabled: true, csrf: 'fixture-csrf' } });
    if (path === 'account')
      return route.fulfill({ json: { email, contextId: 'fixture-context' } });
    if (path === 'person')
      return route.fulfill({ json: { person: existingPerson } });
    return route.fulfill({ json: {} });
  });
  return {
    setExistingPerson(person: { id: string; displayName: string } | null) {
      existingPerson = person;
    },
  };
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} account create and existing profile views fit and remain accessible`, async ({
    page,
  }, testInfo) => {
    const api = await mockAccount(page);
    if (theme === 'light') await page.emulateMedia({ reducedMotion: 'reduce' });

    for (const width of widths) {
      for (const state of ['create', 'existing'] as const) {
        api.setExistingPerson(
          state === 'existing'
            ? { id: personId, displayName: 'Fixture Personal Profile' }
            : null,
        );
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/#account');
        // Re-read the mocked account state even when the hash URL is unchanged.
        await page.reload();
        if (theme === 'dark' && width === widths[0] && state === 'create') {
          await page
            .getByRole('button', { name: 'Switch to dark theme' })
            .click();
        }
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('.account-screen')).toBeVisible();
        await expect(
          page.getByRole('heading', { name: 'Your account' }),
        ).toBeVisible();
        await expect(
          page.getByRole('heading', {
            name:
              state === 'create'
                ? 'Create your personal profile'
                : 'Your personal profile',
            exact: true,
          }),
        ).toBeVisible();
        await page.evaluate(() => document.fonts.ready.then(() => undefined));

        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          `horizontal overflow at ${width}px in ${theme} ${state} view`,
        ).toBe(false);

        const controls = [
          ...((await page
            .getByRole('button')
            .all()) as import('@playwright/test').Locator[]),
          ...((await page
            .getByRole('textbox')
            .all()) as import('@playwright/test').Locator[]),
          ...((await page
            .getByRole('link', { name: 'Back to vault' })
            .all()) as import('@playwright/test').Locator[]),
        ];
        for (const control of controls) {
          const box = await control.boundingBox();
          expect(box, `account control missing at ${width}px`).not.toBeNull();
          expect(
            box!.width,
            `account control too narrow at ${width}px`,
          ).toBeGreaterThanOrEqual(44);
          expect(
            box!.height,
            `account control too short at ${width}px`,
          ).toBeGreaterThanOrEqual(44);
        }

        if (state === 'create') {
          await expect(
            page.getByRole('textbox', { name: 'Your name' }),
          ).toBeVisible();
          await page
            .getByRole('textbox', { name: 'Your name' })
            .fill('Fixture Person');
          await expect(
            page.getByRole('button', { name: 'Create my profile' }),
          ).toBeVisible();
        } else {
          const accountEmail = page.locator('.auth-panel__intro');
          const profileId = page.locator('.person-panel dd');
          await expect(accountEmail).toHaveText(email);
          await expect(profileId).toHaveText(personId);
          if (width === 390) {
            for (const wrappingText of [accountEmail, profileId]) {
              const contained = await wrappingText.evaluate((element) => {
                const bounds = element.getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(element);
                return Array.from(range.getClientRects()).every(
                  (rect) =>
                    rect.left >= bounds.left - 1 &&
                    rect.right <= bounds.right + 1,
                );
              });
              expect(
                contained,
                'long account values must remain fully inside their panel',
              ).toBe(true);
            }
          }
        }

        if (width === 390) {
          const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze();
          expect(results.violations).toEqual([]);
        }
        if (width === 390 || width === 1440) {
          await page.screenshot({
            path: testInfo.outputPath(`account-${state}-${width}-${theme}.png`),
            animations: 'disabled',
          });
        }
      }
    }

    api.setExistingPerson(null);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/#account');
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Create your personal profile' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Back to vault' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Overview' }),
    ).toBeVisible();
    await expect(page.locator('.account-screen, .auth-screen')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Upload', exact: true }),
    ).toBeVisible();
  });
}
