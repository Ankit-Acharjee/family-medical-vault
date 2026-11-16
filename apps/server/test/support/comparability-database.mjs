import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { PrismaPersonStore } from '../../dist/identity/person.store.js';
import { PrismaAccessStore } from '../../dist/access/access.store.js';
import { PermissionService } from '../../dist/access/permission.service.js';
import { PrismaDocumentStore } from '../../dist/documents/document.store.js';
import { DocumentsService } from '../../dist/documents/documents.service.js';
import { DocumentIntake } from '../../dist/documents/intake.js';
import { MemoryObjectStore } from '../../dist/documents/memory-object-store.js';
import { isMeasurementComparisonMembers } from '@fmv/contracts';

// LAB-03: exercise current source evidence and permissions against PostgreSQL.
// All identities and values are synthetic; no external service is used.
export async function verifyComparability(runtimeUrl, owner, insertGrant) {
  const runtime = new pg.Client({ connectionString: runtimeUrl.href });
  const people = new PrismaPersonStore(runtimeUrl.href);
  const access = new PrismaAccessStore(runtimeUrl.href);
  const store = new PrismaDocumentStore(runtimeUrl.href);
  const other = new PrismaDocumentStore(runtimeUrl.href);
  await runtime.connect();
  try {
    const principal = {
      issuer: 'https://comparison.example.test',
      subject: randomUUID(),
    };
    const reader = { ...principal, subject: randomUUID() };
    const patient = await people.create(
      principal,
      'Synthetic comparison owner',
    );
    const recipient = await people.create(
      reader,
      'Synthetic comparison reader',
    );
    const account = async (id) =>
      (
        await runtime.query(
          'SELECT owner_account_id FROM fmv.persons WHERE id=$1::uuid',
          [id],
        )
      ).rows[0].owner_account_id;
    const ownerAccountId = await account(patient.id),
      readerAccountId = await account(recipient.id);
    const permissions = new PermissionService(access),
      objects = new MemoryObjectStore();
    const service = new DocumentsService(permissions, store, objects);
    const intake = new DocumentIntake(store.asActor(ownerAccountId), objects);
    const authorize = (p, a, target) =>
      permissions.require(principal, p, a, target);
    const bytes = Buffer.from('%PDF-1.7\nSynthetic comparison original\n%%EOF');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const categoryId = randomUUID();
    await owner.query(
      "INSERT INTO fmv.document_categories(id,slug,name) VALUES($1::uuid,$2,'Synthetic comparison category')",
      [categoryId, randomUUID()],
    );
    const upload = async () => {
      const doc = await intake.begin(
        patient.id,
        {
          title: 'Synthetic comparison.pdf',
          mimeType: 'application/pdf',
          bytes: bytes.length,
          sha256,
          idempotencyKey: randomUUID(),
          categoryId,
        },
        authorize,
      );
      await intake.content(patient.id, doc.uploadId, bytes, authorize);
      await intake.finalize(patient.id, doc.uploadId, authorize);
      return doc.documentId;
    };
    const extraction = async (id, text) => {
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
    const confirmClinical = async (id, overrides = {}) => {
      const review = await service.clinical.read(principal, patient.id, id);
      await service.clinical.save(principal, patient.id, id, {
        requestId: randomUUID(),
        expectedRevision: review.context.revision,
        sourceRevision: review.context.sourceRevision,
        sourceSha256: review.context.sourceSha256,
        lifecycleVersion: review.context.lifecycleVersion,
        confirmed: true,
        selections: review.candidates.map((c) => ({
          candidateId: c.id,
          fields: {
            ...Object.fromEntries(
              Object.entries(c.fields).map(([k, f]) => [k, f?.value ?? null]),
            ),
            ...overrides,
          },
        })),
      });
      const saved = await service.clinical.read(principal, patient.id, id);
      return {
        documentId: id,
        candidateId: saved.snapshot.items[0].source.id,
        reviewRevision: saved.context.revision,
        sourceRevision: saved.context.sourceRevision,
        sourceSha256: saved.context.sourceSha256,
        lifecycleVersion: saved.context.lifecycleVersion,
      };
    };
    const ids = [await upload(), await upload()];
    for (const id of ids)
      await extraction(
        id,
        'Test: Synthetic analyte\nResult: 1.230000000000000001\nUnit: synthetic/unit\nCollection date: 2024-02-29',
      );
    const refs = await Promise.all(ids.map(confirmClinical));
    const { MeasurementComparisonsService } =
      await import('../../dist/measurements/measurement-comparisons.service.js');
    const comparisons = new MeasurementComparisonsService(runtimeUrl.href);
    const concurrent = new MeasurementComparisonsService(runtimeUrl.href);
    try {
      const setId = randomUUID();
      const read = (actor = principal, patientId = patient.id) =>
        comparisons.read(actor, patientId, setId);
      const confirm = (body, actor = principal) =>
        comparisons.confirm(actor, patient.id, setId, body);
      const withdraw = (body, actor = principal) =>
        comparisons.withdraw(actor, patient.id, setId, body);
      const status = (code) => (error) => error.getStatus?.() === code;
      const make = (revision, members = refs) => ({
        requestId: randomUUID(),
        expectedRevision: revision,
        confirmed: true,
        members,
      });
      const rejectIncompatible = async () => {
        const gateId = randomUUID();
        await assert.rejects(
          comparisons.confirm(principal, patient.id, gateId, make(0)),
          status(409),
        );
        await assert.rejects(
          runtime.query(
            `INSERT INTO fmv.measurement_comparisons(id,set_id,patient_id,revision,action,request_id,payload_hash,actor_account_id,members) VALUES($1::uuid,$2::uuid,$3::uuid,1,'confirmation',$4::uuid,$5,$6::uuid,$7::jsonb)`,
            [
              randomUUID(),
              gateId,
              patient.id,
              randomUUID(),
              'c'.repeat(64),
              ownerAccountId,
              JSON.stringify(refs),
            ],
          ),
          (e) => e.code === '23514',
        );
      };
      refs[1] = await confirmClinical(ids[1], { unit: 'other-unit' });
      await rejectIncompatible();
      refs[1] = await confirmClinical(ids[1], {
        analyte: 'Different literal analyte',
      });
      await rejectIncompatible();
      refs[0] = await confirmClinical(ids[0], { method: 'method-A' });
      refs[1] = await confirmClinical(ids[1], { method: 'method-B' });
      await rejectIncompatible();
      refs[0] = await confirmClinical(ids[0], { specimen: 'specimen-A' });
      refs[1] = await confirmClinical(ids[1], { specimen: 'specimen-B' });
      await rejectIncompatible();
      refs[1] = await confirmClinical(ids[1], { unit: null });
      await rejectIncompatible();
      refs[0] = await confirmClinical(ids[0]);
      refs[1] = await confirmClinical(ids[1]);
      assert.equal((await read()).status, 'missing');
      // A faulted link-population trigger cannot commit an incomplete ledger.
      const incompleteId = randomUUID();
      await owner.query(
        'ALTER TABLE fmv.measurement_comparisons DISABLE TRIGGER comparison_link_sources',
      );
      try {
        await assert.rejects(
          runtime.query(
            `INSERT INTO fmv.measurement_comparisons(id,set_id,patient_id,revision,action,request_id,payload_hash,actor_account_id,members) VALUES($1::uuid,$2::uuid,$3::uuid,1,'confirmation',$4::uuid,$5,$6::uuid,$7::jsonb)`,
            [
              randomUUID(),
              incompleteId,
              patient.id,
              randomUUID(),
              'd'.repeat(64),
              ownerAccountId,
              JSON.stringify(refs),
            ],
          ),
          (e) => e.code === '23514',
        );
      } finally {
        await owner.query(
          'ALTER TABLE fmv.measurement_comparisons ENABLE TRIGGER comparison_link_sources',
        );
      }
      assert.equal(
        (
          await runtime.query(
            'SELECT count(*)::int n FROM fmv.measurement_comparisons WHERE set_id=$1::uuid',
            [incompleteId],
          )
        ).rows[0].n,
        0,
      );
      const first = make(0);
      assert.deepEqual(await confirm(first), { saved: true, revision: 1 });
      assert.deepEqual(
        await confirm({ ...first, members: [...refs].reverse() }),
        { saved: true, revision: 1 },
      );
      let current = await read();
      assert.equal(current.status, 'current');
      assert.equal(current.revision, 1);
      assert.equal(current.canConfirm, true);
      assert.equal(current.members.length, 2);
      assert.equal(current.measurements.length, 2);
      assert.ok(
        current.measurements.every(
          (m) => m.result.raw === '1.230000000000000001',
        ),
      );
      await assert.rejects(
        confirm({
          ...first,
          members: [refs[0], { ...refs[1], sourceRevision: 99 }],
        }),
        status(409),
      );
      await assert.rejects(confirm(make(0)), status(409));
      assert.equal(
        (
          await comparisons.read(
            principal,
            patient.id.toUpperCase(),
            setId.toUpperCase(),
          )
        ).status,
        'current',
      );
      // A failed audit must roll back both immutable ledger and source links.
      await owner.query(
        "CREATE FUNCTION fmv.synthetic_comparison_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='measurement.comparability_confirmed' AND NEW.patient_id::text=TG_ARGV[0] THEN RAISE EXCEPTION 'Synthetic audit failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$",
      );
      const rollbackId = randomUUID();
      try {
        await owner.query(
          `CREATE TRIGGER synthetic_comparison_audit_failure BEFORE INSERT ON fmv.document_events FOR EACH ROW EXECUTE FUNCTION fmv.synthetic_comparison_audit_failure('${patient.id}')`,
        );
        await assert.rejects(
          comparisons.confirm(principal, patient.id, rollbackId, make(0)),
          status(503),
        );
        assert.equal(
          (
            await runtime.query(
              'SELECT count(*)::int n FROM fmv.measurement_comparisons WHERE set_id=$1::uuid',
              [rollbackId],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await runtime.query(
              'SELECT count(*)::int n FROM fmv.comparison_sources WHERE set_id=$1::uuid',
              [rollbackId],
            )
          ).rows[0].n,
          0,
        );
      } finally {
        await owner.query(
          'DROP TRIGGER IF EXISTS synthetic_comparison_audit_failure ON fmv.document_events',
        );
        await owner.query(
          'DROP FUNCTION fmv.synthetic_comparison_audit_failure()',
        );
      }
      const revokeGrant = await insertGrant(owner, {
        patientId: patient.id,
        caregiverAccountId: readerAccountId,
        ownerAccountId,
      });
      await owner.query('BEGIN');
      let blocked;
      try {
        await owner.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('access-patient:'||$1::text,0))",
          [patient.id],
        );
        blocked = comparisons.read(reader, patient.id.toUpperCase(), setId);
        const settled = blocked.then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
          await owner.query('SELECT pg_stat_clear_snapshot()');
          waiting = (
            await owner.query(
              "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%') waiting",
            )
          ).rows[0].waiting;
          if (!waiting) await setTimeout(20);
        }
        assert.equal(
          waiting,
          true,
          'comparison read waits for shared access lock even with mixed-case UUID',
        );
        await owner.query(
          'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1::uuid',
          [revokeGrant.id],
        );
        await owner.query('COMMIT');
        const outcome = await settled;
        assert.ok('error' in outcome && status(404)(outcome.error));
      } catch (error) {
        await owner.query('ROLLBACK');
        if (blocked) await blocked.catch(() => {});
        throw error;
      }

      for (const invalid of [
        { ...refs[0], sourceRevision: 99 },
        { ...refs[0], reviewRevision: 99 },
        { ...refs[0], sourceSha256: 'b'.repeat(64) },
        { ...refs[0], lifecycleVersion: 99 },
        { ...refs[0], candidateId: 'page-1-block-999' },
      ])
        await assert.rejects(confirm(make(1, [invalid, refs[1]])), status(409));
      await assert.rejects(read(reader), status(404));
      const fixture = {
        patientId: patient.id,
        caregiverAccountId: readerAccountId,
        ownerAccountId,
      };
      const firstGrant = await insertGrant(runtime, fixture, {
        actions: ['view'],
        scopeKind: 'document',
        documentId: ids[0],
      });
      await assert.rejects(read(reader), status(404));
      const secondGrant = await insertGrant(runtime, fixture, {
        actions: ['view'],
        scopeKind: 'document',
        documentId: ids[1],
      });
      assert.equal((await read(reader)).status, 'current');
      assert.equal((await read(reader)).canConfirm, false);
      await assert.rejects(confirm(make(1), reader), status(404));
      await assert.rejects(
        withdraw(
          { requestId: randomUUID(), expectedRevision: 1, confirmed: true },
          reader,
        ),
        status(404),
      );
      await owner.query(
        'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1::uuid',
        [secondGrant.id],
      );
      await assert.rejects(read(reader), status(404));
      await assert.rejects(read(principal, recipient.id), status(404));
      const race = await Promise.allSettled([
        confirm(make(1)),
        concurrent.confirm(principal, patient.id, setId, make(1)),
      ]);
      assert.equal(race.filter((x) => x.status === 'fulfilled').length, 1);
      assert.equal(
        race.filter(
          (x) => x.status === 'rejected' && x.reason.getStatus?.() === 409,
        ).length,
        1,
      );
      const withdrawal = {
        requestId: randomUUID(),
        expectedRevision: 2,
        confirmed: true,
      };
      assert.deepEqual(await withdraw(withdrawal), {
        saved: true,
        revision: 3,
      });
      assert.deepEqual(await withdraw(withdrawal), {
        saved: true,
        revision: 3,
      });
      assert.equal((await read()).status, 'withdrawn');
      assert.deepEqual((await read()).measurements, []);
      await assert.rejects(confirm(first), status(409));
      assert.deepEqual(await confirm(make(3)), { saved: true, revision: 4 });
      const trashSetId = randomUUID();
      await comparisons.confirm(principal, patient.id, trashSetId, make(0));
      await service.changeTrash(principal, patient.id, ids[0], 'trash', {});
      assert.deepEqual(
        await comparisons.withdraw(principal, patient.id, trashSetId, {
          requestId: randomUUID(),
          expectedRevision: 1,
          confirmed: true,
        }),
        { saved: true, revision: 2 },
      );
      await assert.rejects(read(), status(404));
      await service.changeTrash(principal, patient.id, ids[0], 'restore', {});
      assert.equal((await read()).status, 'invalid');
      await assert.rejects(confirm(make(4)), status(409));
      await extraction(
        ids[0],
        'Test: Synthetic analyte\nResult: 1.230000000000000001\nUnit: synthetic/unit\nCollection date: 2024-02-29',
      );
      refs[0] = await confirmClinical(ids[0]);
      assert.deepEqual(await confirm(make(4)), { saved: true, revision: 5 });
      const clinical = await service.clinical.read(
        principal,
        patient.id,
        ids[1],
      );
      await service.clinical.withdraw(principal, patient.id, ids[1], {
        requestId: randomUUID(),
        expectedRevision: clinical.context.revision,
        sourceSha256: clinical.context.sourceSha256,
        lifecycleVersion: clinical.context.lifecycleVersion,
        confirmed: true,
        candidateIds: [refs[1].candidateId],
      });
      assert.equal((await read()).status, 'invalid');
      assert.deepEqual((await read()).measurements, []);
      await assert.rejects(confirm(make(5)), status(409));
      refs[1] = await confirmClinical(ids[1]);
      assert.deepEqual(await confirm(make(5)), { saved: true, revision: 6 });
      await extraction(
        ids[1],
        'Test: Synthetic analyte\nResult: 2\nUnit: synthetic/unit',
      );
      assert.equal((await read()).status, 'invalid');
      assert.deepEqual((await read()).measurements, []);
      await assert.rejects(confirm(make(6)), status(409));
      for (const members of [
        refs,
        [],
        [refs[0]],
        [refs[0], refs[0]],
        [{ ...refs[0], candidateId: 'page-51-block-1' }, refs[1]],
        [{ ...refs[0], sourceSha256: 'A'.repeat(64) }, refs[1]],
        [{ ...refs[0], lifecycleVersion: -1 }, refs[1]],
        [{ ...refs[0], extra: true }, refs[1]],
      ]) {
        const sql = (
          await runtime.query(
            'SELECT fmv.comparison_members_valid($1::jsonb) valid',
            [JSON.stringify(members)],
          )
        ).rows[0].valid;
        assert.equal(sql, isMeasurementComparisonMembers(members));
      }
      for (const table of ['measurement_comparisons', 'comparison_sources']) {
        const flags = (
          await runtime.query(
            'SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2',
            ['fmv', table],
          )
        ).rows[0];
        assert.deepEqual(flags, {
          relrowsecurity: true,
          relforcerowsecurity: true,
        });
        const privileges = (
          await runtime.query(
            "SELECT has_table_privilege(current_user,$1,'SELECT') s,has_table_privilege(current_user,$1,'INSERT') i,has_table_privilege(current_user,$1,'UPDATE') u,has_table_privilege(current_user,$1,'DELETE') d",
            [`fmv.${table}`],
          )
        ).rows[0];
        assert.deepEqual(privileges, { s: true, i: true, u: false, d: false });
        await assert.rejects(
          runtime.query(`DELETE FROM fmv.${table}`),
          (e) => e.code === '42501',
        );
      }
      // Existing original-retention/audit FKs deliberately block physical purge
      // until P6. Exercise the exact source-link deletion path that a future
      // authorized original purge will cascade, without weakening those FKs.
      const cascade = await owner.query(
        "SELECT confdeltype FROM pg_constraint WHERE conrelid='fmv.comparison_sources'::regclass AND confrelid='fmv.documents'::regclass",
      );
      assert.equal(cascade.rows[0].confdeltype, 'c');
      await owner.query(
        'DELETE FROM fmv.comparison_sources WHERE document_id=$1::uuid',
        [ids[0]],
      );
      assert.equal(
        (
          await runtime.query(
            'SELECT count(*)::int n FROM fmv.measurement_comparisons WHERE set_id=$1::uuid',
            [setId],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await runtime.query(
            'SELECT count(*)::int n FROM fmv.comparison_sources WHERE set_id=$1::uuid',
            [setId],
          )
        ).rows[0].n,
        0,
      );
      await owner.query(
        'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1::uuid',
        [firstGrant.id],
      );
    } finally {
      await comparisons.onModuleDestroy();
      await concurrent.onModuleDestroy();
    }
  } finally {
    await runtime.end();
    await other.onModuleDestroy();
    await store.onModuleDestroy();
    await access.onModuleDestroy();
    await people.onModuleDestroy();
  }
}
