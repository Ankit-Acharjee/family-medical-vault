import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { isWithdrawProcessingConsent } from '@fmv/contracts';

// AI-04 / SEC-07: the real App runs against fully intercepted synthetic APIs.
// A fixture policy is never a real approved provider; no transport is exposed.
const patient = {
  id: 'consent-patient',
  displayName: 'Consent Fixture Patient',
  relationship: 'self',
  capabilities: ['view', 'edit', 'manage', 'upload', 'export'].map(
    (action) => ({ action, scope: { kind: 'patient' } }),
  ),
};
const fileTitle = 'Synthetic consent source.png';
const record = {
  id: 'consent-source',
  patientId: patient.id,
  title: fileTitle,
  originalTitle: fileTitle,
  categoryId: 'general',
  categoryName: 'Unclassified',
  mimeType: 'image/png',
  bytes: 68,
  createdAt: '2026-11-13T00:00:00.000Z',
  canView: true,
  canEdit: true,
  canExport: true,
  canManageConsent: true,
};
const sha = 'a'.repeat(64);
const baseSnapshot = {
  revision: 3,
  action: 'grant' as const,
  sourceSha256: sha,
  sourceRevision: 0,
  lifecycleVersion: 0,
  providerId: 'synthetic-provider',
  policyVersion: 'synthetic-policy-v1',
  purpose: 'document-extraction' as const,
  dataCategories: ['original-document' as const],
  expiresAt: '2098-01-01T00:00:00.000Z',
  recordedAt: '2026-11-14T00:00:00.000Z',
};
const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Processing consent', exact: true });
const entry = (page: Page, title = fileTitle) =>
  page.getByRole('button', {
    name: `Processing consent ${title}`,
    exact: true,
  });
const preview = (page: Page) =>
  page.getByRole('button', { name: `Preview ${fileTitle}`, exact: true });
async function setup(
  page: Page,
  options: {
    empty?: boolean;
    expired?: boolean;
    invalidated?: boolean;
    withdrawn?: boolean;
    current?: boolean;
    owner?: boolean;
  } = {},
) {
  let doc = { ...record, canManageConsent: options.owner ?? true };
  let revision = options.empty ? 0 : 3;
  let snapshot: Record<string, unknown> | null = options.empty
    ? null
    : {
        ...baseSnapshot,
        ...(options.expired ? { expiresAt: '2026-11-14T01:00:00.000Z' } : {}),
        ...(options.withdrawn ? { action: 'withdrawal' } : {}),
      };
  let sourceRevision = options.invalidated ? 1 : 0,
    lifecycleVersion = options.invalidated ? 1 : 0;
  let mode = 'normal',
    reads = 0,
    previews = 0,
    extractionReads = 0;
  let pendingRead: Promise<void> | null = null,
    releaseRead: (() => void) | null = null;
  const writes: string[] = [],
    histories: number[] = [],
    external: string[] = [],
    unexpected: string[] = [],
    errors: string[] = [];
  const sets = new Map<number, Record<string, unknown>>();
  if (snapshot) {
    sets.set(1, { ...baseSnapshot, revision: 1 });
    sets.set(2, { ...baseSnapshot, revision: 2, action: 'withdrawal' });
    sets.set(3, snapshot);
  }
  let lastBody = '',
    uncertainUsed = false;
  const context = () => ({
    sourceSha256: sha,
    sourceRevision,
    lifecycleVersion,
    revision,
  });
  const value = () => ({
    context: context(),
    snapshot,
    policies: options.current
      ? [
          {
            providerId: baseSnapshot.providerId,
            policyVersion: baseSnapshot.policyVersion,
            purposes: ['document-extraction'],
            dataCategories: ['original-document'],
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
        ]
      : [],
    effective: !!(
      options.current &&
      snapshot?.action === 'grant' &&
      !options.expired &&
      !options.invalidated
    ),
    externalProcessingEnabled: false,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (
      /^https?:$/.test(url.protocol) &&
      !['127.0.0.1', 'localhost'].includes(url.hostname)
    ) {
      external.push(url.origin + url.pathname);
      return route.abort();
    }
    if (url.pathname.startsWith('/api/')) {
      unexpected.push(`${route.request().method()} ${url.pathname}`);
      return route.fulfill({ status: 404, json: {} });
    }
    return route.continue();
  });
  await page.route('**/api/auth/bootstrap', (route) =>
    route.fulfill({ json: { enabled: true, csrf: 'c'.repeat(43) } }),
  );
  await page.route('**/api/auth/account', (route) =>
    route.fulfill({
      json: { email: 'fixture@example.test', contextId: 'consent-session' },
    }),
  );
  await page.route('**/api/patients', (route) =>
    route.fulfill({ json: { patients: [patient] } }),
  );
  await page.route('**/api/patients/*/categories', (route) =>
    route.fulfill({ json: { categories: [] } }),
  );
  await page.route('**/api/patients/*/documents', (route) =>
    route.fulfill({ json: { documents: [doc], storageReady: true } }),
  );
  await page.route('**/api/patients/*/documents/search', (route) =>
    route.fulfill({ json: { documentIds: [], truncated: false } }),
  );
  await page.route('**/api/patients/*/documents/*/preview', (route) => {
    previews++;
    return route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1cAAAAASUVORK5CYII=',
        'base64',
      ),
    });
  });
  await page.route('**/api/patients/*/documents/*/extraction**', (route) => {
    extractionReads++;
    return route.fulfill({ status: 500, json: {} });
  });
  await page.route(
    '**/api/patients/*/documents/*/processing-consent',
    async (route) => {
      expect(route.request().method()).toBe('GET');
      reads++;
      const captured = structuredClone(value());
      if (mode === 'reordered-context') {
        const c = captured.context;
        captured.context = {
          revision: c.revision,
          lifecycleVersion: c.lifecycleVersion,
          sourceRevision: c.sourceRevision,
          sourceSha256: c.sourceSha256,
        };
      }
      if (pendingRead) await pendingRead;
      if (mode === 'read-denied')
        return route.fulfill({ status: 404, json: {} }).catch(() => {});
      if (mode === 'read-failed')
        return route.fulfill({ status: 503, json: {} }).catch(() => {});
      if (mode === 'malformed')
        return route
          .fulfill({ json: { ...captured, externalProcessingEnabled: true } })
          .catch(() => {});
      return route.fulfill({ json: captured }).catch(() => {});
    },
  );
  await page.route(
    '**/api/patients/*/documents/*/processing-consent/history?*',
    async (route) => {
      const before = Number(
        new URL(route.request().url()).searchParams.get('beforeRevision'),
      );
      histories.push(before);
      if (mode === 'history-failed')
        return route.fulfill({ status: 503, json: {} });
      if (mode === 'history-denied')
        return route.fulfill({ status: 404, json: {} });
      const found = [...sets.keys()]
        .filter((n) => n < before)
        .sort((a, b) => b - a)[0];
      return route.fulfill({
        json: {
          context: {
            ...context(),
            ...(mode === 'history-conflict' ? { revision: revision + 1 } : {}),
          },
          snapshot: found ? sets.get(found) : null,
          nextBefore:
            found && [...sets.keys()].some((n) => n < found) ? found : null,
        },
      });
    },
  );
  await page.route(
    '**/api/patients/*/documents/*/processing-consent/withdraw',
    async (route) => {
      const request = route.request(),
        body = request.postData()!;
      expect(request.method()).toBe('POST');
      expect(request.headers()['x-csrf-token']).toBe('c'.repeat(43));
      expect(isWithdrawProcessingConsent(JSON.parse(body))).toBe(true);
      writes.push(body);
      if (mode === 'write-denied')
        return route.fulfill({ status: 404, json: {} });
      if (mode === 'conflict') return route.fulfill({ status: 409, json: {} });
      if (mode === 'uncommitted' && !uncertainUsed) {
        uncertainUsed = true;
        return route.abort('failed');
      }
      if (body !== lastBody) {
        expect(JSON.parse(body).expectedRevision).toBe(revision);
        revision++;
        snapshot = {
          ...snapshot,
          revision,
          action: 'withdrawal',
          recordedAt: '2026-11-15T01:00:00.000Z',
        };
        sets.set(revision, snapshot);
        lastBody = body;
      }
      if (mode === 'committed' && !uncertainUsed) {
        uncertainUsed = true;
        return route.abort('failed');
      }
      return route.fulfill({ json: { saved: true, revision } });
    },
  );
  await page.goto('/#documents');
  await page
    .getByRole('button', { name: 'Select patient: No patient selected' })
    .click();
  await page
    .getByRole('button', { name: /Consent Fixture Patient \(Your profile\)/ })
    .click();
  await expect(preview(page)).toBeVisible();
  return {
    writes,
    histories,
    external,
    unexpected,
    errors,
    counts: () => ({ reads, previews, extractionReads }),
    mode: (next: string) => {
      mode = next;
    },
    hold: () => {
      pendingRead = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
    },
    release: () => {
      pendingRead = null;
      releaseRead?.();
    },
    advanceSource: () => {
      sourceRevision++;
      lifecycleVersion++;
    },
    changeDocument: () => {
      doc = {
        ...doc,
        id: 'other-consent-source',
        title: 'Other synthetic source.png',
        originalTitle: 'Other synthetic source.png',
      };
    },
  };
}
async function open(page: Page) {
  await entry(page).click();
  await expect(dialog(page)).toContainText('External processing is disabled.');
}
async function withdraw(page: Page) {
  await dialog(page)
    .getByRole('button', { name: 'Withdraw consent', exact: true })
    .click();
  await expect(
    dialog(page).getByRole('button', {
      name: 'Confirm withdrawal',
      exact: true,
    }),
  ).toBeEnabled();
  await dialog(page)
    .getByRole('button', { name: 'Confirm withdrawal', exact: true })
    .click();
}
function clean(api: Awaited<ReturnType<typeof setup>>) {
  expect(api.external).toEqual([]);
  expect(api.unexpected).toEqual([]);
  expect(api.errors).toEqual([]);
}

test('original-only consent is directly available without saved extraction and never enables external processing', async ({
  page,
}) => {
  const api = await setup(page);
  await open(page);
  await expect(dialog(page)).toContainText('Consent Fixture Patient');
  await expect(dialog(page)).toContainText(fileTitle);
  await expect(dialog(page)).toContainText(
    'No approved provider is available. New consent cannot be granted.',
  );
  await expect(
    dialog(page).getByRole('button', {
      name: /grant|enable|submit|process now/i,
    }),
  ).toHaveCount(0);
  expect(api.counts().extractionReads).toBe(0);
  expect(api.counts().previews).toBe(0);
  expect(api.writes).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(entry(page)).toBeFocused();
  clean(api);
});
test('delegated all-action grants do not expose owner-only consent controls', async ({
  page,
}) => {
  const api = await setup(page, { owner: false });
  await expect(entry(page)).toHaveCount(0);
  expect(api.counts().reads).toBe(0);
  await expect(preview(page)).toBeEnabled();
  clean(api);
});
test('empty and withdrawn consent states remain read-only and truthful', async ({
  page,
}) => {
  const api = await setup(page, { empty: true });
  await open(page);
  await expect(dialog(page)).toContainText('No consent recorded');
  await expect(
    dialog(page).getByRole('button', { name: 'Withdraw consent', exact: true }),
  ).toHaveCount(0);
  expect(api.writes).toEqual([]);
  clean(api);
});
for (const state of ['expired', 'invalidated'] as const)
  test(`${state} consent can be explicitly withdrawn while preserving history`, async ({
    page,
  }) => {
    const api = await setup(page, { [state]: true });
    await open(page);
    await expect(dialog(page)).toContainText(
      state === 'expired' ? 'Expired' : 'Invalidated',
    );
    await withdraw(page);
    await expect(dialog(page)).toContainText('Withdrawn');
    expect(api.writes).toHaveLength(1);
    await expect(
      dialog(page).getByRole('button', {
        name: 'Withdraw consent',
        exact: true,
      }),
    ).toHaveCount(0);
    await dialog(page)
      .getByRole('button', { name: 'Load earlier consent', exact: true })
      .click();
    expect(api.histories).toEqual([4]);
    clean(api);
  });
test('owner status and paged history preserve evidence without granting or changing consent', async ({
  page,
}) => {
  const api = await setup(page, { current: true });
  await open(page);
  await expect(dialog(page)).toContainText('Current');
  await expect(dialog(page)).toContainText('External processing is disabled.');
  await dialog(page)
    .getByRole('button', { name: 'Load earlier consent', exact: true })
    .click();
  await expect(dialog(page)).toContainText('Withdrawal recorded');
  await dialog(page)
    .getByRole('button', { name: 'Load earlier consent', exact: true })
    .click();
  expect(api.histories).toEqual([3, 2]);
  expect(api.writes).toEqual([]);
  clean(api);
});
for (const mode of ['committed', 'uncommitted'])
  test(`${mode} withdrawal retries only the exact captured request`, async ({
    page,
  }) => {
    const api = await setup(page);
    await open(page);
    api.mode(mode);
    await withdraw(page);
    await expect(
      dialog(page).getByRole('button', {
        name: 'Retry withdrawal',
        exact: true,
      }),
    ).toBeEnabled();
    if (mode === 'uncommitted') {
      const reads = api.counts().reads;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect.poll(() => api.counts().reads).toBeGreaterThan(reads);
      await expect(
        dialog(page).getByRole('button', {
          name: 'Retry withdrawal',
          exact: true,
        }),
      ).toBeEnabled();
    }
    api.mode('normal');
    await dialog(page)
      .getByRole('button', { name: 'Retry withdrawal', exact: true })
      .click();
    await expect(dialog(page)).toContainText('Withdrawn');
    expect(api.writes).toHaveLength(2);
    expect(api.writes[0]).toBe(api.writes[1]);
    clean(api);
  });
test('withdrawal conflicts require explicit reload and never resubmit automatically', async ({
  page,
}) => {
  const api = await setup(page);
  await open(page);
  api.mode('conflict');
  await withdraw(page);
  await expect(
    dialog(page).getByRole('button', { name: 'Reload consent', exact: true }),
  ).toBeVisible();
  expect(api.writes).toHaveLength(1);
  api.mode('normal');
  await dialog(page)
    .getByRole('button', { name: 'Reload consent', exact: true })
    .click();
  await expect(
    dialog(page).getByRole('button', { name: 'Withdraw consent', exact: true }),
  ).toBeEnabled();
  expect(api.writes).toHaveLength(1);
  await withdraw(page);
  await expect(dialog(page)).toContainText('Withdrawn');
  expect(api.writes).toHaveLength(2);
  expect(api.writes[0]).not.toBe(api.writes[1]);
  clean(api);
});
for (const mode of ['read-denied', 'write-denied'])
  test(`${mode} clears consent metadata while preserving original View access`, async ({
    page,
  }) => {
    const api = await setup(page);
    if (mode === 'read-denied') api.mode(mode);
    await entry(page).click();
    if (mode === 'write-denied') {
      await expect(dialog(page)).toContainText(
        'External processing is disabled.',
      );
      api.mode(mode);
      await withdraw(page);
    }
    await expect(dialog(page)).not.toContainText(baseSnapshot.providerId);
    await page.keyboard.press('Escape');
    await expect(preview(page)).toBeEnabled();
    await preview(page).click();
    await expect(
      page.getByRole('dialog', { name: 'Document preview', exact: true }),
    ).toBeVisible();
    expect(api.counts().previews).toBe(1);
    clean(api);
  });
test('malformed claimed processing activation fails closed and recovery remains explicit', async ({
  page,
}) => {
  const api = await setup(page);
  api.mode('malformed');
  await entry(page).click();
  await expect(
    dialog(page).getByRole('button', { name: 'Retry consent', exact: true }),
  ).toBeVisible();
  await expect(dialog(page)).not.toContainText(baseSnapshot.providerId);
  api.mode('normal');
  await dialog(page)
    .getByRole('button', { name: 'Retry consent', exact: true })
    .click();
  await expect(
    dialog(page).getByRole('button', { name: 'Withdraw consent', exact: true }),
  ).toBeEnabled();
  expect(api.writes).toEqual([]);
  clean(api);
});
test('history failure recovers independently without mutating the current consent', async ({
  page,
}) => {
  const api = await setup(page);
  await open(page);
  api.mode('history-failed');
  await dialog(page)
    .getByRole('button', { name: 'Load earlier consent', exact: true })
    .click();
  await expect(
    dialog(page).getByRole('button', {
      name: 'Retry consent history',
      exact: true,
    }),
  ).toBeEnabled();
  api.mode('normal');
  await dialog(page)
    .getByRole('button', { name: 'Retry consent history', exact: true })
    .click();
  await expect(dialog(page)).toContainText('Withdrawal recorded');
  expect(api.writes).toEqual([]);
  clean(api);
});
test('focus and visibility revalidation refresh exact context without changing consent', async ({
  page,
}) => {
  const api = await setup(page);
  await open(page);
  const reads = api.counts().reads;
  api.advanceSource();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => api.counts().reads).toBeGreaterThan(reads);
  await expect(dialog(page)).toContainText('Invalidated');
  const next = api.counts().reads;
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  );
  await expect.poll(() => api.counts().reads).toBeGreaterThan(next);
  expect(api.writes).toEqual([]);
  clean(api);
});
test('changed document identity aborts a late consent read and never displays its metadata', async ({
  page,
}) => {
  const api = await setup(page);
  api.hold();
  await entry(page).click();
  await expect(dialog(page)).toBeVisible();
  api.changeDocument();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog(page)).toHaveCount(0);
  api.release();
  await expect(
    page.getByText(baseSnapshot.providerId, { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: 'Processing consent Other synthetic source.png',
      exact: true,
    }),
  ).toBeVisible();
  clean(api);
});
for (const theme of ['light', 'dark'])
  test(`${theme} consent status reflows with accessible keyboard controls and reduced motion`, async ({
    page,
  }, info) => {
    await page.setViewportSize({
      width: info.project.name === 'mobile' ? 320 : 1440,
      height: 1000,
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(
      (value) => localStorage.setItem('fmv.theme', value),
      theme,
    );
    const api = await setup(page);
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await dialog(page)
      .getByRole('button', { name: 'Withdraw consent', exact: true })
      .focus();
    await expect(
      dialog(page).getByRole('button', {
        name: 'Withdraw consent',
        exact: true,
      }),
    ).toBeFocused();
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    expect(
      await dialog(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await dialog(page)
      .getByRole('heading', { name: 'Processing consent', exact: true })
      .focus();
    await dialog(page).evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({
      path: `../../.local/screenshots/processing-consent-${theme}-${info.project.name}.png`,
    });
    await page.keyboard.press('Escape');
    await expect(entry(page)).toBeFocused();
    if (info.project.name === 'mobile') {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page);
      expect(
        await dialog(page).evaluate(
          (el) => el.scrollWidth <= el.clientWidth + 1,
        ),
      ).toBe(true);
    }
    expect(api.writes).toEqual([]);
    clean(api);
  });

test('uncertain withdrawal context change requires a fresh explicit intent', async ({
  page,
}) => {
  const api = await setup(page);
  await open(page);
  api.mode('uncommitted');
  await withdraw(page);
  await expect(
    dialog(page).getByRole('button', { name: 'Retry withdrawal', exact: true }),
  ).toBeEnabled();
  api.advanceSource();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    dialog(page).getByRole('button', { name: 'Reload consent', exact: true }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole('button', { name: 'Retry withdrawal', exact: true }),
  ).toHaveCount(0);
  expect(api.writes).toHaveLength(1);
  api.mode('normal');
  await dialog(page)
    .getByRole('button', { name: 'Reload consent', exact: true })
    .click();
  await withdraw(page);
  await expect(dialog(page)).toContainText('Consent withdrawn.');
  expect(api.writes).toHaveLength(2);
  expect(JSON.parse(api.writes[1]!).requestId).not.toBe(
    JSON.parse(api.writes[0]!).requestId,
  );
  clean(api);
});
test('server effectiveness takes precedence over an incorrect client clock', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Date.now = () => Date.parse('2100-01-01T00:00:00.000Z');
  });
  const api = await setup(page, { current: true });
  await open(page);
  await expect(
    dialog(page).getByRole('region', { name: 'Current consent' }),
  ).toContainText('Current');
  await expect(dialog(page)).not.toContainText('Expired');
  expect(api.writes).toEqual([]);
  clean(api);
});
test('history denial clears consent evidence without revoking original access', async ({
  page,
}) => {
  const api = await setup(page);
  await open(page);
  api.mode('history-denied');
  await dialog(page)
    .getByRole('button', { name: 'Load earlier consent', exact: true })
    .click();
  await expect(dialog(page)).not.toContainText(baseSnapshot.providerId);
  await expect(dialog(page)).toContainText(
    'unavailable for your current access',
  );
  await page.keyboard.press('Escape');
  await expect(preview(page)).toBeEnabled();
  expect(api.writes).toEqual([]);
  clean(api);
});
