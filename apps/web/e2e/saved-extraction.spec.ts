import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const patient = {
  id: 'saved-patient',
  displayName: 'Saved Fixture Patient',
  relationship: 'self',
  capabilities: ['view', 'edit'].map((action) => ({
    action,
    scope: { kind: 'patient' },
  })),
};
const title = 'Synthetic saved source.pdf',
  text = 'SYNTHETIC SAVED TEXT';
const record = {
  id: 'saved-source',
  patientId: patient.id,
  title,
  originalTitle: title,
  categoryId: 'general',
  categoryName: 'Unclassified',
  mimeType: 'application/pdf',
  bytes: 500,
  createdAt: '2026-11-13T00:00:00Z',
  canView: true,
  canEdit: true,
  canExport: true,
};
function pdf() {
  const stream = `BT /F1 12 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = objects.map((o, i) => {
    const at = Buffer.byteLength(output);
    output += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const at = Buffer.byteLength(output);
  output += `xref\n0 6\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
  return Buffer.from(output);
}
const local = (page: Page) =>
  page.getByRole('dialog', { name: 'Extracted text', exact: true });
const saved = (page: Page) =>
  page.getByRole('dialog', { name: 'Saved text', exact: true });
const action = (page: Page, name: string) =>
  page.getByRole('button', { name: `${name} ${title}`, exact: true });
async function setup(
  page: Page,
  options: {
    canSave?: boolean;
    canView?: boolean;
    initial?: boolean;
    selectedPage?: boolean;
  } = {},
) {
  const canSave = options.canSave ?? true;
  let canView = options.canView ?? true,
    revision = 0,
    mode = 'normal',
    contexts = 0,
    reads = 0,
    previews = 0;
  const writes: string[] = [],
    external: string[] = [];
  let snapshot: Record<string, unknown> | null = options.initial
    ? {
        method: options.selectedPage ? 'pdf-page-ocr' : 'pdf-text',
        engineVersion: options.selectedPage
          ? 'pdfjs-6.5.438+tesseract-7.0.0+eng-1.0.0'
          : 'pdfjs-6.5.438',
        pages: [{ page: options.selectedPage ? 7 : 1, text }],
        partial: !!options.selectedPage,
        partialReason: options.selectedPage ? 'selected-page' : null,
        downsized: !!options.selectedPage,
        sourceSha256: 'a'.repeat(64),
        revision: 1,
        savedAt: '2026-11-13T00:00:00.000Z',
        unverified: true,
      }
    : null;
  if (snapshot) revision = 1;
  let hold = false,
    release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const context = () => ({
    sourceSha256: 'a'.repeat(64),
    lifecycleVersion: 0,
    revision,
    canSave,
  });
  page.on('request', (request) => {
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
      json: { email: 'fixture@example.test', contextId: 'saved-context' },
    }),
  );
  await page.route('**/api/patients', (route) =>
    route.fulfill({ json: { patients: [patient] } }),
  );
  await page.route('**/api/patients/*/categories', (route) =>
    route.fulfill({ json: { categories: [] } }),
  );
  await page.route('**/api/patients/*/documents', (route) =>
    route.fulfill({
      json: {
        documents: [{ ...record, canView, canEdit: canSave }],
        storageReady: true,
      },
    }),
  );
  await page.route('**/api/patients/*/documents/*/preview', (route) => {
    previews++;
    return route.fulfill({ contentType: 'application/pdf', body: pdf() });
  });
  await page.route(
    '**/api/patients/*/documents/*/extraction/context',
    (route) => {
      contexts++;
      return mode === 'metadata-failed'
        ? route.fulfill({ status: 503 })
        : route.fulfill({ json: { context: context() } });
    },
  );
  await page.route(
    '**/api/patients/*/documents/*/extraction',
    async (route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postData()!;
        writes.push(body);
        const input = JSON.parse(body);
        if (mode === 'conflict') return route.fulfill({ status: 409 });
        if (mode === 'denied') return route.fulfill({ status: 403 });
        if (writes.length === 1) {
          revision++;
          snapshot = {
            ...input.result,
            sourceSha256: context().sourceSha256,
            revision,
            savedAt: '2026-11-13T00:00:00.000Z',
            unverified: true,
          };
        }
        if (mode === 'uncertain' && writes.length === 1)
          return route.abort('failed');
        return route.fulfill({ json: { saved: true, revision } });
      }
      reads++;
      if (hold) await gate;
      if (mode === 'invalid')
        return route.fulfill({
          json: {
            context: context(),
            snapshot: { ...snapshot, unverified: false },
          },
        });
      await route
        .fulfill({ json: { context: context(), snapshot } })
        .catch(() => {});
    },
  );
  await page.goto('/#documents');
  await page
    .getByRole('button', { name: 'Select patient: No patient selected' })
    .click();
  await page
    .getByRole('button', { name: /Saved Fixture Patient \(Your profile\)/ })
    .click();
  await expect(action(page, 'Download')).toBeVisible();
  return {
    writes,
    external,
    counts: () => ({ contexts, reads, previews }),
    mode: (next: string) => {
      mode = next;
    },
    hold: () => {
      hold = true;
    },
    release: () => {
      hold = false;
      release();
    },
    revoke: () => {
      canView = false;
    },
  };
}
async function extract(page: Page) {
  await action(page, 'Extract text').click();
  await expect(local(page)).toContainText(text);
}
test('explicit Save binds pre-extraction context and reopens without fetching or processing original again', async ({
  page,
}) => {
  const api = await setup(page);
  await extract(page);
  // StrictMode may start and abort an initial read in development.
  const capturedContexts = api.counts().contexts;
  expect(capturedContexts).toBeGreaterThanOrEqual(1);
  expect(api.counts().reads).toBe(0);
  expect(api.counts().previews).toBe(1);
  expect(api.writes).toEqual([]);
  await local(page)
    .getByRole('button', { name: 'Save text', exact: true })
    .click();
  await expect(local(page)).toContainText('Unverified text saved');
  expect(api.writes).toHaveLength(1);
  const payload = JSON.parse(api.writes[0]!);
  expect(payload.expectedRevision).toBe(0);
  expect(payload.result.method).toBe('pdf-text');
  expect(payload.result.pages[0].text).toBe(text);
  expect(payload.requestId).toMatch(/^[a-f0-9-]{36}$/);
  await page.keyboard.press('Escape');
  await action(page, 'Saved text').click();
  await expect(saved(page)).toContainText(text);
  await expect(saved(page)).toContainText(/unverified/i);
  const savedReads = api.counts().reads;
  expect(savedReads).toBeGreaterThanOrEqual(1);
  await saved(page)
    .getByLabel('Find in this text', { exact: true })
    .fill('saved');
  await expect(saved(page).locator('mark')).toHaveCount(1);
  expect(api.counts()).toEqual({
    contexts: capturedContexts,
    reads: savedReads,
    previews: 1,
  });
  expect(api.external).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(action(page, 'Saved text')).toBeFocused();
});
test('ambiguous committed response retries exactly the same request without new context or duplicate submit', async ({
  page,
}) => {
  const api = await setup(page);
  api.mode('uncertain');
  await extract(page);
  const contextsBeforeSave = api.counts().contexts;
  await local(page)
    .getByRole('button', { name: 'Save text', exact: true })
    .click();
  await expect(local(page)).toContainText('Save could not be confirmed');
  await local(page)
    .getByRole('button', { name: 'Retry save', exact: true })
    .click();
  await expect(local(page)).toContainText('Unverified text saved');
  expect(api.writes).toHaveLength(2);
  expect(api.writes[0]).toBe(api.writes[1]);
  expect(api.counts().contexts).toBe(contextsBeforeSave);
});
test('concurrent or lifecycle conflict never silently rebases an extracted result', async ({
  page,
}) => {
  const api = await setup(page);
  api.mode('conflict');
  await extract(page);
  const contextsBeforeSave = api.counts().contexts;
  await local(page)
    .getByRole('button', { name: 'Save text', exact: true })
    .click();
  await expect(local(page)).toContainText('Extract again before saving');
  await expect(
    local(page).getByRole('button', { name: 'Save text', exact: true }),
  ).toBeDisabled();
  expect(api.writes).toHaveLength(1);
  expect(api.counts().contexts).toBe(contextsBeforeSave);
  await expect(local(page)).toContainText(text);
});
test('read-only users retain local extraction and can read saved text without shared writes', async ({
  page,
}) => {
  const api = await setup(page, { canSave: false, initial: true });
  await extract(page);
  await expect(local(page)).toContainText(
    'Saving requires edit and view access',
  );
  await expect(
    local(page).getByRole('button', { name: 'Save text', exact: true }),
  ).toHaveCount(0);
  expect(api.writes).toEqual([]);
  await page.keyboard.press('Escape');
  await action(page, 'Saved text').click();
  await expect(saved(page)).toContainText(text);
});
test('optional context failure cannot prevent local extraction or original access', async ({
  page,
}) => {
  const api = await setup(page);
  api.mode('metadata-failed');
  await extract(page);
  await expect(local(page)).toContainText('Saving is unavailable');
  await expect(
    local(page).getByRole('button', { name: 'Save text', exact: true }),
  ).toBeDisabled();
  expect(api.writes).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(action(page, 'Preview')).toBeEnabled();
});
test('empty saved text does not trigger extraction', async ({ page }) => {
  const api = await setup(page);
  await action(page, 'Saved text').click();
  await expect(saved(page)).toContainText('No text has been saved');
  expect(api.counts().contexts).toBe(0);
  expect(api.counts().previews).toBe(0);
  expect(api.counts().reads).toBeGreaterThanOrEqual(1);
});
test('saved selected-page OCR preserves page, partial coverage, downsizing and unverified warnings', async ({
  page,
}) => {
  const api = await setup(page, { initial: true, selectedPage: true });
  await action(page, 'Saved text').click();
  await expect(saved(page)).toContainText('Only the selected page');
  await expect(
    saved(page).getByRole('heading', { name: 'Page 7', exact: true }),
  ).toBeVisible();
  await expect(saved(page)).toContainText(/downsized/);
  await expect(saved(page)).toContainText(/unverified/i);
  expect(api.counts().previews).toBe(0);
});
test('malformed saved output fails closed instead of displaying purported verified text', async ({
  page,
}) => {
  const api = await setup(page, { initial: true });
  api.mode('invalid');
  await action(page, 'Saved text').click();
  await expect(saved(page)).toContainText('Saved text could not be loaded');
  await expect(saved(page)).not.toContainText(text);
});
test('denied Save clears source and protected list', async ({ page }) => {
  const api = await setup(page);
  api.mode('denied');
  await extract(page);
  await local(page)
    .getByRole('button', { name: 'Save text', exact: true })
    .click();
  await expect(local(page)).toHaveCount(0);
  await expect(page.getByRole('alert').first()).toContainText(/access/i);
});
test('lost VIEW while saved retrieval is pending discards late content', async ({
  page,
}) => {
  const api = await setup(page, { initial: true });
  api.hold();
  await action(page, 'Saved text').click();
  await expect(saved(page)).toContainText('Loading saved');
  api.revoke();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(saved(page)).toHaveCount(0);
  api.release();
  await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  await expect(action(page, 'Saved text')).toHaveCount(0);
});
for (const theme of ['light', 'dark'])
  test(`${theme} saved text reflows accessibly with source Find and focus`, async ({
    page,
  }, info) => {
    await page.setViewportSize({
      width: info.project.name === 'mobile' ? 320 : 1440,
      height: 1000,
    });
    await page.addInitScript(
      (value) => localStorage.setItem('fmv.theme', value),
      theme,
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setup(page, { initial: true, selectedPage: true });
    await action(page, 'Saved text').click();
    await expect(saved(page)).toContainText(text);
    await saved(page)
      .getByLabel('Find in this text', { exact: true })
      .fill('text');
    await expect(saved(page).locator('mark')).toHaveCount(1);
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `../../.local/screenshots/saved-extraction-${theme}-${info.project.name}.png`,
    });
    await page.keyboard.press('Escape');
    await expect(action(page, 'Saved text')).toBeFocused();
  });

test('export alone never exposes saved text or local extraction actions', async ({
  page,
}) => {
  const api = await setup(page, {
    canView: false,
    canSave: false,
    initial: true,
  });
  await expect(action(page, 'Saved text')).toHaveCount(0);
  await expect(action(page, 'Extract text')).toHaveCount(0);
  expect(api.counts()).toEqual({ contexts: 0, reads: 0, previews: 0 });
});
