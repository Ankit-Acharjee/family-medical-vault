// Synthetic fixture only: called from the disposable native recovery drill.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import { withTool } from '../ci/tools.mjs';
import {
  encodeRestoreEvidence,
  planRestoreReconciliation,
} from '../backup/restore-evidence.mjs';
import { PrismaAccessStore } from '../../apps/server/dist/access/access.store.js';
import { PermissionService } from '../../apps/server/dist/access/permission.service.js';
import { PrismaDocumentStore } from '../../apps/server/dist/documents/document.store.js';
const hash = (value) => createHash('sha256').update(value).digest('hex');
export async function prepareSyntheticEvidenceFixture(source, originalBytes) {
  const document = (
    await source.query(
      `SELECT d.id,d.patient_id AS "patientId",p.owner_account_id AS "ownerId",a.issuer,a.subject FROM fmv.documents d JOIN fmv.persons p ON p.id=d.patient_id JOIN fmv.app_accounts a ON a.id=p.owner_account_id WHERE d.sha256=$1 AND d.state='ready' AND d.deleted_at IS NULL LIMIT 1`,
      [hash(originalBytes)],
    )
  ).rows[0];
  assert.ok(document);
  const account = randomUUID(),
    grantId = randomUUID();
  const principal = {
    issuer: 'https://recovery.example.test',
    subject: randomUUID(),
  };
  await source.query(
    'INSERT INTO fmv.app_accounts(id,issuer,subject) VALUES($1,$2,$3)',
    [account, principal.issuer, principal.subject],
  );
  await source.query(
    "INSERT INTO fmv.access_grants(id,patient_id,grantee_account_id,issuer_account_id,actions,scope_kind) VALUES($1,$2,$3,$4,ARRAY['view'],'patient')",
    [grantId, document.patientId, account, document.ownerId],
  );
  return {
    documentId: document.id,
    patientId: document.patientId,
    owner: { issuer: document.issuer, subject: document.subject },
    principal,
    grantId,
    ledgerId: randomUUID().replaceAll('-', ''),
  };
}

export async function verifySyntheticEvidenceReconciliation({
  source,
  restored,
  port,
  appPassword,
  fixture,
}) {
  const url = new URL('postgresql://127.0.0.1');
  url.username = 'fmv_app';
  url.password = appPassword;
  url.port = String(port);
  url.pathname = '/fmv_restore_test';
  url.searchParams.set('schema', 'fmv');
  const access = new PrismaAccessStore(url.href),
    documents = new PrismaDocumentStore(url.href);
  const permissions = new PermissionService(access);
  try {
    await permissions.require(fixture.principal, fixture.patientId, 'view');
    assert.ok(
      (await documents.list(fixture.patientId)).some(
        (d) => d.documentId === fixture.documentId,
      ),
    );
    const occurredAt = Date.now();
    await source.query(
      'UPDATE fmv.access_grants SET revoked_at=$2 WHERE id=$1',
      [fixture.grantId, new Date(occurredAt)],
    );
    await source.query('UPDATE fmv.documents SET deleted_at=$2 WHERE id=$1', [
      fixture.documentId,
      new Date(occurredAt),
    ]);
    const lifecycle = (
      await source.query(
        'SELECT extraction_lifecycle AS version FROM fmv.documents WHERE id=$1',
        [fixture.documentId],
      )
    ).rows[0].version;
    // The stale restore still grants access and contains the now-trashed document.
    await permissions.require(fixture.principal, fixture.patientId, 'view');
    const evidence = encodeRestoreEvidence({
      format: 'fmv-restore-evidence-v1',
      ledgerId: fixture.ledgerId,
      afterSequence: 0,
      throughSequence: 2,
      events: [
        {
          sequence: 1,
          eventId: randomUUID(),
          patientId: fixture.patientId,
          resourceId: fixture.grantId,
          kind: 'grant.revoked',
          lifecycle: null,
          occurredAt,
        },
        {
          sequence: 2,
          eventId: randomUUID(),
          patientId: fixture.patientId,
          resourceId: fixture.documentId,
          kind: 'document.trashed',
          lifecycle,
          occurredAt,
        },
      ],
    });
    // In-memory stand-ins for separately authenticated anchors. Not hosted durability.
    const snapshotAnchor = { ledgerId: fixture.ledgerId, sequence: 0 };
    const trustedHead = {
      ledgerId: fixture.ledgerId,
      afterSequence: 0,
      throughSequence: 2,
      evidenceSha256: hash(evidence),
    };
    const recoveredEvidence = await withTool('age', async (age) => {
      const directory = path.dirname(age),
        identity = path.join(directory, 'synthetic-ledger-identity');
      const run = (binary, args) => {
        const r = spawnSync(binary, args, {
          encoding: 'utf8',
          timeout: 15000,
          maxBuffer: 65536,
          env: { PATH: '/usr/bin:/bin', TMPDIR: directory },
        });
        assert.ok(
          !r.error && r.status === 0,
          'Synthetic evidence encryption must succeed (output suppressed)',
        );
        return r.stdout.trim();
      };
      const keygen = path.join(directory, 'age-keygen');
      run(keygen, ['-o', identity]);
      const recipient = run(keygen, ['-y', identity]);
      const plaintext = path.join(directory, 'evidence.json'),
        encrypted = path.join(directory, 'evidence.age');
      await writeFile(plaintext, evidence, { flag: 'wx', mode: 0o600 });
      run(age, ['-r', recipient, '-o', encrypted, plaintext]);
      await rm(plaintext);
      run(age, ['-d', '-i', identity, '-o', plaintext, encrypted]);
      return readFile(plaintext);
    });
    const args = {
      evidence: recoveredEvidence,
      snapshotAnchor,
      trustedHead,
      now: Date.now(),
    };
    const plan = planRestoreReconciliation(args);
    assert.equal(plan.automaticReopenAllowed, false);
    assert.equal(plan.automaticLedgerDeletionAllowed, false);
    assert.throws(() =>
      planRestoreReconciliation({
        ...args,
        trustedHead: { ...trustedHead, throughSequence: 3 },
      }),
    );
    const apply = async (candidate) => {
      await restored.query('BEGIN');
      try {
        for (const grant of candidate.revokedGrants) {
          const row = (
            await restored.query(
              'SELECT revoked_at FROM fmv.access_grants WHERE id=$1 AND patient_id=$2 FOR UPDATE',
              [grant.resourceId, grant.patientId],
            )
          ).rows[0];
          assert.ok(row, 'Evidence resource must match the restored patient');
          if (row.revoked_at === null)
            await restored.query(
              'UPDATE fmv.access_grants SET revoked_at=$2 WHERE id=$1',
              [grant.resourceId, new Date(grant.occurredAt)],
            );
        }
        for (const fence of candidate.documentFences) {
          assert.equal(
            fence.kind,
            'document.trashed',
            'This fixture applies Trash only, not an unapproved restore/reopen policy',
          );
          const row = (
            await restored.query(
              'SELECT patient_id,deleted_at FROM fmv.documents WHERE id=$1 FOR UPDATE',
              [fence.resourceId],
            )
          ).rows[0];
          assert.equal(row?.patient_id, fence.patientId);
          if (row.deleted_at === null)
            await restored.query(
              'UPDATE fmv.documents SET deleted_at=$2 WHERE id=$1',
              [fence.resourceId, new Date(fence.occurredAt)],
            );
          assert.equal(
            (
              await restored.query(
                'SELECT extraction_lifecycle AS version FROM fmv.documents WHERE id=$1',
                [fence.resourceId],
              )
            ).rows[0].version,
            fence.lifecycle,
          );
        }
        await restored.query('COMMIT');
      } catch {
        await restored.query('ROLLBACK');
        throw new Error('Synthetic evidence application failed');
      }
    };
    // A later mismatched resource must roll back the earlier grant write.
    await assert.rejects(
      apply({
        ...plan,
        documentFences: plan.documentFences.map((f) => ({
          ...f,
          patientId: randomUUID(),
        })),
      }),
    );
    assert.equal(
      (
        await restored.query(
          'SELECT revoked_at FROM fmv.access_grants WHERE id=$1',
          [fixture.grantId],
        )
      ).rows[0].revoked_at,
      null,
    );
    await permissions.require(fixture.principal, fixture.patientId, 'view');
    await apply(plan);
    await apply(plan);
    await assert.rejects(
      permissions.require(fixture.principal, fixture.patientId, 'view'),
      (error) => error.getStatus?.() === 404,
    );
    await assert.rejects(
      permissions.require(fixture.owner, fixture.patientId, 'view', {
        kind: 'document',
        documentId: fixture.documentId,
      }),
      (error) => error.getStatus?.() === 404,
    );
    assert.ok(
      !(await documents.list(fixture.patientId)).some(
        (d) => d.documentId === fixture.documentId,
      ),
    );
    assert.ok(
      (await documents.listTrash(fixture.patientId)).some(
        (d) => d.documentId === fixture.documentId,
      ),
    );
    return {
      encryptedEvidenceRoundTrip: true,
      restoredGrantDenied: true,
      restoredTrashHidden: true,
      evidenceApplyRollbackVerified: true,
      evidenceReplayIdempotent: true,
      independentlyHostedLedgerVerified: false,
    };
  } finally {
    await documents.onModuleDestroy();
    await access.onModuleDestroy();
  }
}
