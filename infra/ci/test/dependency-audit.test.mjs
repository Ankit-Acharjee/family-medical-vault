import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkAudit,
  runDependencyAudit,
  exceptionExpiry,
} from '../dependency-audit.mjs';
const now = new Date('2026-11-18T12:00:00Z');
const advisory = () => ({
  github_advisory_id: 'GHSA-fc5q-39xc-vjpf',
  module_name: 'picomatch',
  severity: 'high',
  patched_versions: '<0.0.0',
  cves: ['CVE-2026-112366'],
  findings: [
    {
      version: '4.0.7',
      paths: [
        '.>typescript-eslint>@typescript-eslint/typescript-estree>tinyglobby>picomatch',
      ],
    },
  ],
});
const report = (a) => ({
  advisories: a ? { 1: a } : {},
  metadata: {
    vulnerabilities: {
      info: 0,
      low: 0,
      moderate: 0,
      high: a?.severity === 'high' ? 1 : 0,
      critical: a?.severity === 'critical' ? 1 : 0,
    },
  },
});
test('only exact approved development advisory/version/path is accepted; production and other severe issues fail', () => {
  assert.equal(checkAudit(report(advisory()), true, now).excepted, 1);
  assert.throws(() => checkAudit(report(advisory()), false, now), /blocks/);
  for (const patch of [
    { github_advisory_id: 'GHSA-xxxx-yyyy-zzzz' },
    { severity: 'critical' },
    { module_name: 'other' },
    { patched_versions: '>=4.0.8' },
    { findings: [{ version: '4.0.8', paths: ['other'] }] },
    { findings: [] },
  ])
    assert.throws(() =>
      checkAudit(report({ ...advisory(), ...patch }), true, now),
    );
});
test('exception expires automatically; malformed or incomplete audit data fails closed', () => {
  for (const date of [new Date(exceptionExpiry), new Date('invalid')])
    assert.throws(() => checkAudit(report(), true, date), /expired/);
  for (const input of [
    {},
    { error: { message: 'registry down' } },
    { ...report(), advisories: { 1: advisory() } },
    { ...report(), advisories: [] },
  ])
    assert.throws(() => checkAudit(input, true, now));
});
test('production is audited first without mutating ignore options; full scan still runs', () => {
  const calls = [];
  runDependencyAudit(now, (_cmd, args) => {
    calls.push(args);
    return {
      status: calls.length === 1 ? 0 : 1,
      stdout: JSON.stringify(report(calls.length === 1 ? null : advisory())),
    };
  });
  assert.deepEqual(calls, [
    ['audit', '--prod', '--json'],
    ['audit', '--json'],
  ]);
});
test('process errors, invalid registry JSON and production vulnerabilities stop execution', () => {
  for (const result of [
    { error: Error('synthetic') },
    { status: null, signal: 'SIGTERM' },
    { status: 2 },
    { status: 0, stdout: 'invalid' },
    { status: 1, stdout: JSON.stringify({ error: {} }) },
    { status: 1, stdout: JSON.stringify(report(advisory())) },
  ]) {
    let calls = 0;
    assert.throws(() =>
      runDependencyAudit(now, () => {
        calls++;
        return result;
      }),
    );
    assert.equal(calls, 1);
  }
});
