import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import { writeProcessingConsent } from '../../dist/documents/processing-consent.store.js';

// AI-04 / SEC-07: no external provider or transport is created. Policies below
// are synthetic infrastructure-only fixtures in disposable PostgreSQL.
export async function verifyProcessingConsent(f) {
  const {
    service,
    otherService,
    store,
    runtime,
    owner,
    principal,
    reader,
    patient,
    id,
    extraction,
    insertGrant,
    ownerAccountId,
    readerAccountId,
    intake,
    authorize,
    categoryId,
  } = f;
  const status = (n) => (e) => e.getStatus?.() === n;
  const read = (actor = principal) =>
    service.consent.read(actor, patient.id, id);
  const write = (input, action = 'grant', actor = principal) =>
    service.consent.write(actor, patient.id, id, input, action);
  const count = async () =>
    Number(
      (
        await runtime.query(
          'SELECT count(*) n FROM fmv.document_processing_consents WHERE document_id=$1::uuid',
          [id],
        )
      ).rows[0].n,
    );
  const providerId = 'synthetic-processing';
  const policyUntil = new Date(Date.now() + 7200000).toISOString();
  const addPolicy = async (version) => {
    const generation = randomUUID();
    await owner.query(
      `INSERT INTO fmv.processing_provider_policies
      (generation,provider_id,policy_version,purposes,data_categories,expires_at,review_reference,enabled)
      VALUES ($1::uuid,$2,$3,$4::text[],$5::text[],$6::timestamptz,$7,true)`,
      [
        generation,
        providerId,
        version,
        ['document-extraction'],
        ['original-document', 'saved-text'],
        policyUntil,
        'synthetic-review-only',
      ],
    );
    return generation;
  };
  const make = (
    r,
    version = 'synthetic-v1',
    expiresAt = new Date(Date.now() + 3600000).toISOString(),
  ) => ({
    requestId: randomUUID(),
    expectedRevision: r.context.revision,
    sourceRevision: r.context.sourceRevision,
    sourceSha256: r.context.sourceSha256,
    lifecycleVersion: r.context.lifecycleVersion,
    providerId,
    policyVersion: version,
    purpose: 'document-extraction',
    dataCategories: ['original-document', 'saved-text'],
    expiresAt,
    confirmed: true,
  });
  const withdraw = (r) => ({
    requestId: randomUUID(),
    expectedRevision: r.context.revision,
  });
  let r = await read();
  assert.equal(r.externalProcessingEnabled, false);
  assert.equal(r.effective, false);
  assert.equal(r.snapshot, null);
  assert.deepEqual(r.policies, []);
  await assert.rejects(write(make(r)), status(503));
  assert.equal(
    await count(),
    0,
    'an unapproved provider cannot create consent',
  );
  const generation1 = await addPolicy('synthetic-v1');
  r = await read();
  assert.equal(
    r.externalProcessingEnabled,
    false,
    'catalog fixtures do not enable a transport',
  );
  assert.equal(r.policies.length, 1);
  const first = make(r);
  assert.deepEqual(await write(first), { saved: true, revision: 1 });
  assert.deepEqual(await write(first), { saved: true, revision: 1 });
  assert.deepEqual(
    await write(Object.fromEntries(Object.entries(first).reverse())),
    { saved: true, revision: 1 },
  );
  assert.equal(await count(), 1);
  r = await read();
  assert.equal(r.effective, true);
  assert.equal(r.externalProcessingEnabled, false);
  assert.equal(r.snapshot.expiresAt, first.expiresAt);
  assert.deepEqual(r.snapshot.dataCategories, first.dataCategories);
  assert.equal(r.snapshot.sourceRevision, first.sourceRevision);
  const grant = await insertGrant(
    runtime,
    {
      patientId: patient.id,
      caregiverAccountId: readerAccountId,
      ownerAccountId,
    },
    {
      actions: ['view', 'edit', 'manage', 'upload', 'export'],
      scopeKind: 'document',
      documentId: id,
    },
  );
  await assert.rejects(read(reader), status(404));
  await assert.rejects(write(make(r), 'grant', reader), status(404));
  await assert.rejects(write(withdraw(r), 'withdrawal', reader), status(404));
  await assert.rejects(
    service.consent.history(reader, patient.id, id, '2'),
    status(404),
  );
  await owner.query(
    'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1::uuid',
    [grant.id ?? grant],
  );
  const rowsBeforeInvalid = await count();
  await assert.rejects(
    write({ ...make(r), expiresAt: new Date(Date.now() - 1000).toISOString() }),
  );
  await assert.rejects(
    write({
      ...make(r),
      expiresAt: new Date(Date.parse(policyUntil) + 1).toISOString(),
    }),
    status(400),
  );
  await assert.rejects(
    write({ ...make(r), sourceRevision: r.context.sourceRevision + 1 }),
    status(409),
  );
  await assert.rejects(
    write({ ...make(r), lifecycleVersion: r.context.lifecycleVersion + 1 }),
    status(409),
  );
  await assert.rejects(
    write({ ...make(r), sourceSha256: 'b'.repeat(64) }),
    status(409),
  );
  assert.equal(await count(), rowsBeforeInvalid);

  // A newer saved-text revision invalidates original-only as well as text consent.
  await extraction('SYNTHETIC newer text version');
  r = await read();
  assert.equal(r.effective, false);
  assert.equal(
    r.snapshot.sourceRevision,
    first.sourceRevision,
    'retain historical binding',
  );
  await assert.rejects(
    write(first),
    status(409),
    'an exact retry cannot renew stale source consent',
  );
  const oldSourceWithdrawal = withdraw(r);
  await write(oldSourceWithdrawal, 'withdrawal');
  await write(oldSourceWithdrawal, 'withdrawal');
  await write(
    Object.fromEntries(Object.entries(oldSourceWithdrawal).reverse()),
    'withdrawal',
  );
  r = await read();
  assert.equal(r.snapshot.action, 'withdrawal');
  assert.equal(r.snapshot.sourceRevision, first.sourceRevision);
  assert.equal(r.effective, false);
  await assert.rejects(write(first), status(409));
  await assert.rejects(
    write({ ...make(r), requestId: oldSourceWithdrawal.requestId }),
    status(409),
  );
  await write({ ...make(r), dataCategories: ['original-document'] });
  r = await read();
  assert.equal(r.effective, true);
  await extraction('SYNTHETIC original-only consent source version changed');
  r = await read();
  assert.equal(r.effective, false);
  await write(withdraw(r), 'withdrawal');
  r = await read();
  await write(make(r));
  r = await read();
  const stale = make(r);
  await service.changeTrash(principal, patient.id, id, 'trash', {});
  await assert.rejects(read(), status(404));
  await assert.rejects(write(stale), status(404));
  await service.changeTrash(principal, patient.id, id, 'restore', {});
  r = await read();
  assert.equal(
    r.effective,
    false,
    'Restore cannot resurrect a pre-Trash grant',
  );
  await assert.rejects(write(stale), status(409));
  await write(withdraw(r), 'withdrawal');
  r = await read();
  await write(make(r));
  r = await read();
  assert.equal(r.effective, true);
  await owner.query(
    'UPDATE fmv.processing_provider_policies SET enabled=false WHERE generation=$1::uuid',
    [generation1],
  );
  r = await read();
  assert.equal(r.effective, false);
  await assert.rejects(write(make(r)), status(503));
  const generation2 = await addPolicy('synthetic-v2');
  r = await read();
  assert.equal(
    r.effective,
    false,
    'new policy does not validate a historical grant',
  );
  await write(make(r, 'synthetic-v2'));
  r = await read();
  assert.equal(r.effective, true);
  await owner.query(
    'UPDATE fmv.processing_provider_policies SET enabled=false WHERE generation=$1::uuid',
    [generation2],
  );
  await assert.rejects(
    owner.query(
      'UPDATE fmv.processing_provider_policies SET enabled=true WHERE generation=$1::uuid',
      [generation1],
    ),
  );
  await assert.rejects(addPolicy('synthetic-v1'));
  r = await read();
  assert.equal(
    r.effective,
    false,
    'retiring latest policy never falls back to older consent',
  );
  const historical = { ...r.snapshot };
  await write(withdraw(r), 'withdrawal');
  r = await read();
  assert.equal(r.snapshot.providerId, historical.providerId);
  assert.equal(r.snapshot.policyVersion, historical.policyVersion);
  assert.equal(r.snapshot.expiresAt, historical.expiresAt);
  assert.equal(r.effective, false);
  const history = await service.consent.history(
    principal,
    patient.id,
    id,
    String(r.context.revision),
  );
  assert.equal(history.snapshot.revision, r.context.revision - 1);
  assert.equal(history.snapshot.action, 'grant');
  assert.equal(history.snapshot.policyVersion, 'synthetic-v2');

  const generation3 = await addPolicy('synthetic-v3');
  r = await read();
  // Keep a truly short owner-chosen expiry; prove invalidation with server time.
  await write(
    make(r, 'synthetic-v3', new Date(Date.now() + 1500).toISOString()),
  );
  r = await read();
  assert.equal(r.effective, true);
  await delay(1600);
  r = await read();
  assert.equal(r.effective, false, 'expired consent is not effective');
  await write(withdraw(r), 'withdrawal');
  r = await read();
  const race = await Promise.allSettled([
    write(make(r, 'synthetic-v3')),
    otherService.consent.write(
      principal,
      patient.id,
      id,
      make(r, 'synthetic-v3'),
      'grant',
    ),
  ]);
  assert.equal(race.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(
    race.filter(
      (x) => x.status === 'rejected' && x.reason.getStatus?.() === 409,
    ).length,
    1,
  );
  r = await read();
  const before = await count(),
    input = withdraw(r);
  let calls = 0;
  await assert.rejects(
    writeProcessingConsent(
      store.db,
      patient.id,
      id,
      input,
      'withdrawal',
      async () => {
        if (++calls === 2) throw Error('Synthetic final access denial');
        return { accountId: ownerAccountId, canVerify: true };
      },
    ),
  );
  assert.equal(await count(), before);
  await owner.query(
    "CREATE FUNCTION fmv.fail_consent_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='processing.consent_withdrawn' THEN RAISE EXCEPTION 'Synthetic';END IF;RETURN NEW;END $$",
  );
  await owner.query(
    'CREATE TRIGGER fail_consent_probe BEFORE INSERT ON fmv.document_events FOR EACH ROW EXECUTE FUNCTION fmv.fail_consent_probe()',
  );
  try {
    await assert.rejects(write(input, 'withdrawal'), status(503));
    assert.equal(await count(), before);
  } finally {
    await owner.query('DROP TRIGGER fail_consent_probe ON fmv.document_events');
    await owner.query('DROP FUNCTION fmv.fail_consent_probe()');
  }
  await write(input, 'withdrawal');
  r = await read();
  assert.equal(r.effective, false);
  await write(make(r, 'synthetic-v3'));
  r = await read();
  const newBytes = Buffer.from(
    '%PDF-1.7\nSynthetic consent source without extraction\n%%EOF',
  );
  const newUpload = await intake.begin(
    patient.id,
    {
      title: 'Synthetic consent original.pdf',
      mimeType: 'application/pdf',
      bytes: newBytes.length,
      sha256: createHash('sha256').update(newBytes).digest('hex'),
      idempotencyKey: randomUUID(),
      categoryId,
    },
    authorize,
  );
  await intake.content(patient.id, newUpload.uploadId, newBytes, authorize);
  await intake.finalize(patient.id, newUpload.uploadId, authorize);
  const originalOnly = await service.consent.read(
    principal,
    patient.id,
    newUpload.documentId,
  );
  assert.equal(originalOnly.context.sourceRevision, 0);
  await assert.rejects(
    service.consent.write(
      principal,
      patient.id,
      newUpload.documentId,
      make(originalOnly, 'synthetic-v3'),
      'grant',
    ),
  );
  await service.consent.write(
    principal,
    patient.id,
    newUpload.documentId,
    {
      ...make(originalOnly, 'synthetic-v3'),
      dataCategories: ['original-document'],
    },
    'grant',
  );
  const originalGranted = await service.consent.read(
    principal,
    patient.id,
    newUpload.documentId,
  );
  assert.equal(originalGranted.effective, true);
  assert.equal(originalGranted.externalProcessingEnabled, false);
  await verifyConsentSqlGuards({
    runtime,
    owner,
    patient,
    id,
    ownerAccountId,
    readerAccountId,
    generation3,
    r,
  });
  // Catalog size failures must not prevent withdrawing already-recorded consent.
  const extraGenerations = [];
  for (let i = 0; i < 21; i++) {
    const generation = randomUUID();
    extraGenerations.push(generation);
    await owner.query(
      `INSERT INTO fmv.processing_provider_policies
      (generation,provider_id,policy_version,purposes,data_categories,expires_at,review_reference,enabled)
      VALUES ($1::uuid,$2,'synthetic-v1',ARRAY['document-extraction'],ARRAY['original-document'],$3::timestamptz,'synthetic-cap-only',true)`,
      [generation, `synthetic-extra-${i}`, policyUntil],
    );
  }
  try {
    await assert.rejects(read(), status(503));
    const result = await write(withdraw(r), 'withdrawal');
    assert.equal(
      result.saved,
      true,
      'withdrawal remains available without loading policy catalog',
    );
  } finally {
    await owner.query(
      'UPDATE fmv.processing_provider_policies SET enabled=false WHERE generation=ANY($1::uuid[])',
      [extraGenerations],
    );
  }
  r = await read();
  assert.equal(r.snapshot.action, 'withdrawal');
  assert.equal(r.effective, false);
}

async function verifyConsentSqlGuards({
  runtime,
  owner,
  patient,
  id,
  ownerAccountId,
  readerAccountId,
  generation3,
  r,
}) {
  const rights = (
    await runtime.query(
      "SELECT has_table_privilege(current_user,'fmv.document_processing_consents','SELECT') r,has_table_privilege(current_user,'fmv.document_processing_consents','INSERT') i,has_table_privilege(current_user,'fmv.document_processing_consents','UPDATE') u,has_table_privilege(current_user,'fmv.document_processing_consents','DELETE') d,has_table_privilege(current_user,'fmv.processing_provider_policies','SELECT') policy_r,has_table_privilege(current_user,'fmv.processing_provider_policies','INSERT') policy_i,has_table_privilege(current_user,'fmv.processing_provider_policies','UPDATE') policy_u,has_table_privilege(current_user,'fmv.processing_provider_policies','DELETE') policy_d",
    )
  ).rows[0];
  assert.deepEqual(rights, {
    r: true,
    i: true,
    u: false,
    d: false,
    policy_r: true,
    policy_i: false,
    policy_u: false,
    policy_d: false,
  });
  for (const table of [
    'document_processing_consents',
    'processing_provider_policies',
  ]) {
    const forced = (
      await runtime.query(
        'SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',
        [`fmv.${table}`],
      )
    ).rows[0];
    assert.deepEqual(forced, {
      relrowsecurity: true,
      relforcerowsecurity: true,
    });
  }
  const latest = (
    await runtime.query(
      'SELECT * FROM fmv.document_processing_consents WHERE document_id=$1::uuid ORDER BY revision DESC LIMIT 1',
      [id],
    )
  ).rows[0];
  const probe = (change = {}) => {
    const row = {
      ...latest,
      id: randomUUID(),
      revision: r.context.revision + 1,
      request_id: randomUUID(),
      payload_hash: 'a'.repeat(64),
      ...change,
    };
    return runtime.query(
      `INSERT INTO fmv.document_processing_consents
      (id,document_id,patient_id,revision,request_id,payload_hash,actor_account_id,action,source_sha256,source_revision,lifecycle_version,policy_generation,provider_id,policy_version,purpose,data_categories,expires_at)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8,$9,$10,$11,$12::uuid,$13,$14,$15,$16::text[],$17::timestamptz)`,
      [
        row.id,
        id,
        patient.id,
        row.revision,
        row.request_id,
        row.payload_hash,
        row.actor_account_id,
        row.action,
        row.source_sha256,
        row.source_revision,
        row.lifecycle_version,
        row.policy_generation,
        row.provider_id,
        row.policy_version,
        row.purpose,
        row.data_categories,
        row.expires_at,
      ],
    );
  };
  for (const change of [
    { actor_account_id: readerAccountId },
    { source_sha256: 'b'.repeat(64) },
    { source_revision: latest.source_revision + 1 },
    { lifecycle_version: latest.lifecycle_version + 1 },
    { purpose: 'prescribing' },
    { data_categories: ['all-records'] },
    { data_categories: ['saved-text', 'saved-text'] },
    { expires_at: new Date(Date.now() - 1000) },
    { expires_at: new Date(Date.now() + 86400000) },
    { policy_version: 'synthetic-v1' },
    { action: 'withdrawal', provider_id: 'forged-provider' },
  ])
    await assert.rejects(probe(change), (e) => e.code === '23514');
  await assert.rejects(
    probe({ revision: r.context.revision + 2 }),
    (e) => e.code === '23514',
  );
  await assert.rejects(
    runtime.query(
      'UPDATE fmv.document_processing_consents SET purpose=purpose WHERE document_id=$1::uuid',
      [id],
    ),
    (e) => e.code === '42501',
  );
  await assert.rejects(
    runtime.query(
      'DELETE FROM fmv.document_processing_consents WHERE document_id=$1::uuid',
      [id],
    ),
    (e) => e.code === '42501',
  );
  await assert.rejects(
    runtime.query(
      'UPDATE fmv.processing_provider_policies SET enabled=false WHERE generation=$1::uuid',
      [generation3],
    ),
    (e) => e.code === '42501',
  );
  await assert.rejects(
    owner.query(
      "UPDATE fmv.processing_provider_policies SET policy_version='synthetic-forged' WHERE generation=$1::uuid",
      [generation3],
    ),
    (e) => e.code === '23514',
  );
  assert.equal(
    (
      await runtime.query(
        "SELECT count(*)::int n FROM pg_constraint WHERE conrelid='fmv.document_processing_consents'::regclass AND confrelid='fmv.documents'::regclass AND confdeltype='c'",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(ownerAccountId, latest.actor_account_id);
}
