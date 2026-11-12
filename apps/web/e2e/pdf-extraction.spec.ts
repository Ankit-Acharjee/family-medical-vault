import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// AI-01/05/06: real browser worker + synthetic originals; no provider/user data.
// A proper xref table makes fixtures exercise parsing rather than error recovery.
function pdf(pages: string[], encrypted = false, fontSize = 12) {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const text of pages) {
    const escaped = text.replace(/[\\()]/g, '\\$&');
    const stream = text
      ? `BT /F1 ${fontSize} Tf 36 720 Td (${escaped}) Tj ET`
      : '';
    const contentId = objects.length + 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  }
  // A synthetic Standard security dictionary exercises the password gate only;
  // no decrypted content is expected or claimed by this fixture.
  if (encrypted)
    objects.push(
      `<< /Filter /Standard /V 1 /R 2 /P -4 /O <${'01'.repeat(32)}> /U <${'02'.repeat(32)}> >>`,
    );
  const security = encrypted
    ? ` /Encrypt ${objects.length} 0 R /ID [<${'03'.repeat(16)}> <${'03'.repeat(16)}>]`
    : '';
  let value = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(value));
    value += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(value);
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  value += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  value += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${security} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(value);
}

const patient = {
  id: 'a',
  displayName: 'Extraction Patient',
  relationship: 'self',
  capabilities: ['view', 'export', 'edit'].map((action) => ({
    action,
    scope: { kind: 'patient' },
  })),
};
const other = { ...patient, id: 'b', displayName: 'Other Patient' };
const document = {
  id: 'synthetic-pdf',
  patientId: 'a',
  title: 'Synthetic source.pdf',
  originalTitle: 'synthetic-source.pdf',
  categoryId: 'general',
  categoryName: 'Unclassified',
  createdAt: '2026-11-12T12:00:00Z',
  canEdit: true,
  canView: true,
  canExport: true,
  bytes: 500,
  mimeType: 'application/pdf',
};
const extract = (page: Page) =>
  page.getByRole('button', {
    name: `Extract text ${document.title}`,
    exact: true,
  });
const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Extracted text', exact: true });
async function setup(
  page: Page,
  source = pdf(['Synthetic first page', 'Synthetic second page']),
  options: { canView?: boolean; bytes?: number; mimeType?: string } = {},
) {
  let records = [
    { ...document, ...options, bytes: options.bytes ?? source.length },
  ];
  let patients = [patient, other];
  let previewStatus = 200;
  let patientGate: Promise<void> | undefined;
  let releasePatients: (() => void) | undefined;
  let gate: Promise<void> | undefined;
  let release: (() => void) | undefined;
  const reads: string[] = [];
  const logs: string[] = [];
  const external: string[] = [];
  page.on('console', (message) => logs.push(message.text()));
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:/.test(url) && new URL(url).hostname !== '127.0.0.1')
      external.push(url);
  });
  await page.route('**/api/auth/bootstrap', (route) =>
    route.fulfill({ json: { enabled: true, csrf: 'c'.repeat(43) } }),
  );
  await page.route('**/api/auth/account', (route) =>
    route.fulfill({
      json: { email: 'fixture@example.test', contextId: 'pdf-test-session' },
    }),
  );
  await page.route('**/api/patients', async (route) => {
    if (patientGate) await patientGate;
    await route.fulfill({ json: { patients } }).catch(() => {});
  });
  await page.route('**/api/patients/*/categories', (route) =>
    route.fulfill({ json: { categories: [] } }),
  );
  await page.route('**/api/patients/*/documents', (route) =>
    route.fulfill({
      json: {
        documents: route.request().url().includes('/a/') ? records : [],
        storageReady: true,
      },
    }),
  );
  await page.route('**/api/patients/*/documents/*/preview', async (route) => {
    reads.push(route.request().url());
    if (gate) await gate;
    await route
      .fulfill({
        status: previewStatus,
        body: source,
        contentType: 'application/pdf',
      })
      .catch(() => {});
  });
  await page.goto('/#documents');
  await page.getByRole('button', { name: /Select patient:/ }).click();
  await page
    .getByRole('button', { name: `${patient.displayName} (Your profile)` })
    .click();
  await expect(
    page.getByRole('button', { name: 'Active documents', exact: true }),
  ).toBeVisible();
  return {
    reads,
    logs,
    external,
    holdPatients: () => {
      patientGate = new Promise<void>((resolve) => {
        releasePatients = resolve;
      });
    },
    releasePatients: () => {
      patientGate = undefined;
      releasePatients?.();
    },
    hold: () => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release: () => {
      gate = undefined;
      release?.();
    },
    denySource: () => {
      previewStatus = 403;
    },
    sourceStatus: (status: number) => {
      previewStatus = status;
    },
    revoke: () => {
      records = records.map((record) => ({ ...record, canView: false }));
    },
    removePatient: () => {
      patients = [other];
    },
  };
}

test('on-demand local extraction preserves page/source context, plain text, and focus', async ({
  page,
}) => {
  const api = await setup(
    page,
    pdf([
      'Synthetic first page <script>alert(1)</script>',
      'Synthetic second page',
    ]),
  );
  expect(api.reads).toHaveLength(0);
  await extract(page).focus();
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText(document.title);
  await expect(
    dialog(page).getByRole('heading', { name: 'Page 1', exact: true }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole('heading', { name: 'Page 2', exact: true }),
  ).toBeVisible();
  await expect(dialog(page)).toContainText(
    'Synthetic first page <script>alert(1)</script>',
  );
  await expect(dialog(page)).toContainText('Synthetic second page');
  await expect(dialog(page)).toContainText(/unverified|untrusted/i);
  await expect(dialog(page).locator('script')).toHaveCount(0);
  expect(api.reads.length).toBeGreaterThanOrEqual(1);
  expect(api.external).toEqual([]);
  expect(api.logs.join('\n')).not.toContain('Synthetic first page');
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toContain('Synthetic first page');
  await dialog(page)
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(extract(page)).toBeFocused();
  await expect(
    page.getByRole('button', {
      name: `Preview ${document.title}`,
      exact: true,
    }),
  ).toBeEnabled();
});

for (const [name, source] of [
  ['no embedded text', pdf([''])],
  ['malformed original', Buffer.from('%PDF-1.4\nnot a PDF document')],
] as const) {
  test(`${name} reports extraction unavailable without disabling original actions`, async ({
    page,
  }) => {
    await setup(page, source);
    await extract(page).click();
    await expect(dialog(page)).toContainText(
      /no.*text|unavailable|could not|unable|unsupported/i,
    );
    await dialog(page)
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: `Preview ${document.title}`,
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      page.getByRole('button', {
        name: `Download ${document.title}`,
        exact: true,
      }),
    ).toBeEnabled();
  });
}

test('export-only rows cannot initiate text extraction', async ({ page }) => {
  const api = await setup(page, pdf(['Not readable']), { canView: false });
  await expect(
    page.getByRole('button', {
      name: `Download ${document.title}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(extract(page)).toHaveCount(0);
  expect(api.reads).toEqual([]);
});

test('current VIEW denial does not publish original text', async ({ page }) => {
  const api = await setup(page);
  api.denySource();
  await extract(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByText(
      'Document access is no longer available. Refresh and try again.',
    ),
  ).toBeVisible();
  await expect(
    page.getByText('Synthetic first page', { exact: true }),
  ).toHaveCount(0);
});

test('closing pending extraction cancels and ignores a late original response', async ({
  page,
}) => {
  const api = await setup(page);
  api.hold();
  await extract(page).click();
  await expect.poll(() => api.reads.length).toBeGreaterThanOrEqual(1);
  await dialog(page)
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  api.release();
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByText('Synthetic first page', { exact: true }),
  ).toHaveCount(0);
  await expect(extract(page)).toBeFocused();
});

test('revoked VIEW on revalidation clears extracted text and prevents reopening', async ({
  page,
}) => {
  const api = await setup(page);
  await extract(page).click();
  await expect(dialog(page)).toContainText('Synthetic first page');
  api.revoke();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page)).toHaveCount(0);
  await expect(extract(page)).toHaveCount(0);
  await expect(
    page.getByText('Synthetic first page', { exact: true }),
  ).toHaveCount(0);
});

for (const theme of ['light', 'dark']) {
  test(`${theme} extracted text reflows accessibly at narrow width`, async ({
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
    await setup(page);
    await extract(page).click();
    await expect(dialog(page)).toContainText('Synthetic first page');
    expect(
      await page.evaluate(
        () => window.document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const bounds = await dialog(page).boundingBox();
    expect(bounds?.width).toBeLessThanOrEqual(
      testInfo.project.name === 'mobile' ? 320 : 1440,
    );
    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(results.violations).toEqual([]);
    if (process.env['PDF_CAPTURE'] === '1') {
      await page.screenshot({
        path: `../../.local/screenshots/pdf-text-${theme}-${testInfo.project.name}.png`,
        fullPage: false,
      });
    }
  });
}

test('image originals retain native actions without a PDF text action', async ({
  page,
}) => {
  const api = await setup(page, Buffer.from('synthetic image'), {
    mimeType: 'image/png',
  });
  await expect(
    page.getByRole('button', {
      name: `Preview ${document.title}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(extract(page)).toHaveCount(0);
  expect(api.reads).toEqual([]);
});

test('page limit is explicit and never claims a 51-page document is complete', async ({
  page,
}) => {
  await setup(
    page,
    pdf(Array.from({ length: 51 }, (_, i) => `Synthetic page ${i + 1}`)),
  );
  await extract(page).click();
  await expect(dialog(page)).toContainText(/partial|50.page|50 page|limit/i);
  await expect(dialog(page)).not.toContainText('Synthetic page 51');
});

test('patient removal during pending extraction prevents late result publication', async ({
  page,
}) => {
  const api = await setup(page);
  api.hold();
  await extract(page).click();
  await expect.poll(() => api.reads.length).toBeGreaterThanOrEqual(1);
  api.removePatient();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page)).toHaveCount(0);
  api.release();
  await expect(
    page.getByText('Synthetic first page', { exact: true }),
  ).toHaveCount(0);
  await expect(extract(page)).toHaveCount(0);
});

test('password-protected PDF stops at the password gate without soliciting a password', async ({
  page,
}) => {
  await setup(page, pdf(['Synthetic protected source'], true));
  await extract(page).click();
  await expect(dialog(page)).toContainText(/encrypted|password/i);
  await expect(dialog(page).locator('input[type="password"]')).toHaveCount(0);
  await expect(dialog(page)).not.toContainText('Synthetic protected source');
});

test('transient source failure retries explicitly without changing original actions', async ({
  page,
}) => {
  const api = await setup(page);
  api.sourceStatus(503);
  await extract(page).click();
  await expect(dialog(page)).toContainText(/failed/i);
  api.sourceStatus(200);
  await dialog(page)
    .getByRole('button', { name: 'Retry extraction', exact: true })
    .click();
  await expect(dialog(page)).toContainText('Synthetic first page');
});

test('metadata byte limit refuses extraction without fetching an oversized original', async ({
  page,
}) => {
  const api = await setup(page, pdf(['Oversized source']), {
    bytes: 10 * 1024 * 1024 + 1,
  });
  await extract(page).click();
  await expect(dialog(page)).toContainText(/size limit/i);
  expect(api.reads).toEqual([]);
});

test('actual byte limit also rejects an original with misleading size metadata', async ({
  page,
}) => {
  await setup(page, Buffer.alloc(10 * 1024 * 1024 + 1, 32), { bytes: 100 });
  await extract(page).click();
  await expect(dialog(page)).toContainText(/size limit/i);
});

test('processing deadline exposes retry and cannot publish a late source', async ({
  page,
}) => {
  const api = await setup(page);
  await page.clock.install();
  api.hold();
  await extract(page).click();
  await expect.poll(() => api.reads.length).toBeGreaterThanOrEqual(1);
  await page.clock.fastForward(20_001);
  await expect(dialog(page)).toContainText(/timed out/i);
  api.release();
  await expect(dialog(page)).not.toContainText('Synthetic first page');
  await expect(
    dialog(page).getByRole('button', { name: 'Retry extraction', exact: true }),
  ).toBeVisible();
});

test('stalled lazy parser import times out and ignores its late module response', async ({
  page,
}) => {
  const api = await setup(page);
  let moduleRequests = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    /\/(?:src\/features\/documents\/pdfText\.ts|assets\/pdfText-[^/]+\.js)(?:\?.*)?$/,
    async (route) => {
      moduleRequests++;
      await gate;
      await route.continue().catch(() => {});
    },
  );
  await page.clock.install();
  await extract(page).click();
  await expect.poll(() => moduleRequests).toBeGreaterThanOrEqual(1);
  await page.clock.fastForward(20_001);
  await expect(dialog(page)).toContainText(/timed out/i);
  release?.();
  await expect(dialog(page)).not.toContainText('Synthetic first page');
  expect(api.reads.length).toBeGreaterThanOrEqual(1);
});

test('closing while patient access revalidates restores focus after the list is usable', async ({
  page,
}) => {
  const api = await setup(page);
  await extract(page).click();
  await expect(dialog(page)).toContainText('Synthetic first page');
  api.holdPatients();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page)).toContainText(/access is checked/i);
  await dialog(page)
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  api.releasePatients();
  await expect(extract(page)).toBeEnabled();
  await expect(extract(page)).toBeFocused();
});

test('character cap labels partial extraction and bounds rendered source text', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await setup(
    page,
    pdf(
      Array.from({ length: 50 }, () => 'X'.repeat(11_000)),
      false,
      0.05,
    ),
  );
  await extract(page).click();
  await expect(dialog(page)).toContainText(/character cap/i, {
    timeout: 25_000,
  });
  const lengths = await dialog(page)
    .locator('h3 + p')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.length ?? 0));
  const length = lengths.reduce((total, count) => total + count, 0);
  expect(length).toBeGreaterThan(499_000);
  expect(length).toBeLessThanOrEqual(500_000);
  await expect(dialog(page)).toContainText(/not the complete document/i);
});

for (const action of ['cancel', 'timeout'] as const) {
  test(`stalled worker initialization supports ${action} and a fresh extraction`, async ({
    page,
  }) => {
    await setup(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.name));
    let workerRequests = 0;
    let hold = true;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/pdf\.worker[^/]*\.mjs(?:\?.*)?$/, async (route) => {
      workerRequests++;
      if (hold) await gate;
      await route.continue().catch(() => {});
    });
    if (action === 'timeout') await page.clock.install();
    await extract(page).click();
    await expect.poll(() => workerRequests).toBeGreaterThanOrEqual(1);
    if (action === 'cancel') {
      await dialog(page)
        .getByRole('button', { name: 'Cancel extraction', exact: true })
        .click();
      await expect(dialog(page)).toHaveCount(0);
    } else {
      await page.clock.fastForward(20_001);
      await expect(dialog(page)).toContainText(/timed out/i);
    }
    hold = false;
    release?.();
    if (action === 'timeout') {
      await dialog(page)
        .getByRole('button', { name: 'Retry extraction', exact: true })
        .click();
    } else {
      await extract(page).click();
    }
    await expect(dialog(page)).toContainText('Synthetic first page');
    expect(errors).toEqual([]);
  });
}
