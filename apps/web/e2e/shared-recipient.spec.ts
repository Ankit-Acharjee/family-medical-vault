import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
const token = 's'.repeat(43),
  patient = '11111111-1111-4111-8111-111111111111',
  doc = '22222222-2222-4222-8222-222222222222',
  link = '33333333-3333-4333-8333-333333333333',
  bytes = Buffer.from('%PDF-1.7\nSYNTHETIC shared original\n%%EOF');
async function setup(page: Page) {
  let mode = 'ready',
    fileMode = 'ready';
  const unexpected: string[] = [],
    errors: string[] = [],
    requests: { url: string; body: unknown }[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      json = (v: unknown, status = 200) => route.fulfill({ status, json: v });
    if (path === '/api/auth/bootstrap')
      return json({ enabled: true, csrf: 'c'.repeat(43) });
    requests.push({ url: req.url(), body: req.postDataJSON() });
    expect(req.method()).toBe('POST');
    expect(req.headers()['x-csrf-token']).toBe('c'.repeat(43));
    if (path === '/api/sharing/open') {
      expect(req.postDataJSON()).toEqual({ token });
      if (mode === 'denied') return json({}, 404);
      if (mode === 'failed') return json({}, 503);
      return json({
        linkId: link,
        expiresAt,
        selection: {
          patientId: patient,
          patientName: 'SYNTHETIC shared patient',
          snapshotSha256: 'a'.repeat(64),
          files: [
            {
              id: doc,
              title: 'SYNTHETIC report বাংলা.pdf',
              originalTitle: 'SYNTHETIC original.pdf',
              mimeType: 'application/pdf',
              bytes: bytes.length,
              sha256: createHash('sha256').update(bytes).digest('hex'),
            },
          ],
        },
      });
    }
    if (path === '/api/sharing/original') {
      expect(req.postDataJSON()).toEqual({ token, documentId: doc });
      if (fileMode === 'denied') return json({}, 404);
      return route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: fileMode === 'corrupt' ? Buffer.from('%PDF-1.7 altered') : bytes,
      });
    }
    unexpected.push(path);
    return json({}, 404);
  });
  await page.goto('/#shared=' + token);
  await expect(
    page.getByRole('heading', { name: 'Shared original documents' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#shared$/);
  return {
    expiresAt,
    unexpected,
    errors,
    requests,
    mode(v: string) {
      mode = v;
    },
    fileMode(v: string) {
      fileMode = v;
    },
  };
}
test('secret fragment is stripped before requests, with isolated explicit access and verified download in both themes', async ({
  page,
}, info) => {
  const f = await setup(page);
  expect(f.requests).toHaveLength(0);
  await expect(
    page.getByRole('button', { name: /Select patient/ }),
  ).toHaveCount(0);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open shared originals' }).click();
  await expect(
    page.getByText('Patient: SYNTHETIC shared patient', { exact: true }),
  ).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
      document.documentElement.classList.toggle('dark', t === 'dark');
    }, theme);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `../../.local/screenshots/shared-recipient-${info.project.name}-${theme}.png`,
    });
  }
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download original' }).click();
  expect((await event).suggestedFilename()).toBe('shared-original.pdf');
  await expect(page.getByRole('status')).toContainText('Download started.');
  expect(f.requests.every((r) => !r.url.includes(token))).toBe(true);
  expect(f.unexpected).toEqual([]);
  expect(f.errors).toEqual([]);
  const stored = await page.evaluate(() =>
    JSON.stringify({ ...localStorage, ...sessionStorage }),
  );
  expect(stored).not.toContain(token);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText(
    'reopen the original secret link',
  );
  expect(f.unexpected).toEqual([]);
});
test('denied and failed metadata stay private, with retry and no vault/account API access', async ({
  page,
}) => {
  const f = await setup(page);
  f.mode('failed');
  await page.getByRole('button', { name: 'Open shared originals' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'No records are displayed',
  );
  await expect(page.getByText('SYNTHETIC report বাংলা.pdf')).toHaveCount(0);
  f.mode('ready');
  await page.getByRole('button', { name: 'Try shared access again' }).click();
  await expect(page.getByText('SYNTHETIC report বাংলা.pdf')).toBeVisible();
  f.mode('denied');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert')).toContainText(
    'This link is unavailable',
  );
  await expect(page.getByText('SYNTHETIC report বাংলা.pdf')).toHaveCount(0);
  expect(f.unexpected).toEqual([]);
  expect(f.errors).toEqual([]);
});
test('changed bytes never download; revocation during use clears all protected metadata', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Open shared originals' }).click();
  await expect(
    page.getByRole('button', { name: 'Download original' }),
  ).toBeVisible();
  f.fileMode('corrupt');
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Download original' }).click();
  await expect(page.getByRole('status')).toContainText(
    'No unverified bytes were delivered',
  );
  expect(downloads).toBe(0);
  f.fileMode('denied');
  await page.getByRole('button', { name: 'Download original' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'This link is unavailable',
  );
  await expect(
    page.getByText('SYNTHETIC shared patient', { exact: false }),
  ).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
test('display expiry clears content without trusting the browser clock for server authority', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Open shared originals' }).click();
  await expect(page.getByText('SYNTHETIC report বাংলা.pdf')).toBeVisible();
  await page.evaluate((expiry) => {
    Date.now = () => Date.parse(expiry) + 1;
  }, f.expiresAt);
  await expect(page.getByRole('alert')).toContainText(
    'This link is unavailable',
  );
  await expect(
    page.getByRole('button', { name: 'Download original' }),
  ).toHaveCount(0);
  expect(f.unexpected).toEqual([]);
});
