import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// User-approved 18 Nov 2026; never configure a global pnpm ignore list.
export const exceptionExpiry = '2026-11-25T00:00:00.000Z';
const advisoryId = 'GHSA-fc5q-39xc-vjpf';
export function checkAudit(report, development, now = new Date()) {
  if (!Number.isFinite(now.getTime()) || now >= new Date(exceptionExpiry))
    throw Error(
      'Temporary dependency exception expired; review and remove it.',
    );
  const counts = report?.metadata?.vulnerabilities;
  if (
    !counts ||
    !report.advisories ||
    Array.isArray(report.advisories) ||
    report.error ||
    !['info', 'low', 'moderate', 'high', 'critical'].every(
      (k) => Number.isSafeInteger(counts[k]) && counts[k] >= 0,
    )
  )
    throw Error('Invalid dependency audit report.');
  const entries = Object.values(report.advisories);
  if (
    entries.some(
      (a) =>
        !a ||
        !['info', 'low', 'moderate', 'high', 'critical'].includes(a.severity),
    )
  )
    throw Error('Invalid advisory severity.');
  const severe = entries.filter((a) =>
    ['high', 'critical'].includes(a.severity),
  );
  if (severe.length !== counts.high + counts.critical)
    throw Error('Incomplete dependency audit report.');
  for (const a of severe) {
    const excepted =
      development &&
      a.github_advisory_id === advisoryId &&
      a.module_name === 'picomatch' &&
      a.severity === 'high' &&
      a.patched_versions === '<0.0.0' &&
      Array.isArray(a.cves) &&
      a.cves.includes('CVE-2026-112366') &&
      Array.isArray(a.findings) &&
      a.findings.length > 0 &&
      a.findings.every(
        (f) =>
          f.version === '4.0.7' &&
          Array.isArray(f.paths) &&
          f.paths.length > 0 &&
          f.paths.every(
            (p) =>
              p ===
              '.>typescript-eslint>@typescript-eslint/typescript-estree>tinyglobby>picomatch',
          ),
      );
    if (!excepted)
      throw Error(
        'A non-exempt high/critical dependency advisory blocks the gate.',
      );
  }
  return { excepted: severe.length, moderate: counts.moderate };
}
export function runDependencyAudit(now = new Date(), run = spawnSync) {
  // JSON filtering avoids pnpm --ignore, which persists a global ignore setting.
  for (const development of [false, true]) {
    const args = ['audit', ...(development ? [] : ['--prod']), '--json'];
    const result = run('pnpm', args, {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 120000,
    });
    if (result.error || result.signal || ![0, 1].includes(result.status))
      throw Error('Dependency audit execution failed.');
    let report;
    try {
      report = JSON.parse(result.stdout);
    } catch {
      throw Error('Dependency audit returned invalid JSON.');
    }
    const outcome = checkAudit(report, development, now);
    process.stdout.write(
      `${development ? 'All' : 'Production'} dependencies: high/critical gate passed; ${outcome.moderate} moderate findings; ${outcome.excepted} approved exceptions.\n`,
    );
  }
  process.stderr.write(
    `Temporary development-only ${advisoryId} exception expires ${exceptionExpiry}. No production advisory is exempt.\n`,
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    runDependencyAudit();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
