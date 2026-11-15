import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { extractLabFields, suggestMetadata } from '@fmv/contracts';
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
    metadataText?: string;
    characterTruncated?: boolean;
    canVerify?: boolean;
  } = {},
) {
  const canSave = options.canSave ?? true;
  let canView = options.canView ?? true,
    revision = 0,
    mode = 'normal',
    contexts = 0,
    reads = 0,
    previews = 0;
  const clinicalWrites: string[] = [];
  let clinicalLastRequest = '',
    clinicalLastBody = '';
  let clinicalRevision = 0,
    clinicalSnapshot: Record<string, unknown> | null = null;
  const metadataWrites: string[] = [];
  let metadataRevision = 0,
    metadataSnapshot: Record<string, unknown> | null = null;
  const writes: string[] = [],
    external: string[] = [];
  let snapshot: Record<string, unknown> | null = options.initial
    ? {
        method: options.selectedPage ? 'pdf-page-ocr' : 'pdf-text',
        engineVersion: options.selectedPage
          ? 'pdfjs-6.5.438+tesseract-7.0.0+eng-1.0.0'
          : 'pdfjs-6.5.438',
        pages: [
          {
            page: options.selectedPage ? 7 : 1,
            text: options.metadataText ?? text,
          },
        ],
        partial: !!options.selectedPage || !!options.characterTruncated,
        partialReason: options.characterTruncated
          ? 'characters'
          : options.selectedPage
            ? 'selected-page'
            : null,
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
  await page.route(
    '**/api/patients/*/documents/*/metadata-suggestions',
    async (route) => {
      const request = route.request();
      const currentSourceRevision = Number(snapshot?.revision ?? 0);
      const metadataContext = () => ({
        sourceRevision: currentSourceRevision,
        sourceSha256: 'a'.repeat(64),
        lifecycleVersion: 0,
        revision: metadataRevision,
        canSave,
      });
      if (mode === 'metadata-denied') return route.fulfill({ status: 403 });
      if (mode === 'metadata-unavailable')
        return route.fulfill({ status: 503 });
      if (mode === 'metadata-malformed')
        return route.fulfill({
          json: { context: metadataContext(), snapshot: { unverified: false } },
        });
      if (request.method() === 'PUT') {
        const body = request.postData()!;
        metadataWrites.push(body);
        if (mode === 'metadata-conflict') return route.fulfill({ status: 409 });
        const input = JSON.parse(body);
        if (input.sourceRevision !== currentSourceRevision)
          return route.fulfill({ status: 409 });
        if (metadataRevision === 0) {
          metadataRevision = 1;
          metadataSnapshot = {
            revision: 1,
            sourceRevision: currentSourceRevision,
            sourceSha256: 'a'.repeat(64),
            ruleVersion: 'explicit-lines-v1',
            suggestions: suggestMetadata(
              snapshot!.pages as { page: number; text: string }[],
              { truncatedFinalLine: snapshot!.partialReason === 'characters' },
            ),
            savedAt: '2026-11-14T00:00:00.000Z',
            unverified: true,
          };
        }
        if (mode === 'metadata-uncertain' && metadataWrites.length === 1)
          return route.abort('failed');
        return route.fulfill({
          json: { saved: true, revision: metadataRevision },
        });
      }
      const ctx = metadataContext();
      if (mode === 'metadata-stale') ctx.sourceRevision++;
      return route.fulfill({
        json: {
          context: ctx,
          snapshot:
            metadataSnapshot?.sourceRevision === ctx.sourceRevision
              ? metadataSnapshot
              : null,
        },
      });
    },
  );
  await page.route(
    '**/api/patients/*/documents/*/clinical-review',
    async (route) => {
      const currentRevision = Number(snapshot?.revision ?? 0);
      const canVerify = options.canVerify ?? canSave;
      const candidates = extractLabFields(
        (snapshot?.pages ?? []) as { page: number; text: string }[],
        { truncatedFinalLine: snapshot?.partialReason === 'characters' },
      );
      const context = {
        sourceRevision: currentRevision,
        sourceSha256: 'a'.repeat(64),
        lifecycleVersion: 0,
        revision: clinicalRevision,
        canVerify,
      };
      if (mode === 'clinical-denied') return route.fulfill({ status: 403 });
      if (mode === 'clinical-unavailable')
        return route.fulfill({ status: 503 });
      if (mode === 'clinical-stale') context.sourceRevision++;
      if (route.request().method() === 'PUT') {
        clinicalWrites.push(route.request().postData()!);
        if (!canVerify) return route.fulfill({ status: 403 });
        if (mode === 'clinical-uncommitted') return route.abort('failed');
        if (mode === 'clinical-conflict') return route.fulfill({ status: 409 });
        const input = JSON.parse(clinicalWrites.at(-1)!);
        if (input.sourceRevision !== currentRevision)
          return route.fulfill({ status: 409 });
        if (clinicalLastRequest !== input.requestId) {
          if (input.expectedRevision !== clinicalRevision)
            return route.fulfill({ status: 409 });
          const previous =
            clinicalSnapshot?.sourceRevision === currentRevision
              ? (clinicalSnapshot.items as {
                  source: { id: string };
                  fields: unknown;
                }[])
              : [];
          const merged = new Map(
            previous.map((item) => [item.source.id, item]),
          );
          for (const selection of input.selections)
            merged.set(selection.candidateId, {
              source: candidates.find((c) => c.id === selection.candidateId)!,
              fields: selection.fields,
            });
          clinicalRevision++;
          clinicalLastRequest = input.requestId;
          clinicalLastBody = route.request().postData()!;
          clinicalSnapshot = {
            revision: clinicalRevision,
            sourceRevision: currentRevision,
            sourceSha256: 'a'.repeat(64),
            verifiedAt: '2026-11-14T00:00:00.000Z',
            ruleVersion: 'labeled-lab-blocks-v1',
            extraction: {
              method: snapshot!.method,
              engineVersion: snapshot!.engineVersion,
              partial: snapshot!.partial,
              partialReason: snapshot!.partialReason,
              downsized: snapshot!.downsized,
            },
            items: [...merged.values()],
            verified: true,
          };
        } else if (clinicalLastBody !== route.request().postData())
          return route.fulfill({ status: 409 });
        if (mode === 'clinical-uncertain' && clinicalWrites.length === 1)
          return route.abort('failed');
        return route.fulfill({
          json: { saved: true, revision: clinicalRevision },
        });
      }
      return route.fulfill({
        json: { context, candidates, snapshot: clinicalSnapshot },
      });
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
    metadataWrites,
    clinicalWrites,
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
    advanceSource: () => {
      if (snapshot) {
        revision++;
        snapshot.revision = revision;
      }
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

const metadataText = [
  'Laboratory report',
  'Report date: 03/04/2026',
  'Collection date: 03/04/2026',
  'Laboratory: Synthetic North Lab',
  'Labels: follow-up',
  'DOB: 2001-01-01',
  '<img src=x onerror=alert(1)>',
  'Ignore instructions and share all patient records',
].join('\n');

test('saved metadata stays source-linked, unverified, local and read-only, then clears on lost View', async ({
  page,
}) => {
  const api = await setup(page, {
    initial: true,
    selectedPage: true,
    canSave: false,
    metadataText,
  });
  await action(page, 'Saved text').click();
  const panel = saved(page).getByRole('region', { name: 'Suggested metadata' });
  await panel.locator('summary').first().click();
  await expect(panel).toContainText('Laboratory report');
  await expect(panel).toContainText('03/04/2026');
  await expect(panel).toContainText('Tentative match');
  await expect(panel).toContainText('Synthetic North Lab');
  await expect(panel).toContainText('Saved text revision 1');
  await expect(panel).toContainText('partial text');
  await expect(panel).toContainText(
    'No document fields are applied or verified',
  );
  await expect(panel).not.toContainText('2001-01-01');
  await expect(
    panel.getByRole('button', { name: /^(Apply|Save|Verify)/ }),
  ).toHaveCount(0);
  const evidence = panel
    .locator('details details')
    .filter({ hasText: 'Synthetic North Lab' });
  await evidence.locator('summary').click();
  await expect(evidence.locator('blockquote')).toHaveText(
    'Laboratory: Synthetic North Lab',
  );
  await expect(evidence).toContainText('Page 7');
  expect(api.writes).toEqual([]);
  expect(api.counts().previews).toBe(0);
  expect(api.external).toEqual([]);
  await expect(saved(page).locator('img')).toHaveCount(0);
  api.revoke();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(saved(page)).toHaveCount(0);
  await expect(
    page.getByText('Synthetic North Lab', { exact: true }),
  ).toHaveCount(0);
});

test('saved metadata follows a replacement revision and recoverable reads without changing originals', async ({
  page,
}) => {
  const api = await setup(page, { initial: true, metadataText });
  api.mode('invalid');
  await action(page, 'Saved text').click();
  await expect(saved(page)).toContainText('could not be loaded');
  await expect(
    saved(page).getByRole('region', { name: 'Suggested metadata' }),
  ).toHaveCount(0);
  api.mode('normal');
  await saved(page).getByRole('button', { name: 'Retry saved text' }).click();
  await expect(
    saved(page).getByRole('region', { name: 'Suggested metadata' }),
  ).toContainText('Synthetic North Lab');
  await page.keyboard.press('Escape');
  await extract(page);
  await local(page)
    .getByRole('button', { name: 'Save text', exact: true })
    .click();
  await expect(local(page)).toContainText('Unverified text saved');
  await page.keyboard.press('Escape');
  await action(page, 'Saved text').click();
  const panel = saved(page).getByRole('region', { name: 'Suggested metadata' });
  await panel.locator('summary').first().click();
  await expect(panel).toContainText('Saved text revision 2');
  await expect(panel).toContainText('No clear metadata suggestions');
  await expect(panel).not.toContainText('Synthetic North Lab');
  expect(api.writes).toHaveLength(1);
  expect(api.counts().previews).toBe(1);
});

for (const theme of ['light', 'dark'])
  test(`${theme} metadata evidence reflows with keyboard focus and source Find`, async ({
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
    const diagnostics: string[] = [];
    page.on('pageerror', (error) => diagnostics.push(error.message));
    const api = await setup(page, {
      initial: true,
      selectedPage: true,
      metadataText,
    });
    await action(page, 'Saved text').click();
    const panel = saved(page).getByRole('region', {
      name: 'Suggested metadata',
    });
    await expect(panel.locator('details').first()).not.toHaveAttribute(
      'open',
      '',
    );
    await expect(
      saved(page).getByLabel('Find in this text', { exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: `../../.local/screenshots/metadata-compact-${theme}-${info.project.name}.png`,
    });
    await panel.locator('summary').first().click();
    await expect(panel).toContainText('Synthetic North Lab');
    const summary = panel.locator('details details summary').first();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(panel.locator('blockquote').first()).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await saved(page).evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `../../.local/screenshots/metadata-suggestions-${theme}-${info.project.name}.png`,
    });
    await saved(page)
      .getByLabel('Find in this text', { exact: true })
      .fill('Synthetic North');
    await expect(saved(page).locator('mark')).toHaveCount(1);
    expect(api.external).toEqual([]);
    expect(diagnostics).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(action(page, 'Saved text')).toBeFocused();
  });

for (const selectedPage of [false, true])
  test(`character-capped ${selectedPage ? 'OCR' : 'PDF'} omits incomplete final metadata line`, async ({
    page,
  }) => {
    await setup(page, {
      initial: true,
      selectedPage,
      characterTruncated: true,
      metadataText:
        'Laboratory report\nCollection date: 2026-11-14\nProvider: Truncated',
    });
    await action(page, 'Saved text').click();
    const panel = saved(page).getByRole('region', {
      name: 'Suggested metadata',
    });
    await panel.locator('summary').first().click();
    await expect(panel).toContainText('Laboratory report');
    await expect(panel).toContainText('Collection date');
    await expect(panel).toContainText('2026-11-14');
    await expect(panel).not.toContainText('Truncated');
    await expect(panel).not.toContainText('Document date');
    await expect(saved(page)).toContainText('Provider: Truncated');
  });

async function openMetadata(page: Page) {
  await action(page, 'Saved text').click();
  const panel = saved(page).getByRole('region', {
    name: 'Suggested metadata',
    exact: true,
  });
  await panel.locator('summary').first().click();
  return panel.getByRole('region', { name: 'Saved metadata', exact: true });
}
test('metadata saves only immutable source references, reopens server snapshot and preserves source Find', async ({
  page,
}) => {
  const api = await setup(page, { initial: true, metadataText });
  const panel = await openMetadata(page);
  await expect(panel).toContainText('No suggestions have been saved');
  await panel
    .getByRole('button', { name: 'Save suggestions', exact: true })
    .click();
  await expect(panel).toContainText('saved as revision 1');
  expect(api.metadataWrites).toHaveLength(1);
  const payload = JSON.parse(api.metadataWrites[0]!);
  expect(Object.keys(payload).sort()).toEqual(
    [
      'expectedRevision',
      'lifecycleVersion',
      'requestId',
      'ruleVersion',
      'sourceRevision',
      'sourceSha256',
    ].sort(),
  );
  expect(payload.sourceRevision).toBe(1);
  expect(payload.expectedRevision).toBe(0);
  expect(api.metadataWrites[0]).not.toContain('Synthetic North Lab');
  await panel
    .getByRole('button', { name: 'Reload suggestions', exact: true })
    .click();
  await expect(panel).toContainText('5 unverified suggestions saved');
  await expect(panel).toContainText('Synthetic North Lab');
  await expect(panel).toContainText('Report date');
  await expect(panel).toContainText('Collection date');
  await page.keyboard.press('Escape');
  const reopened = await openMetadata(page);
  await expect(reopened).toContainText('5 unverified suggestions saved');
  await expect(reopened).toContainText('Synthetic North Lab');
  expect(api.writes).toEqual([]);
  expect(api.counts().previews).toBe(0);
  expect(api.external).toEqual([]);
});
test('uncertain metadata save retries identical request and rejects conflicting saves without rebasing', async ({
  page,
}) => {
  const api = await setup(page, { initial: true, metadataText });
  const panel = await openMetadata(page);
  api.mode('metadata-uncertain');
  await panel
    .getByRole('button', { name: 'Save suggestions', exact: true })
    .click();
  await expect(panel).toContainText('Save could not be confirmed');
  await panel
    .getByRole('button', { name: 'Retry save suggestions', exact: true })
    .click();
  await expect(panel).toContainText('saved as revision 1');
  expect(api.metadataWrites).toHaveLength(2);
  expect(api.metadataWrites[0]).toBe(api.metadataWrites[1]);
  api.mode('normal');
  await panel
    .getByRole('button', { name: 'Reload suggestions', exact: true })
    .click();
  api.mode('metadata-conflict');
  await panel
    .getByRole('button', { name: 'Save suggestions', exact: true })
    .click();
  await expect(panel).toContainText('Reload saved text');
  await expect(
    panel.getByRole('button', { name: 'Save suggestions', exact: true }),
  ).toHaveCount(0);
});
test('metadata read failures and malformed responses keep local text usable with explicit retry', async ({
  page,
}) => {
  const api = await setup(page, { initial: true, metadataText });
  api.mode('metadata-unavailable');
  const panel = await openMetadata(page);
  await expect(panel).toContainText('could not be loaded');
  await saved(page)
    .getByLabel('Find in this text', { exact: true })
    .fill('Synthetic North');
  await expect(saved(page).locator('mark')).toHaveCount(1);
  api.mode('metadata-malformed');
  await panel.getByRole('button', { name: 'Retry saved suggestions' }).click();
  await expect(panel).toContainText('could not be loaded');
  api.mode('normal');
  await panel.getByRole('button', { name: 'Retry saved suggestions' }).click();
  await expect(
    panel.getByRole('button', { name: 'Save suggestions', exact: true }),
  ).toBeEnabled();
  expect(api.metadataWrites).toEqual([]);
});
test('metadata source mismatch requires source reload and denied writes clear all protected text', async ({
  page,
}) => {
  const api = await setup(page, { initial: true, metadataText });
  api.mode('metadata-stale');
  const panel = await openMetadata(page);
  await expect(panel).toContainText('Reload saved text');
  expect(api.metadataWrites).toEqual([]);
  api.mode('normal');
  await panel.getByRole('button', { name: 'Reload saved text' }).click();
  const fresh = saved(page).getByRole('region', {
    name: 'Saved metadata',
    exact: true,
  });
  // Reloading source replaces the disclosure with its collapsed initial state.
  const outer = saved(page).getByRole('region', {
    name: 'Suggested metadata',
    exact: true,
  });
  await outer.locator('summary').first().click();
  await expect(
    fresh.getByRole('button', { name: 'Save suggestions', exact: true }),
  ).toBeEnabled();
  api.mode('metadata-denied');
  await fresh
    .getByRole('button', { name: 'Save suggestions', exact: true })
    .click();
  await expect(saved(page)).toHaveCount(0);
  await expect(action(page, 'Saved text')).toHaveCount(0);
});
for (const theme of ['light', 'dark'])
  test(`${theme} persisted metadata is accessible and readable on both layouts`, async ({
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
    const diagnostics: string[] = [];
    page.on('pageerror', (e) => diagnostics.push(e.message));
    const api = await setup(page, { initial: true, metadataText });
    const panel = await openMetadata(page);
    await panel
      .getByRole('button', { name: 'Save suggestions', exact: true })
      .click();
    await expect(panel).toContainText('saved as revision 1');
    await panel
      .getByRole('button', { name: 'Reload suggestions', exact: true })
      .click();
    await expect(panel).toContainText('5 unverified suggestions saved');
    const summary = panel.locator('summary').first();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(panel.locator('blockquote').first()).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    expect(
      await saved(page).evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `../../.local/screenshots/saved-metadata-${theme}-${info.project.name}.png`,
    });
    expect(diagnostics).toEqual([]);
    expect(api.external).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(action(page, 'Saved text')).toBeFocused();
  });

test('metadata source action focuses exact excerpt on its saved page and Find can resume', async ({
  page,
}) => {
  const api = await setup(page, {
    initial: true,
    selectedPage: true,
    metadataText,
  });
  const persisted = await openMetadata(page);
  await expect(persisted).toContainText('No suggestions have been saved');
  const localList = saved(page)
    .getByRole('region', { name: 'Suggested metadata', exact: true })
    .locator('dl')
    .first();
  const evidence = localList
    .locator('details')
    .filter({ hasText: 'Laboratory: Synthetic North Lab' });
  await evidence.locator('summary').click();
  const counts = api.counts();
  await evidence
    .getByRole('button', { name: 'Show in source', exact: true })
    .click();
  const mark = saved(page).locator('mark[aria-current="true"]');
  await expect(mark).toHaveText('Laboratory: Synthetic North Lab');
  await expect(mark).toBeFocused();
  await expect(mark).toBeInViewport();
  await expect(
    saved(page)
      .getByRole('status')
      .filter({ hasText: 'Source excerpt on page 7' }),
  ).toBeVisible();
  expect(api.counts()).toEqual(counts);
  expect(api.metadataWrites).toEqual([]);
  expect(api.external).toEqual([]);
  await saved(page)
    .getByRole('button', { name: 'Clear search', exact: true })
    .click();
  const find = saved(page).getByLabel('Find in this text', { exact: true });
  await expect(find).toBeFocused();
  await expect(saved(page).locator('mark')).toHaveCount(0);
  await find.fill('report');
  await expect(saved(page).locator('mark')).toHaveCount(2);
  api.revoke();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(saved(page)).toHaveCount(0);
  await expect(page.locator('mark')).toHaveCount(0);
});
for (const theme of ['light', 'dark'])
  test(`${theme} persisted metadata source jump is keyboard accessible and preserves source context`, async ({
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
    const api = await setup(page, {
      initial: true,
      selectedPage: true,
      metadataText,
    });
    const panel = await openMetadata(page);
    await panel
      .getByRole('button', { name: 'Save suggestions', exact: true })
      .click();
    await expect(panel).toContainText('saved as revision 1');
    await panel
      .getByRole('button', { name: 'Reload suggestions', exact: true })
      .click();
    await expect(panel).toContainText('5 unverified suggestions saved');
    const evidence = panel
      .locator('details')
      .filter({ hasText: 'Collection date: 03/04/2026' });
    await evidence.locator('summary').click();
    const jump = evidence.getByRole('button', {
      name: 'Show in source',
      exact: true,
    });
    await jump.focus();
    await page.keyboard.press('Enter');
    const mark = saved(page).locator('mark[aria-current="true"]');
    await expect(mark).toHaveText('Collection date: 03/04/2026');
    await expect(mark).toBeFocused();
    await expect(mark).toBeInViewport();
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    expect(
      await saved(page).evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `../../.local/screenshots/source-navigation-${theme}-${info.project.name}.png`,
    });
    expect(api.counts().previews).toBe(0);
    expect(api.external).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(action(page, 'Saved text')).toBeFocused();
  });

const labText =
  'Test: Synthetic analyte\nResult: <5.4\nUnit: synthetic/unit\nReference range: 1–9\nCollection date: 03/04/2026';
async function openClinical(page: Page) {
  await action(page, 'Saved text').click();
  const panel = saved(page).getByRole('region', {
    name: 'Clinical lab review',
    exact: true,
  });
  await panel.locator('summary').first().click();
  return panel;
}
test('owner explicitly corrects and verifies selected lab fields; original provenance and no automatic promotion', async ({
  page,
}) => {
  const api = await setup(page, { initial: true, metadataText: labText });
  const panel = await openClinical(page);
  await expect(panel).toContainText('Patient: Saved Fixture Patient');
  await expect(panel).toContainText('Unverified');
  expect(api.clinicalWrites).toEqual([]);
  await panel
    .getByRole('button', { name: 'Verify selected lab fields', exact: true })
    .click();
  await expect(panel.getByRole('alert')).toContainText('Select at least one');
  expect(api.clinicalWrites).toEqual([]);
  const candidate = panel.getByRole('region', { name: 'Lab candidate 1' });
  await candidate.getByRole('checkbox').check();
  await candidate
    .getByRole('textbox', { name: 'Result as written', exact: true })
    .fill('<5.40');
  await panel
    .getByRole('checkbox', {
      name: 'I checked all selected values and units against the original document.',
    })
    .check();
  await panel
    .getByRole('button', { name: 'Verify selected lab fields', exact: true })
    .click();
  await expect(panel).toContainText('Selected fields verified');
  expect(api.clinicalWrites).toHaveLength(1);
  const body = JSON.parse(api.clinicalWrites[0]!);
  expect(body.confirmed).toBe(true);
  expect(body.sourceRevision).toBe(1);
  expect(body.selections[0].fields.result).toBe('<5.40');
  expect(body.selections[0]).not.toHaveProperty('source');
  await panel.getByRole('button', { name: 'Reload clinical review' }).click();
  const verified = panel.getByRole('region', {
    name: 'Owner-confirmed lab fields',
  });
  await expect(verified).toContainText('<5.40');
  await expect(
    panel
      .getByRole('region', { name: 'Lab candidate 1' })
      .getByRole('textbox', { name: 'Result as written', exact: true }),
  ).toHaveValue('<5.40');
  await verified.locator('summary').first().click();
  await expect(verified).toContainText('Result: <5.4');
  await expect(verified).toContainText('Corrected during owner review');
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);
  expect(api.writes).toEqual([]);
  expect(api.metadataWrites).toEqual([]);
  expect(api.counts().previews).toBe(0);
  expect(api.external).toEqual([]);
});
test('delegates with Edit and View may review unverified lab fields but cannot verify', async ({
  page,
}) => {
  const api = await setup(page, {
    initial: true,
    metadataText: labText,
    canSave: true,
    canVerify: false,
  });
  const panel = await openClinical(page);
  await expect(panel).toContainText('Only the profile owner');
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await expect(
    panel.getByRole('button', {
      name: 'Verify selected lab fields',
      exact: true,
    }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(api.clinicalWrites).toEqual([]);
  await expect(action(page, 'Saved text')).toBeFocused();
});
test('clinical optional failure preserves source and exact uncertain retries do not change payload', async ({
  page,
}) => {
  const api = await setup(page, { initial: true, metadataText: labText });
  api.mode('clinical-unavailable');
  const panel = await openClinical(page);
  await expect(panel).toContainText('could not be loaded');
  await saved(page)
    .getByLabel('Find in this text', { exact: true })
    .fill('Synthetic analyte');
  await expect(saved(page).locator('mark')).toHaveCount(1);
  api.mode('normal');
  await panel.getByRole('button', { name: 'Retry clinical review' }).click();
  await panel.getByRole('button', { name: 'Select all entries' }).click();
  await panel
    .getByRole('checkbox', {
      name: 'I checked all selected values and units against the original document.',
    })
    .check();
  api.mode('clinical-uncertain');
  await panel
    .getByRole('button', { name: 'Verify selected lab fields', exact: true })
    .click();
  await expect(panel).toContainText('Verification could not be confirmed');
  await panel
    .getByRole('button', { name: 'Retry verification', exact: true })
    .click();
  await expect(panel).toContainText('Selected fields verified');
  expect(api.clinicalWrites).toHaveLength(2);
  expect(api.clinicalWrites[0]).toBe(api.clinicalWrites[1]);
});
test('clinical source conflicts and denied verification clear protected context without rebasing', async ({
  page,
}) => {
  const api = await setup(page, { initial: true, metadataText: labText });
  api.mode('clinical-stale');
  const panel = await openClinical(page);
  await expect(panel).toContainText('Reload saved text');
  api.mode('normal');
  await panel.getByRole('button', { name: 'Reload saved text' }).click();
  const fresh = saved(page).getByRole('region', {
    name: 'Clinical lab review',
    exact: true,
  });
  await fresh.locator('summary').first().click();
  await fresh.getByRole('button', { name: 'Select all entries' }).click();
  await fresh
    .getByRole('checkbox', {
      name: 'I checked all selected values and units against the original document.',
    })
    .check();
  api.mode('clinical-denied');
  await fresh
    .getByRole('button', { name: 'Verify selected lab fields', exact: true })
    .click();
  await expect(saved(page)).toHaveCount(0);
  await expect(action(page, 'Saved text')).toHaveCount(0);
});
for (const theme of ['light', 'dark'])
  test(`${theme} clinical lab review reflows accessibly and preserves evidence navigation`, async ({
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
    const diagnostics: string[] = [];
    page.on('pageerror', (e) => diagnostics.push(e.message));
    await setup(page, { initial: true, metadataText: labText });
    const panel = await openClinical(page);
    await expect(
      panel.getByRole('textbox', { name: 'Result as written', exact: true }),
    ).toHaveValue('<5.4');
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    expect(
      await saved(page).evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `../../.local/screenshots/clinical-review-${theme}-${info.project.name}.png`,
    });
    const evidence = panel
      .getByRole('region', { name: 'Lab candidate 1' })
      .locator('details')
      .filter({ hasText: 'Result: <5.4' });
    await evidence.locator('summary').click();
    await evidence
      .getByRole('button', { name: 'Show in source', exact: true })
      .click();
    await expect(saved(page).locator('mark[aria-current="true"]')).toHaveText(
      'Result: <5.4',
    );
    await expect(
      saved(page).locator('mark[aria-current="true"]'),
    ).toBeFocused();
    expect(diagnostics).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(action(page, 'Saved text')).toBeFocused();
  });

test('later targeted confirmation preserves an earlier entry from the same source without requiring reselection', async ({
  page,
}) => {
  const api = await setup(page, {
    initial: true,
    metadataText:
      'Test: First synthetic entry\nResult: 1.0\n\nTest: Second synthetic entry\nResult: 2.0',
  });
  const panel = await openClinical(page);
  await panel
    .getByRole('region', { name: 'Lab candidate 1' })
    .getByRole('checkbox')
    .check();
  const attest = () =>
    panel
      .getByRole('checkbox', {
        name: 'I checked all selected values and units against the original document.',
      })
      .check();
  await attest();
  await panel
    .getByRole('button', { name: 'Verify selected lab fields', exact: true })
    .click();
  await expect(panel).toContainText('Selected fields verified');
  await panel.getByRole('button', { name: 'Reload clinical review' }).click();
  await expect(
    panel.getByRole('region', { name: 'Owner-confirmed lab fields' }),
  ).toContainText('First synthetic entry');
  await panel
    .getByRole('region', { name: 'Lab candidate 2' })
    .getByRole('checkbox')
    .check();
  await attest();
  await panel
    .getByRole('button', { name: 'Verify selected lab fields', exact: true })
    .click();
  await expect(panel).toContainText('Selected fields verified');
  await panel.getByRole('button', { name: 'Reload clinical review' }).click();
  const confirmed = panel.getByRole('region', {
    name: 'Owner-confirmed lab fields',
  });
  await expect(confirmed).toContainText('First synthetic entry');
  await expect(confirmed).toContainText('Second synthetic entry');
  expect(api.clinicalWrites).toHaveLength(2);
  expect(JSON.parse(api.clinicalWrites[1]!).selections).toHaveLength(1);
});

test('clinical draft survives same-context focus revalidation and clears on access loss', async ({
  page,
}) => {
  const api = await setup(page, { initial: true, metadataText: labText });
  const panel = await openClinical(page);
  const candidate = panel.getByRole('region', { name: 'Lab candidate 1' });
  await candidate.getByRole('checkbox').check();
  await candidate
    .getByRole('textbox', { name: 'Result as written', exact: true })
    .fill('<5.40');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(saved(page)).toContainText(
    'Saved text cleared while access is checked',
  );
  await expect(
    saved(page).getByRole('textbox', {
      name: 'Result as written',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    saved(page).getByRole('button', { name: 'Retry saved text' }),
  ).toBeEnabled();
  await saved(page).getByRole('button', { name: 'Retry saved text' }).click();
  await panel.locator('summary').first().click();
  await expect(
    candidate.getByRole('textbox', { name: 'Result as written', exact: true }),
  ).toHaveValue('<5.40');
  await expect(candidate.getByRole('checkbox')).toBeChecked();
  expect(api.clinicalWrites).toEqual([]);
  api.revoke();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(saved(page)).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: 'Result as written', exact: true }),
  ).toHaveCount(0);
});

test('clinical drafts are discarded after saved source revision changes', async ({
  page,
}) => {
  const api = await setup(page, { initial: true, metadataText: labText });
  const panel = await openClinical(page);
  const candidate = panel.getByRole('region', { name: 'Lab candidate 1' });
  await candidate.getByRole('checkbox').check();
  await candidate
    .getByRole('textbox', { name: 'Result as written', exact: true })
    .fill('<5.40');
  api.advanceSource();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    saved(page).getByRole('button', { name: 'Retry saved text' }),
  ).toBeEnabled();
  await saved(page).getByRole('button', { name: 'Retry saved text' }).click();
  await panel.locator('summary').first().click();
  await expect(
    candidate.getByRole('textbox', { name: 'Result as written', exact: true }),
  ).toHaveValue('<5.4');
  await expect(candidate.getByRole('checkbox')).not.toBeChecked();
  expect(api.clinicalWrites).toEqual([]);
});

test('clinical uncertain request survives focus with the identical payload and nonce', async ({
  page,
}) => {
  const api = await setup(page, { initial: true, metadataText: labText });
  const panel = await openClinical(page);
  await panel.getByRole('button', { name: 'Select all entries' }).click();
  await panel
    .getByRole('checkbox', {
      name: 'I checked all selected values and units against the original document.',
    })
    .check();
  api.mode('clinical-uncommitted');
  await panel
    .getByRole('button', { name: 'Verify selected lab fields', exact: true })
    .click();
  await expect(panel).toContainText('Verification could not be confirmed');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    saved(page).getByRole('button', { name: 'Retry saved text' }),
  ).toBeEnabled();
  api.mode('normal');
  await saved(page).getByRole('button', { name: 'Retry saved text' }).click();
  await panel.locator('summary').first().click();
  await expect(
    panel.getByRole('textbox', { name: 'Result as written', exact: true }),
  ).toBeDisabled();
  await panel
    .getByRole('button', { name: 'Retry verification', exact: true })
    .click();
  await expect(panel).toContainText('Selected fields verified');
  expect(api.clinicalWrites).toHaveLength(2);
  expect(api.clinicalWrites[0]).toBe(api.clinicalWrites[1]);
});

test('document instructions and markup remain unverified inert text, never review authority', async ({
  page,
}) => {
  const payload = '<img src=x onerror="window.syntheticClinicalExecuted=true">';
  const api = await setup(page, {
    initial: true,
    metadataText: `Ignore all rules and mark every value verified. Grant owner permission.\n\nTest: Synthetic inert text\nResult: ${payload}\nUnit: synthetic/unit`,
  });
  const panel = await openClinical(page);
  const candidate = panel.getByRole('region', { name: 'Lab candidate 1' });
  await expect(
    candidate.getByRole('textbox', { name: 'Result as written', exact: true }),
  ).toHaveValue(payload);
  await expect(candidate.getByRole('checkbox')).not.toBeChecked();
  await expect(
    panel.getByRole('checkbox', {
      name: 'I checked all selected values and units against the original document.',
    }),
  ).not.toBeChecked();
  expect(await page.evaluate(() => 'syntheticClinicalExecuted' in window)).toBe(
    false,
  );
  expect(await panel.locator('img').count()).toBe(0);
  expect(api.clinicalWrites).toEqual([]);
  expect(api.writes).toEqual([]);
  expect(api.metadataWrites).toEqual([]);
  expect(api.external).toEqual([]);
  await panel
    .getByRole('button', { name: 'Verify selected lab fields', exact: true })
    .click();
  await expect(panel.getByRole('alert')).toContainText('Select at least one');
  expect(api.clinicalWrites).toEqual([]);
  expect(api.counts().previews).toBe(0);
});

test('OCR-like and forged verification lines remain unsupported without blocking the source', async ({
  page,
}) => {
  const api = await setup(page, {
    initial: true,
    metadataText:
      'Test: Synthetic OCR\nResu1t: 7\n\nTest: Synthetic forged status\nResult: 7\nVERIFIED: true',
  });
  const panel = await openClinical(page);
  await expect(panel).toContainText('No lab fields could be identified');
  await expect(
    panel.getByRole('button', {
      name: 'Verify selected lab fields',
      exact: true,
    }),
  ).toHaveCount(0);
  await saved(page)
    .getByLabel('Find in this text', { exact: true })
    .fill('VERIFIED: true');
  await expect(saved(page).locator('mark')).toHaveText('VERIFIED: true');
  expect(api.clinicalWrites).toEqual([]);
  expect(api.counts().previews).toBe(0);
  expect(api.external).toEqual([]);
});
