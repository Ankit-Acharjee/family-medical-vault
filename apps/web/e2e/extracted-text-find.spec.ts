import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// DOC-05, AI-01/05/06: real App/local extraction with synthetic sources only.
// WinAnsi octal literals keep accented Latin text deterministic in PDF.js.
function pdf(pages: string[]) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  for (const text of pages) {
    const literal = Array.from(
      text,
      (character) =>
        `\\${character.charCodeAt(0).toString(8).padStart(3, '0')}`,
    ).join('');
    const stream = `BT /F1 0.1 Tf 36 720 Td (${literal}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  }
  let value = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(value);
    value += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(value);
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  value += offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  value += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(value);
}

const patient = {
  id: 'find-a',
  displayName: 'Find Fixture Patient',
  relationship: 'self',
  capabilities: ['view', 'export', 'edit'].map((action) => ({
    action,
    scope: { kind: 'patient' },
  })),
};
const title = 'Synthetic find source.pdf';
const result = (page: Page, ocr = false) =>
  page.getByRole('dialog', {
    name: ocr ? 'Recognized text (OCR)' : 'Extracted text',
    exact: true,
  });
const find = (page: Page) =>
  page.getByLabel('Find in this text', { exact: true });
const action = (page: Page, ocr = false) =>
  page.getByRole('button', {
    name: `${ocr ? 'Recognize text (OCR)' : 'Extract text'} ${title}`,
    exact: true,
  });
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });

async function setup(page: Page, pages = ['Alpha beta ALPHA'], image?: Buffer) {
  const source = image ?? pdf(pages);
  const mimeType = image ? 'image/png' : 'application/pdf';
  let canView = true;
  let patientGate: Promise<void> | undefined;
  let releasePatients: (() => void) | undefined;
  const requests: string[] = [];
  const external: string[] = [];
  const diagnostics: string[] = [];
  page.on('console', (message) => diagnostics.push(message.text()));
  page.on('request', (request) => {
    requests.push(request.url());
    const url = new URL(request.url());
    if (
      /^https?:$/.test(url.protocol) &&
      !['127.0.0.1', 'localhost'].includes(url.hostname)
    )
      external.push(url.href);
  });
  await page.route('**/api/auth/bootstrap', (route) =>
    route.fulfill({ json: { enabled: true, csrf: 'c'.repeat(43) } }),
  );
  await page.route('**/api/auth/account', (route) =>
    route.fulfill({
      json: { email: 'fixture@example.test', contextId: 'find-session' },
    }),
  );
  await page.route('**/api/patients', async (route) => {
    if (patientGate) await patientGate;
    await route.fulfill({ json: { patients: [patient] } }).catch(() => {});
  });
  await page.route('**/api/patients/*/categories', (route) =>
    route.fulfill({ json: { categories: [] } }),
  );
  await page.route('**/api/patients/*/documents', (route) =>
    route.fulfill({
      json: {
        documents: [
          {
            id: 'find-source',
            patientId: patient.id,
            title,
            originalTitle: 'synthetic-find-source.pdf',
            categoryId: 'general',
            categoryName: 'Unclassified',
            createdAt: '2026-11-12T12:00:00Z',
            canView,
            canEdit: true,
            canExport: true,
            bytes: source.length,
            mimeType,
          },
        ],
        storageReady: true,
      },
    }),
  );
  await page.route('**/api/patients/*/documents/*/preview', (route) =>
    route.fulfill({ body: source, contentType: mimeType }),
  );
  await page.goto('/#documents');
  await page.getByRole('button', { name: /Select patient:/ }).click();
  await button(page, `${patient.displayName} (Your profile)`).click();
  await expect(action(page, Boolean(image))).toBeVisible();
  return {
    requests,
    external,
    diagnostics,
    revoke: () => {
      canView = false;
    },
    holdPatients: () => {
      patientGate = new Promise<void>((resolve) => {
        releasePatients = resolve;
      });
    },
    releasePatients: () => {
      patientGate = undefined;
      releasePatients?.();
    },
  };
}

async function open(page: Page) {
  await action(page).click();
  await expect(find(page)).toBeVisible();
}

test('Find treats regex punctuation literally and preserves pages/source/disclosure', async ({
  page,
}) => {
  await setup(page, ['Literal [a+b]?.* first', 'Second [a+b]?.* page']);
  await open(page);
  await find(page).fill('[a+b]?.*');
  await expect(result(page).locator('mark')).toHaveText([
    '[a+b]?.*',
    '[a+b]?.*',
  ]);
  await expect(result(page)).toContainText(title);
  await expect(result(page)).toContainText(/unverified|untrusted/i);
  for (const number of [1, 2])
    await expect(
      result(page).getByRole('heading', {
        name: `Page ${number}`,
        exact: true,
      }),
    ).toBeVisible();
});

test('case-insensitive Unicode matching preserves accented source spelling', async ({
  page,
}) => {
  await setup(page, ['CAFÉ café CAFE']);
  await open(page);
  await find(page).fill('café');
  await expect(result(page).locator('mark')).toHaveText(['CAFÉ', 'café']);
  await expect(result(page)).toContainText('CAFE');
});

test('matches do not overlap or join text across page boundaries', async ({
  page,
}) => {
  await setup(page, ['banana cross', 'page banana']);
  await open(page);
  await find(page).fill('ana');
  await expect(result(page).locator('mark')).toHaveText(['ana', 'ana']);
  await find(page).fill('cross page');
  await expect(result(page).locator('mark')).toHaveCount(0);
  await expect(result(page)).toContainText(/no matches/i);
});

test('unsafe source markup and queries remain inert text nodes', async ({
  page,
}) => {
  const source = '<img src=x onerror=alert(1)> <script>alert(1)</script>';
  const api = await setup(page, [source]);
  const alerts: string[] = [];
  page.on('dialog', async (dialog) => {
    alerts.push(dialog.message());
    await dialog.dismiss();
  });
  await open(page);
  await find(page).fill('<img');
  await expect(result(page).locator('mark')).toHaveText(['<img']);
  await expect(result(page)).toContainText(source);
  await expect(result(page).locator('script,img,iframe')).toHaveCount(0);
  await find(page).fill('<script>alert(1)</script>');
  await expect(result(page).locator('mark')).toHaveText([
    '<script>alert(1)</script>',
  ]);
  expect(alerts).toEqual([]);
  expect(api.external).toEqual([]);
});

test('match navigation wraps and keyboard actions retain control focus', async ({
  page,
}) => {
  await setup(page, ['Alpha ALPHA', 'alpha']);
  await open(page);
  await find(page).fill('alpha');
  const current = result(page).locator('mark[aria-current="true"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText('Alpha');
  await expect(
    result(page).getByRole('status').filter({ hasText: 'Match 1 of 3.' }),
  ).toBeVisible();
  await button(page, 'Next match').focus();
  await page.keyboard.press('Enter');
  await expect(current).toHaveText('ALPHA');
  await expect(
    result(page).getByRole('status').filter({ hasText: 'Match 2 of 3.' }),
  ).toBeVisible();
  await expect(button(page, 'Next match')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(current).toHaveText('alpha');
  await page.keyboard.press('Enter');
  await expect(current).toHaveText('Alpha');
  await button(page, 'Previous match').focus();
  await page.keyboard.press('Space');
  await expect(current).toHaveText('alpha');
  await expect(button(page, 'Previous match')).toBeFocused();
  await find(page).focus();
  await page.keyboard.press('Enter');
  await expect(current).toHaveText('Alpha');
  await page.keyboard.press('Shift+Enter');
  await expect(current).toHaveText('alpha');
  await expect(find(page)).toBeFocused();
});

test('no-match and Clear states announce results and restore input focus', async ({
  page,
}) => {
  await setup(page);
  await open(page);
  await expect(find(page)).toHaveAttribute('maxlength', '200');
  await find(page).fill('q'.repeat(201));
  await expect(find(page)).toHaveValue('q'.repeat(200));
  await find(page).fill('unmatched');
  await expect(result(page)).toContainText(/no matches/i);
  await expect(button(page, 'Previous match')).toBeDisabled();
  await expect(button(page, 'Next match')).toBeDisabled();
  await button(page, 'Clear search').click();
  await expect(find(page)).toHaveValue('');
  await expect(find(page)).toBeFocused();
  await expect(result(page).locator('mark')).toHaveCount(0);
  await expect(result(page)).not.toContainText(/no matches/i);
});

test('Find adds no requests, URL state, storage, or content diagnostics', async ({
  page,
}) => {
  const token = 'PRIVATE_FIND_FIXTURE';
  const api = await setup(page, [`${token} ${token}`]);
  await open(page);
  const before = await page.evaluate(async () => ({
    url: location.href,
    local: { ...localStorage },
    session: { ...sessionStorage },
    databases: await indexedDB.databases(),
    caches: await caches.keys(),
  }));
  const requestCount = api.requests.length;
  await find(page).fill(token);
  await button(page, 'Next match').click();
  await button(page, 'Previous match').click();
  await button(page, 'Clear search').click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(api.requests).toHaveLength(requestCount);
  const after = await page.evaluate(async () => ({
    url: location.href,
    local: { ...localStorage },
    session: { ...sessionStorage },
    databases: await indexedDB.databases(),
    caches: await caches.keys(),
  }));
  expect(after).toEqual(before);
  expect(JSON.stringify(after)).not.toContain(token);
  expect(api.diagnostics.join('\n')).not.toContain(token);
  expect(api.external).toEqual([]);
});

test('closing and reopening extracted text clears the query and active match', async ({
  page,
}) => {
  await setup(page);
  await open(page);
  await find(page).fill('alpha');
  await button(page, 'Next match').click();
  await button(page, 'Close dialog').click();
  await expect(action(page)).toBeFocused();
  await open(page);
  await expect(find(page)).toHaveValue('');
  await expect(result(page).locator('mark')).toHaveCount(0);
});

test('allowed access revalidation unmounts Find and clears its query', async ({
  page,
}) => {
  const api = await setup(page);
  await open(page);
  await find(page).fill('alpha');
  api.holdPatients();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(find(page)).toHaveCount(0);
  api.releasePatients();
  await expect(button(page, 'Retry extraction')).toBeEnabled();
  await expect(find(page)).toHaveCount(0);
  await button(page, 'Retry extraction').click();
  await expect(find(page)).toBeVisible();
  await expect(find(page)).toHaveValue('');
  await expect(result(page).locator('mark')).toHaveCount(0);
});

test('lost VIEW clears a populated Find result before it can be reopened', async ({
  page,
}) => {
  const api = await setup(page);
  await open(page);
  await find(page).fill('alpha');
  api.revoke();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(result(page)).toHaveCount(0);
  await expect(find(page)).toHaveCount(0);
  await expect(action(page)).toHaveCount(0);
  await expect(page.locator('mark')).toHaveCount(0);
});

test('rendered matches stop at 500 and explicitly disclose the cap', async ({
  page,
}) => {
  await setup(
    page,
    Array.from({ length: 6 }, () => 'hit '.repeat(100)),
  );
  await open(page);
  await find(page).fill('hit');
  await expect(result(page).locator('mark')).toHaveCount(500);
  await expect(result(page)).toContainText(/500/);
  await expect(result(page)).toContainText(
    /first 500|limit|cap|more than 500/i,
  );
  await expect(
    result(page).getByRole('heading', { name: 'Page 6', exact: true }),
  ).toBeVisible();
});

test('Find keeps partial-output and source-page warnings visible', async ({
  page,
}) => {
  await setup(
    page,
    Array.from({ length: 51 }, (_, index) => `Synthetic page ${index + 1}`),
  );
  await open(page);
  await find(page).fill('Synthetic');
  await expect(result(page).locator('mark')).toHaveCount(50);
  await expect(result(page)).toContainText(/partial result/i);
  await expect(result(page)).toContainText(/page cap/i);
  await expect(result(page)).toContainText(/not the complete document/i);
  await expect(result(page)).not.toContainText('Synthetic page 51');
});

test('real local image OCR shares Find without changing OCR disclosures', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const encoded = await page.evaluate(() => {
    const canvas = window.document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 300;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 1200, 300);
    context.fillStyle = '#000';
    context.font = 'bold 64px Arial';
    context.fillText('FAMILY VAULT TEST', 50, 150);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await setup(page, [], Buffer.from(encoded, 'base64'));
  await action(page, true).click();
  await button(page, 'Start OCR').click();
  await expect(find(page)).toBeVisible({ timeout: 65_000 });
  await find(page).fill('vault');
  await expect(result(page, true).locator('mark')).toHaveText(['VAULT']);
  await expect(result(page, true)).toContainText(/unverified/i);
  await expect(result(page, true)).toContainText(/printed English/i);
  await expect(result(page, true)).toContainText(title);
});

for (const theme of ['light', 'dark']) {
  test(`${theme} Find reflows with accessible keyboard controls`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({
      width: testInfo.project.name === 'mobile' ? 320 : 1440,
      height: 1000,
    });
    await page.addInitScript(
      (value) => localStorage.setItem('fmv.theme', value),
      theme,
    );
    await setup(page, [`Synthetic ${'longword'.repeat(70)} alpha ALPHA`]);
    await open(page);
    await find(page).fill('alpha');
    await expect(result(page).locator('mark')).toHaveCount(2);
    await button(page, 'Next match').focus();
    await page.keyboard.press('Enter');
    await expect(button(page, 'Next match')).toBeFocused();
    const overflow = await result(page).evaluate(
      (element) => element.scrollWidth > element.clientWidth + 1,
    );
    expect(overflow).toBe(false);
    expect(
      await page.evaluate(
        () => window.document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`extracted-text-find-${theme}.png`),
    });
  });
}
