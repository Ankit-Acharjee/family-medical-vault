import { expect, test, type Page, type Route } from '@playwright/test';

const noticeText =
  'An identical file is already available in this patient’s documents. All originals were kept.';
const notice = (page: Page) =>
  page.getByRole('status', { name: 'Potential duplicate upload' });
const patient = {
  id: 'a',
  displayName: 'Fixture Patient',
  relationship: 'self',
  capabilities: [{ action: 'upload', scope: { kind: 'patient' } }],
};
const other = { ...patient, id: 'b', displayName: 'Other Patient' };
type UploadHandler = (route: Route) => Promise<void>;
async function setup(page: Page, handler: UploadHandler) {
  let patients = [patient, other];
  await page.route('**/api/auth/bootstrap', (r) =>
    r.fulfill({ json: { enabled: true, csrf: 'c'.repeat(43) } }),
  );
  await page.route('**/api/auth/account', (r) =>
    r.fulfill({
      json: { email: 'fixture@example.test', contextId: 'duplicate-tests' },
    }),
  );
  await page.route('**/api/patients', (r) => r.fulfill({ json: { patients } }));
  await page.route('**/api/patients/*/documents', (r) =>
    r.fulfill({ json: { documents: [], storageReady: true } }),
  );
  await page.route('**/api/patients/*/categories', (r) =>
    r.fulfill({ json: { categories: [] } }),
  );
  await page.route('**/api/patients/*/uploads**', handler);
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Select patient: No patient selected' })
    .click();
  await page
    .getByRole('button', { name: /Fixture Patient \(Your profile\)/ })
    .click();
  await openUpload(page);
  return {
    revoke() {
      patients = [other];
    },
  };
}
async function openUpload(page: Page) {
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByLabel(/Choose files/)).toBeEnabled();
}
async function choose(page: Page, names = ['synthetic-original.pdf']) {
  await page.getByLabel(/Choose files/).setInputFiles(
    names.map((name) => ({
      name,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 synthetic nonmedical fixture'),
    })),
  );
}
async function submit(page: Page) {
  await page.getByRole('button', { name: 'Upload selected files' }).click();
}
function successful(
  duplicate: unknown,
  replay = false,
  requests: string[] = [],
): UploadHandler {
  return async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    requests.push(`${route.request().method()} ${pathname}`);
    const ready = replay || pathname.endsWith('/finalize');
    await route.fulfill({
      json: {
        uploadId: 'fixture-upload',
        documentId: 'fixture-document',
        state: ready ? 'ready' : 'pending',
        ...(ready && duplicate !== undefined
          ? { potentialDuplicate: duplicate }
          : {}),
      },
    });
  };
}
for (const mode of [
  'normal',
  'explicit false',
  'finalize duplicate',
  'ready replay duplicate',
] as const) {
  test(`${mode} preserves success dismissal and focus`, async ({ page }) => {
    const requests: string[] = [];
    await setup(
      page,
      successful(
        mode === 'normal'
          ? undefined
          : mode === 'explicit false'
            ? false
            : true,
        mode === 'ready replay duplicate',
        requests,
      ),
    );
    await choose(page);
    await submit(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByText('Documents stored successfully.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Upload', exact: true }),
    ).toBeFocused();
    if (mode === 'normal' || mode === 'explicit false')
      await expect(notice(page)).toHaveCount(0);
    else {
      await expect(notice(page)).toHaveText(noticeText);
      expect(await notice(page).innerText()).not.toMatch(
        /synthetic|fixture-document|fixture-upload|sha256/i,
      );
      expect(page.url()).not.toMatch(
        /duplicate|synthetic|fixture-document|fixture-upload/i,
      );
      const persisted = await page.evaluate(() =>
        JSON.stringify([
          Object.entries(localStorage),
          Object.entries(sessionStorage),
        ]),
      );
      expect(persisted).not.toMatch(
        /duplicate|synthetic|fixture-document|fixture-upload/i,
      );
      await openUpload(page);
      await expect(notice(page)).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('button', { name: 'Upload', exact: true }),
      ).toBeFocused();
    }
    expect(requests).toHaveLength(mode === 'ready replay duplicate' ? 1 : 3);
  });
}

test('duplicate partial batch keeps files and retries only failure with its original key', async ({
  page,
}) => {
  const attempts: { title: string; idempotencyKey: string }[] = [];
  await setup(page, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/uploads')) {
      const body = route.request().postDataJSON() as {
        title: string;
        idempotencyKey: string;
      };
      attempts.push(body);
      if (attempts.length === 1) {
        await route.fulfill({ status: 503 });
        return;
      }
      await route.fulfill({
        json: {
          uploadId: body.title,
          documentId: body.title,
          state: 'pending',
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        uploadId: pathname.split('/')[5],
        documentId: pathname.split('/')[5],
        state: pathname.endsWith('/finalize') ? 'ready' : 'pending',
        ...(pathname.endsWith('/stored.pdf/finalize')
          ? { potentialDuplicate: true }
          : {}),
      },
    });
  });
  await choose(page, ['retry.pdf', 'stored.pdf']);
  await submit(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(notice(page)).toHaveText(noticeText);
  await expect(
    page.getByRole('listitem').filter({ hasText: 'retry.pdf:' }),
  ).toContainText('Failed');
  await expect(
    page.getByRole('listitem').filter({ hasText: 'stored.pdf:' }),
  ).toContainText('Stored');
  const input = await page.getByLabel(/Choose files/).elementHandle();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel(/Choose files/)).toBeEnabled();
  expect(await input!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(
    page.getByRole('listitem').filter({ hasText: 'retry.pdf:' }),
  ).toBeVisible();
  await submit(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(notice(page)).toHaveCount(0);
  expect(attempts.map((a) => a.title)).toEqual([
    'retry.pdf',
    'stored.pdf',
    'retry.pdf',
  ]);
  expect(attempts[2]!.idempotencyKey).toBe(attempts[0]!.idempotencyKey);
});

for (const malformed of [null, 'true', { title: 'hidden candidate' }]) {
  test(`malformed duplicate flag ${JSON.stringify(malformed)} fails safely`, async ({
    page,
  }) => {
    await setup(page, successful(malformed));
    await choose(page);
    await submit(page);
    await expect(
      page.getByRole('listitem').filter({ hasText: 'synthetic-original.pdf:' }),
    ).toContainText('Failed');
    await expect(notice(page)).toHaveCount(0);
    await expect(
      page.getByText('hidden candidate', { exact: false }),
    ).toHaveCount(0);
  });
}

for (const invalidation of ['focus', 'patient switch', 'reload'] as const) {
  test(`successful duplicate notice clears on ${invalidation}`, async ({
    page,
  }) => {
    await setup(page, successful(true));
    await choose(page);
    await submit(page);
    await expect(notice(page)).toBeVisible();
    if (invalidation === 'focus')
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    else if (invalidation === 'reload') await page.reload();
    else {
      await page
        .getByRole('button', { name: 'Select patient: Fixture Patient' })
        .click();
      await page
        .getByRole('button', { name: /Other Patient \(Your profile\)/ })
        .click();
    }
    await expect(notice(page)).toHaveCount(0);
  });
}

test('late duplicate finalize after revoked access cannot show notice', async ({
  page,
}) => {
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fixture = await setup(page, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/finalize')) {
      started();
      await pending;
      await route.fulfill({
        json: {
          uploadId: 'fixture-upload',
          documentId: 'fixture-document',
          state: 'ready',
          potentialDuplicate: true,
        },
      });
    } else await successful(undefined)(route);
  });
  await choose(page);
  await submit(page);
  await reached;
  fixture.revoke();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByRole('heading', { name: 'Select a patient first' }),
  ).toBeVisible();
  release();
  await expect(notice(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(notice(page)).toHaveCount(0);
});

test('duplicate notice reflows and passes axe in both themes', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Explicit viewport coverage.');
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const { mkdir } = await import('node:fs/promises');
  const path = await import('node:path');
  const screenshotDirectory = path.resolve(
    process.cwd(),
    '../../.local/screenshots',
  );
  await mkdir(screenshotDirectory, { recursive: true });
  await setup(page, successful(true));
  await choose(page);
  await submit(page);
  await expect(notice(page)).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.dataset['theme'] = value;
      document.documentElement.classList.toggle('dark', value === 'dark');
      document.documentElement.style.colorScheme = value;
    }, theme);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(notice(page)).toHaveText(noticeText);
      const bounds = await notice(page).boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await notice(page).scrollIntoViewIfNeeded();
      await testInfo.attach(`duplicate-${theme}-${width}`, {
        body: await page.screenshot({
          path: path.join(
            screenshotDirectory,
            `upload-duplicate-${theme}-${width}.png`,
          ),
        }),
        contentType: 'image/png',
      });
      expect(
        (
          await new AxeBuilder({ page })
            .include('[aria-label="Potential duplicate upload"]')
            .analyze()
        ).violations,
      ).toEqual([]);
    }
  }
});
