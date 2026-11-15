import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import pg from 'pg';
import { PrismaPersonStore } from '../../dist/identity/person.store.js';
import { PrismaAccessStore } from '../../dist/access/access.store.js';
import { PermissionService } from '../../dist/access/permission.service.js';
import { PrismaDocumentStore } from '../../dist/documents/document.store.js';
import { DocumentsService } from '../../dist/documents/documents.service.js';
import { DocumentIntake } from '../../dist/documents/intake.js';
import { MemoryObjectStore } from '../../dist/documents/memory-object-store.js';

// DOC-03 / AI-02 / AI-05 / AI-06: exercise real runtime grants, PostgreSQL
// constraints and transactions; all content and identities below are synthetic.
export async function verifyClinicalReview(runtimeUrl, owner, insertGrant) {
  const runtime = new pg.Client({ connectionString: runtimeUrl.href });
  const people = new PrismaPersonStore(runtimeUrl.href);
  const access = new PrismaAccessStore(runtimeUrl.href);
  const store = new PrismaDocumentStore(runtimeUrl.href);
  const other = new PrismaDocumentStore(runtimeUrl.href);
  await runtime.connect();
  try {
    const principal = {
      issuer: 'https://clinical.example.test',
      subject: randomUUID(),
    };
    const reader = { ...principal, subject: randomUUID() };
    const patient = await people.create(principal, 'Synthetic clinical owner');
    const recipient = await people.create(reader, 'Synthetic clinical reader');
    const account = async (id) =>
      (
        await runtime.query(
          'SELECT owner_account_id FROM fmv.persons WHERE id=$1::uuid',
          [id],
        )
      ).rows[0].owner_account_id;
    const ownerAccountId = await account(patient.id);
    const readerAccountId = await account(recipient.id);
    const permissions = new PermissionService(access);
    const objects = new MemoryObjectStore();
    const service = new DocumentsService(permissions, store, objects);
    const otherService = new DocumentsService(permissions, other, objects);
    const intake = new DocumentIntake(store.asActor(ownerAccountId), objects);
    const authorize = (p, a, target) =>
      permissions.require(principal, p, a, target);
    const bytes = Buffer.from('%PDF-1.7\nSynthetic clinical original\n%%EOF');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const categoryId = randomUUID();
    await owner.query(
      "INSERT INTO fmv.document_categories(id,slug,name) VALUES ($1::uuid,$2,'Synthetic clinical category')",
      [categoryId, randomUUID()],
    );
    const upload = await intake.begin(
      patient.id,
      {
        title: 'Synthetic clinical original.pdf',
        mimeType: 'application/pdf',
        bytes: bytes.length,
        sha256,
        idempotencyKey: randomUUID(),
        categoryId,
      },
      authorize,
    );
    await intake.content(patient.id, upload.uploadId, bytes, authorize);
    await intake.finalize(patient.id, upload.uploadId, authorize);
    const id = upload.documentId;
    const immutable = async () =>
      (
        await runtime.query(
          'SELECT title,display_title,category_id,sha256,bytes,mime_type,object_key,state FROM fmv.documents WHERE id=$1::uuid',
          [id],
        )
      ).rows[0];
    const original = await immutable();
    const extraction = async (text) => {
      const { context } = await service.extraction.read(
        principal,
        patient.id,
        id,
        false,
      );
      return service.extraction.save(principal, patient.id, id, {
        requestId: randomUUID(),
        expectedRevision: context.revision,
        lifecycleVersion: context.lifecycleVersion,
        sourceSha256: context.sourceSha256,
        result: {
          method: 'pdf-text',
          engineVersion: 'pdfjs-6.5.438',
          pages: [{ page: 1, text }],
          partial: false,
          partialReason: null,
          downsized: false,
        },
      });
    };
    const read = (actor = principal) =>
      service.clinical.read(actor, patient.id, id);
    const status = (code) => (error) => error.getStatus?.() === code;
    const make = (r) => ({
      requestId: randomUUID(),
      expectedRevision: r.context.revision,
      sourceRevision: r.context.sourceRevision,
      sourceSha256: r.context.sourceSha256,
      lifecycleVersion: r.context.lifecycleVersion,
      confirmed: true,
      selections: r.candidates.map((c) => ({
        candidateId: c.id,
        fields: Object.fromEntries(
          Object.entries(c.fields).map(([key, f]) => [key, f?.value ?? null]),
        ),
      })),
    });
    const save = (input, actor = principal) =>
      service.clinical.save(actor, patient.id, id, input);
    const count = async () =>
      (
        await runtime.query(
          'SELECT count(*)::int n FROM fmv.document_clinical_reviews WHERE document_id=$1::uuid',
          [id],
        )
      ).rows[0].n;
    const history = (before, actor = principal) =>
      service.clinical.history(actor, patient.id, id, String(before));
    const empty = await read();
    assert.equal(empty.context.sourceRevision, 0);
    assert.equal(empty.snapshot, null);
    await extraction(
      'Test: Synthetic analyte\nResult: <5.4\nUnits: synthetic/unit\nReference range: 1–9\nCollection date: 03/04/2026',
    );
    const initial = await read();
    assert.equal(initial.candidates.length, 1);
    assert.equal(initial.snapshot, null);
    assert.equal(initial.context.canVerify, true);
    const input = make(initial);
    input.selections[0].fields.result = '<5.40';
    for (let i = 0; i < 2; i++)
      assert.deepEqual(await save(input), { saved: true, revision: 1 });
    assert.equal(await count(), 1);
    let confirmed = (await read()).snapshot;
    assert.equal(confirmed.verified, true);
    assert.equal(confirmed.items[0].fields.result, '<5.40');
    assert.equal(confirmed.items[0].source.fields.result.value, '<5.4');
    assert.equal(confirmed.items[0].fields.date, '03/04/2026');
    await assert.rejects(
      save({
        ...input,
        selections: [
          {
            ...input.selections[0],
            fields: { ...input.selections[0].fields, result: 'different' },
          },
        ],
      }),
      status(409),
    );
    await assert.rejects(save({ ...input, confirmed: false }), status(400));
    await assert.rejects(save({ ...input, selections: [] }), status(400));
    await assert.rejects(
      save({ ...input, sourceSha256: 'b'.repeat(64) }),
      status(409),
    );
    const grants = [];
    for (const actions of [
      ['view'],
      ['view', 'edit', 'manage'],
      ['export'],
      ['edit'],
    ]) {
      const grant = await insertGrant(
        runtime,
        {
          patientId: patient.id,
          caregiverAccountId: readerAccountId,
          ownerAccountId,
        },
        { actions, scopeKind: 'document', documentId: id },
      );
      grants.push(grant.id ?? grant);
      if (actions.includes('view')) {
        const r = await read(reader);
        assert.equal(r.context.canVerify, false);
        assert.equal(r.snapshot.verified, true);
      } else await assert.rejects(read(reader), status(404));
      await assert.rejects(save(input, reader), status(404));
      await owner.query(
        'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1::uuid',
        [grant.id ?? grant],
      );
    }
    await assert.rejects(read(reader), status(404));
    const second = make(await read());
    second.selections[0].fields.unit = null;
    assert.deepEqual(await save(second), { saved: true, revision: 2 });
    assert.equal(await count(), 2);
    const viewedCount = async () =>
      (
        await runtime.query(
          "SELECT count(*)::int n FROM fmv.document_events WHERE document_id=$1::uuid AND kind='document.viewed'",
          [id],
        )
      ).rows[0].n;
    const viewedBefore = await viewedCount();
    let historyChecks = 0;
    await assert.rejects(
      store.readClinicalHistory(patient.id, id, 2, async () => {
        if (++historyChecks === 2) throw Error('synthetic history revocation');
        return { accountId: ownerAccountId, canVerify: true };
      }),
    );
    assert.equal(await viewedCount(), viewedBefore);
    const older = await history(2);
    assert.equal(older.snapshot.revision, 1);
    assert.equal(older.snapshot.items[0].fields.unit, 'synthetic/unit');
    assert.equal(older.context.revision, 2);
    assert.equal(older.nextBefore, null);
    assert.equal((await history(1)).snapshot, null);
    const historyGrant = await insertGrant(
      runtime,
      {
        patientId: patient.id,
        caregiverAccountId: readerAccountId,
        ownerAccountId,
      },
      { actions: ['view'], scopeKind: 'document', documentId: id },
    );
    assert.equal((await history(2, reader)).snapshot.revision, 1);
    await owner.query(
      'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1::uuid',
      [historyGrant.id ?? historyGrant],
    );
    await assert.rejects(history(2, reader), status(404));
    for (const cursor of ['0', '01', '-1', '2147483648', '2\n', undefined])
      await assert.rejects(
        service.clinical.history(principal, patient.id, id, cursor),
        status(400),
      );
    await assert.rejects(
      runtime.query(
        'UPDATE fmv.document_clinical_reviews SET items=items WHERE document_id=$1::uuid',
        [id],
      ),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      runtime.query(
        'DELETE FROM fmv.document_clinical_reviews WHERE document_id=$1::uuid',
        [id],
      ),
      (e) => e.code === '42501',
    );
    await extraction(
      'Test: Synthetic analyte\nResult: 6.7\nUnit: synthetic/unit',
    );
    const changed = await read();
    assert.equal(changed.context.sourceRevision, 2);
    assert.equal(changed.snapshot.sourceRevision, 1);
    assert.equal(changed.snapshot.extraction.method, 'pdf-text');
    assert.equal(changed.snapshot.extraction.engineVersion, 'pdfjs-6.5.438');
    assert.equal(changed.snapshot.revision, 2);
    assert.equal(changed.candidates[0].fields.result.value, '6.7');
    await assert.rejects(save(second), status(409));
    const stale = make(changed);
    await service.changeTrash(principal, patient.id, id, 'trash', {});
    await assert.rejects(read(), status(404));
    await assert.rejects(history(2), status(404));
    await assert.rejects(save(stale), status(404));
    await service.changeTrash(principal, patient.id, id, 'restore', {});
    assert.equal((await read()).snapshot.revision, 2);
    const restoredHistory = await history(2);
    assert.equal(restoredHistory.snapshot.sourceRevision, 1);
    assert.equal(restoredHistory.context.sourceRevision, 2);
    assert.ok(restoredHistory.context.lifecycleVersion > 0);
    await assert.rejects(save(stale), status(409));
    assert.deepEqual(await save(make(await read())), {
      saved: true,
      revision: 3,
    });
    const race = make(await read());
    const [raced, concurrentHistory] = await Promise.all([
      Promise.allSettled([
        save(race),
        otherService.clinical.save(principal, patient.id, id, {
          ...race,
          requestId: randomUUID(),
        }),
      ]),
      history(3),
    ]);
    assert.equal(concurrentHistory.snapshot.revision, 2);
    assert.ok([3, 4].includes(concurrentHistory.context.revision));
    assert.equal(raced.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      raced.filter(
        (r) => r.status === 'rejected' && r.reason.getStatus?.() === 409,
      ).length,
      1,
    );
    assert.equal(await count(), 4);
    const rollback = make(await read());
    let checks = 0;
    await assert.rejects(
      store.saveClinicalReview(patient.id, id, rollback, async () => {
        if (++checks === 2) throw new Error('synthetic revocation');
        return { accountId: ownerAccountId, canVerify: true };
      }),
    );
    assert.equal(await count(), 4);
    await owner.query(
      "CREATE FUNCTION fmv.fail_clinical_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='document.clinical_verified' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$",
    );
    await owner.query(
      'CREATE TRIGGER fail_clinical_probe BEFORE INSERT ON fmv.document_events FOR EACH ROW EXECUTE FUNCTION fmv.fail_clinical_probe()',
    );
    try {
      await assert.rejects(save(rollback), status(503));
      assert.equal(await count(), 4);
    } finally {
      await owner.query(
        'DROP TRIGGER fail_clinical_probe ON fmv.document_events',
      );
      await owner.query('DROP FUNCTION fmv.fail_clinical_probe()');
    }
    assert.deepEqual(await save(rollback), { saved: true, revision: 5 });
    assert.equal(await count(), 5);
    const current = await read();
    const forgedItems = globalThis.structuredClone(current.snapshot.items);
    forgedItems[0].source.fields.result.excerpt =
      'Result: fabricated ' + forgedItems[0].source.fields.result.value;
    const direct = (
      actor,
      items,
      sourceRevision = current.context.sourceRevision,
    ) =>
      runtime.query(
        `INSERT INTO fmv.document_clinical_reviews(id,document_id,patient_id,revision,source_revision,source_sha256,lifecycle_version,request_id,payload_hash,actor_account_id,source_context,items) VALUES ($1::uuid,$2::uuid,$3::uuid,6,$4,$5,$6,$7::uuid,$8,$9::uuid,$10::jsonb,$11::jsonb)`,
        [
          randomUUID(),
          id,
          patient.id,
          sourceRevision,
          sha256,
          current.context.lifecycleVersion,
          randomUUID(),
          'a'.repeat(64),
          actor,
          JSON.stringify(current.snapshot.extraction),
          JSON.stringify(items),
        ],
      );
    await assert.rejects(
      direct(readerAccountId, current.snapshot.items),
      (e) => e.code === '23514',
    );
    await assert.rejects(
      direct(ownerAccountId, forgedItems),
      (e) => e.code === '23514',
    );
    await assert.rejects(
      direct(ownerAccountId, current.snapshot.items, 1),
      (e) => e.code === '23514',
    );
    for (const value of ['𐐀'.repeat(70), '   ', '\u00a0\ufeff'])
      assert.equal(
        (
          await runtime.query(
            'SELECT fmv.clinical_value_valid($1::jsonb,false) valid',
            [JSON.stringify(value)],
          )
        ).rows[0].valid,
        false,
      );
    assert.equal(
      await count(),
      5,
      'Guard failures never append a clinical confirmation',
    );
    const rights = (
      await runtime.query(
        "SELECT has_table_privilege(current_user,'fmv.document_clinical_reviews','UPDATE') u,has_table_privilege(current_user,'fmv.document_clinical_reviews','DELETE') d",
      )
    ).rows[0];
    assert.equal(rights.u, false);
    assert.equal(rights.d, false);
    const clinicalEvents = (
      await runtime.query(
        "SELECT count(*)::int n FROM fmv.document_events WHERE document_id=$1::uuid AND kind='document.clinical_verified'",
        [id],
      )
    ).rows[0].n;
    assert.equal(
      clinicalEvents,
      5,
      'Retries and rolled-back writes do not add verification events',
    );
    assert.deepEqual(await immutable(), original);
    await extraction(
      'Test: First synthetic entry\nResult: 1.0\n\nTest: Second synthetic entry\nResult: 2.0',
    );
    const partial = make(await read());
    partial.selections = partial.selections.slice(0, 1);
    assert.deepEqual(await save(partial), { saved: true, revision: 6 });
    const remainder = make(await read());
    remainder.selections = remainder.selections.slice(1);
    assert.deepEqual(await save(remainder), { saved: true, revision: 7 });
    assert.equal((await history(7)).snapshot.revision, 6);
    assert.equal((await history(7)).nextBefore, 6);
    assert.equal((await history(6)).snapshot.revision, 5);
    const merged = (await read()).snapshot.items;
    assert.equal(merged.length, 2);
    assert.deepEqual(
      merged.map((i) => i.fields.analyte),
      ['First synthetic entry', 'Second synthetic entry'],
    );
    const withdraw = (input, actor = principal) =>
      service.clinical.withdraw(actor, patient.id, id, input);
    const makeWithdrawal = (r) => ({
      requestId: randomUUID(),
      expectedRevision: r.context.revision,
      sourceSha256: r.context.sourceSha256,
      lifecycleVersion: r.context.lifecycleVersion,
      confirmed: true,
      candidateIds: r.snapshot.items.map((item) => item.source.id),
    });
    const beforeWithdrawal = await read(),
      firstId = beforeWithdrawal.snapshot.items[0].source.id;
    const firstWithdrawal = makeWithdrawal(beforeWithdrawal);
    firstWithdrawal.candidateIds = [firstId];
    for (let i = 0; i < 2; i++)
      assert.deepEqual(await withdraw(firstWithdrawal), {
        saved: true,
        revision: 8,
      });
    let result = await read();
    assert.equal(result.snapshot.action, 'withdrawal');
    assert.equal(result.snapshot.items.length, 1);
    assert.equal(result.snapshot.verified, true);
    assert.deepEqual(result.snapshot.withdrawnItems, [
      beforeWithdrawal.snapshot.items[0],
    ]);
    assert.equal((await history(8)).snapshot.items.length, 2);
    assert.equal((await history(9)).snapshot.action, 'withdrawal');
    const unrelated = make(result);
    unrelated.selections = unrelated.selections.filter(
      (item) => item.candidateId !== firstId,
    );
    assert.deepEqual(await save(unrelated), { saved: true, revision: 9 });
    result = await read();
    assert.equal(result.snapshot.items.length, 1);
    assert.notEqual(result.snapshot.items[0].source.id, firstId);
    assert.deepEqual(await withdraw(makeWithdrawal(result)), {
      saved: true,
      revision: 10,
    });
    result = await read();
    assert.equal(result.snapshot.items.length, 0);
    assert.equal(result.snapshot.verified, false);
    assert.equal(result.snapshot.withdrawnItems.length, 1);
    assert.equal((await history(11)).snapshot.verified, false);
    const reinstate = make(result);
    reinstate.selections = reinstate.selections.filter(
      (item) => item.candidateId === firstId,
    );
    assert.deepEqual(await save(reinstate), { saved: true, revision: 11 });
    assert.equal((await read()).snapshot.items[0].source.id, firstId);
    for (const patch of [
      { confirmed: false },
      { candidateIds: [] },
      { candidateIds: [firstId, firstId] },
      { actorAccountId: ownerAccountId },
      { fields: { result: 'forged' } },
      { verifiedAt: '2026-11-15T00:00:00Z' },
    ])
      await assert.rejects(
        withdraw({ ...makeWithdrawal(await read()), ...patch }),
        status(400),
      );
    await assert.rejects(
      withdraw({
        ...makeWithdrawal(await read()),
        candidateIds: ['page-1-block-999999'],
      }),
      status(409),
    );
    await assert.rejects(
      withdraw({ ...makeWithdrawal(await read()), expectedRevision: 10 }),
      status(409),
    );
    const delegateGrant = await insertGrant(
      runtime,
      {
        patientId: patient.id,
        caregiverAccountId: readerAccountId,
        ownerAccountId,
      },
      {
        actions: ['view', 'edit', 'manage', 'export', 'upload'],
        scopeKind: 'document',
        documentId: id,
      },
    );
    await assert.rejects(
      withdraw(makeWithdrawal(await read()), reader),
      status(404),
    );
    await assert.rejects(withdraw({ confirmed: false }, reader), status(404));
    await owner.query(
      'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1::uuid',
      [delegateGrant.id ?? delegateGrant],
    );
    await extraction('Test: New synthetic source\nResult: 9');
    const oldSource = await read();
    assert.equal(oldSource.snapshot.sourceRevision, 3);
    assert.equal(oldSource.context.sourceRevision, 4);
    assert.deepEqual(await withdraw(makeWithdrawal(oldSource)), {
      saved: true,
      revision: 12,
    });
    assert.equal((await read()).snapshot.sourceRevision, 3);
    assert.deepEqual(await save(make(await read())), {
      saved: true,
      revision: 13,
    });
    const staleWithdrawal = makeWithdrawal(await read());
    await service.changeTrash(principal, patient.id, id, 'trash', {});
    await assert.rejects(withdraw(staleWithdrawal), status(404));
    await service.changeTrash(principal, patient.id, id, 'restore', {});
    await assert.rejects(withdraw(staleWithdrawal), status(409));
    assert.deepEqual(await withdraw(makeWithdrawal(await read())), {
      saved: true,
      revision: 14,
    });
    assert.equal((await history(14)).snapshot.items.length, 1);
    await assert.rejects(
      withdraw({
        ...makeWithdrawal(await read()),
        requestId: firstWithdrawal.requestId,
        candidateIds: [firstId],
      }),
      status(409),
    );
    assert.deepEqual(await save(make(await read())), {
      saved: true,
      revision: 15,
    });
    const pendingWithdrawal = makeWithdrawal(await read());
    const withdrawalsCount = async () =>
      (
        await runtime.query(
          "SELECT count(*)::int n FROM fmv.document_events WHERE document_id=$1::uuid AND kind='document.clinical_withdrawn'",
          [id],
        )
      ).rows[0].n;
    const eventsBefore = await withdrawalsCount();
    let withdrawalChecks = 0;
    await assert.rejects(
      store.withdrawClinicalReview(
        patient.id,
        id,
        pendingWithdrawal,
        async () => {
          if (++withdrawalChecks === 2)
            throw Error('synthetic withdrawal revocation');
          return { accountId: ownerAccountId, canVerify: true };
        },
      ),
    );
    assert.equal(await count(), 15);
    assert.equal(await withdrawalsCount(), eventsBefore);
    await owner.query(
      "CREATE FUNCTION fmv.fail_withdrawal_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='document.clinical_withdrawn' THEN RAISE EXCEPTION 'synthetic withdrawal audit failure'; END IF; RETURN NEW; END $$",
    );
    await owner.query(
      'CREATE TRIGGER fail_withdrawal_probe BEFORE INSERT ON fmv.document_events FOR EACH ROW EXECUTE FUNCTION fmv.fail_withdrawal_probe()',
    );
    try {
      await assert.rejects(withdraw(pendingWithdrawal), status(503));
      assert.equal(await count(), 15);
    } finally {
      await owner.query(
        'DROP TRIGGER fail_withdrawal_probe ON fmv.document_events',
      );
      await owner.query('DROP FUNCTION fmv.fail_withdrawal_probe()');
    }
    assert.deepEqual(await withdraw(pendingWithdrawal), {
      saved: true,
      revision: 16,
    });
    assert.equal(await withdrawalsCount(), eventsBefore + 1);
    assert.deepEqual(await save(make(await read())), {
      saved: true,
      revision: 17,
    });
    const raceView = await read();
    const mutationRace = await Promise.allSettled([
      withdraw(makeWithdrawal(raceView)),
      otherService.clinical.save(principal, patient.id, id, make(raceView)),
    ]);
    assert.equal(
      mutationRace.filter((x) => x.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      mutationRace.filter(
        (x) => x.status === 'rejected' && x.reason.getStatus?.() === 409,
      ).length,
      1,
    );
    assert.equal(await count(), 18);
    result = await read();
    assert.equal(
      result.snapshot.action,
      mutationRace[0].status === 'fulfilled' ? 'withdrawal' : 'confirmation',
    );
    if (!result.snapshot.items.length) {
      await save(make(result));
      result = await read();
    }
    const activeItem = result.snapshot.items[0],
      forgedItem = globalThis.structuredClone(activeItem);
    forgedItem.fields.result = 'Synthetic tampering';
    const badPartition = () =>
      runtime.query(
        `INSERT INTO fmv.document_clinical_reviews(id,document_id,patient_id,revision,source_revision,source_sha256,lifecycle_version,request_id,payload_hash,actor_account_id,source_context,items,action,withdrawn_items) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8::uuid,$9,$10::uuid,$11::jsonb,'[]'::jsonb,'withdrawal',$12::jsonb)`,
        [
          randomUUID(),
          id,
          patient.id,
          result.context.revision + 1,
          result.snapshot.sourceRevision,
          sha256,
          result.context.lifecycleVersion,
          randomUUID(),
          'a'.repeat(64),
          ownerAccountId,
          JSON.stringify(result.snapshot.extraction),
          JSON.stringify([forgedItem]),
        ],
      );
    await assert.rejects(badPartition(), (e) => e.code === '23514');
    const setValidation = (
      await runtime.query(
        'SELECT fmv.clinical_set_valid($1::jsonb,$2::jsonb,$3) confirmation_empty,fmv.clinical_set_valid($1::jsonb,$4::jsonb,$5) withdrawal_last,fmv.clinical_set_valid($4::jsonb,$4::jsonb,$5) duplicate,fmv.clinical_set_valid($1::jsonb,$4::jsonb,NULL) null_action',
        [
          '[]',
          '[]',
          'confirmation',
          JSON.stringify([activeItem]),
          'withdrawal',
        ],
      )
    ).rows[0];
    assert.deepEqual(setValidation, {
      confirmation_empty: false,
      withdrawal_last: true,
      duplicate: false,
      null_action: false,
    });
    const privileges = (
      await runtime.query(
        "SELECT has_column_privilege(current_user,'fmv.document_clinical_reviews','action','UPDATE') action,has_column_privilege(current_user,'fmv.document_clinical_reviews','withdrawn_items','UPDATE') withdrawn",
      )
    ).rows[0];
    assert.deepEqual(privileges, { action: false, withdrawn: false });
    assert.deepEqual(await immutable(), original);
    assert.deepEqual(
      (await intake.read(patient.id, id, 'view', authorize)).bytes,
      bytes,
    );
  } finally {
    await runtime.end();
    await other.onModuleDestroy();
    await store.onModuleDestroy();
    await access.onModuleDestroy();
    await people.onModuleDestroy();
  }
}
