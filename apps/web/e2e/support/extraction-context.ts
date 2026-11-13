import type { Page } from '@playwright/test';
// Existing memory-only extraction tests do not exercise shared persistence.
export async function mockExtractionContext(page: Page) {
  await page.route(
    '**/api/patients/*/documents/*/extraction/context',
    (route) =>
      route.fulfill({
        json: {
          context: {
            sourceSha256: 'a'.repeat(64),
            lifecycleVersion: 0,
            revision: 0,
            canSave: false,
          },
        },
      }),
  );
}
