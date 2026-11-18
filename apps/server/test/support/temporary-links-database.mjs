import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import {
  TemporaryLinksService,
  hashTemporaryLink,
} from '../../dist/sharing/temporary-links.service.js';
export async function verifyTemporaryLinks(f) {
  const {
    runtimeUrl,
    owner,
    runtime,
    principal,
    reader,
    patient,
    service,
    intake,
    authorize,
    bytes,
    categoryId,
  } = f;
  const links = new TemporaryLinksService(runtimeUrl.href, service.objects),
    other = new TemporaryLinksService(runtimeUrl.href),
    status = (n) => (e) => e.getStatus?.() === n;
  const upload = await intake.begin(
    patient.id,
    {
      title: 'SYNTHETIC link original.pdf',
      mimeType: 'application/pdf',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      idempotencyKey: randomUUID(),
      categoryId,
    },
    authorize,
  );
  await intake.content(patient.id, upload.uploadId, bytes, authorize);
  await intake.finalize(patient.id, upload.uploadId, authorize);
  const id = upload.documentId,
    selection = { documentIds: [id] },
    prepare = () => links.prepare(principal, patient.id, selection),
    body = (p) => ({
      requestId: randomUUID(),
      documentIds: [id],
      selectionSha256: p.snapshotSha256,
      expiresInHours: 1,
      confirmed: true,
    });
  try {
    await assert.rejects(
      links.prepare(reader, patient.id, selection),
      status(404),
    );
    const input = body(await prepare());
    const [a, b] = await Promise.all([
      links.create(principal, patient.id, input),
      other.create(principal, patient.id, input),
    ]);
    const created = a.created ? a : b,
      replay = a.created ? b : a;
    assert.equal(created.created, true);
    assert.equal(replay.created, false);
    assert.equal(replay.token, null);
    assert.equal(replay.link.id, created.link.id);
    assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
    const stored = (
      await runtime.query(
        'SELECT token_sha256,source_snapshot FROM fmv.temporary_links WHERE id=$1::uuid',
        [created.link.id],
      )
    ).rows[0];
    assert.equal(stored.token_sha256, hashTemporaryLink(created.token));
    assert.ok(!JSON.stringify(stored).includes(created.token));
    assert.equal(stored.source_snapshot.length, 1);
    assert.equal(stored.source_snapshot[0].id, id);
    const ownerEventsBefore = (
      await runtime.query(
        'SELECT count(*)::int n FROM fmv.document_events WHERE document_id=$1::uuid',
        [id],
      )
    ).rows[0].n;
    assert.deepEqual(
      (
        await links.readOriginal(
          created.token,
          id,
          new globalThis.AbortController().signal,
        )
      ).bytes,
      bytes,
    );
    assert.equal(
      (
        await runtime.query(
          'SELECT count(*)::int n FROM fmv.document_events WHERE document_id=$1::uuid',
          [id],
        )
      ).rows[0].n,
      ownerEventsBefore,
    );
    assert.equal(
      (
        await runtime.query(
          "SELECT count(*)::int n FROM fmv.temporary_link_access_events WHERE link_id=$1::uuid AND kind='original.accessed'",
          [created.link.id],
        )
      ).rows[0].n,
      1,
    );
    await assert.rejects(
      links.readOriginal(
        created.token,
        f.id,
        new globalThis.AbortController().signal,
      ),
      status(404),
    );

    await assert.rejects(
      runtime.query(
        `INSERT INTO fmv.temporary_links(id,patient_id,creator_account_id,patient_name,request_id,payload_sha256,token_sha256,selection_sha256,source_snapshot,expires_at) SELECT $2::uuid,patient_id,$3::uuid,patient_name,$4::uuid,payload_sha256,$5,selection_sha256,source_snapshot,expires_at FROM fmv.temporary_links WHERE id=$1::uuid`,
        [
          created.link.id,
          randomUUID(),
          f.readerAccountId,
          randomUUID(),
          'f'.repeat(64),
        ],
      ),
      (e) => e.code === '23514',
    );
    await assert.rejects(
      runtime.query(
        "INSERT INTO fmv.temporary_link_access_events(id,link_id,document_id,kind) VALUES($1::uuid,$2::uuid,$3::uuid,'original.accessed')",
        [randomUUID(), created.link.id, f.id],
      ),
      (e) => e.code === '23514',
    );

    await assert.rejects(
      links.create(principal, patient.id, { ...input, expiresInHours: 2 }),
      status(409),
    );
    await assert.rejects(
      links.create(reader, patient.id, body(await prepare())),
      status(404),
    );
    assert.equal(
      (await links.inspect(created.token)).selection.files[0].id,
      id,
    );
    assert.ok(
      !JSON.stringify(await links.list(principal, patient.id)).includes(
        created.token,
      ),
    );
    const activity = await links.activity(
      principal,
      patient.id,
      created.link.id,
    );
    assert.ok(
      activity.events.some(
        (e) => e.kind === 'original.accessed' && e.documentId === id,
      ),
    );
    assert.ok(activity.events.some((e) => e.kind === 'link.opened'));
    await assert.rejects(
      links.activity(reader, patient.id, created.link.id),
      status(404),
    );
    await assert.rejects(links.inspect('bad'), status(404));
    await assert.rejects(links.inspect('x'.repeat(43)), status(404));
    await assert.rejects(
      links.revoke(reader, patient.id, created.link.id),
      status(404),
    );
    await owner.query(
      "CREATE FUNCTION fmv.synthetic_link_access_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic private access audit failure'; END $$",
    );
    await owner.query(
      'CREATE TRIGGER synthetic_link_access_failure BEFORE INSERT ON fmv.temporary_link_access_events FOR EACH ROW EXECUTE FUNCTION fmv.synthetic_link_access_failure()',
    );
    try {
      await assert.rejects(links.inspect(created.token), status(503));
    } finally {
      await owner.query(
        'DROP TRIGGER synthetic_link_access_failure ON fmv.temporary_link_access_events',
      );
      await owner.query('DROP FUNCTION fmv.synthetic_link_access_failure()');
    }
    await links.revoke(principal, patient.id, created.link.id);
    await links.revoke(principal, patient.id, created.link.id);
    await assert.rejects(links.inspect(created.token), status(404));
    const lifecycle = await links.create(
      principal,
      patient.id,
      body(await prepare()),
    );
    await service.changeTrash(principal, patient.id, id, 'trash', {});
    await assert.rejects(links.inspect(lifecycle.token), status(404));
    await service.changeTrash(principal, patient.id, id, 'restore', {});
    await assert.rejects(links.inspect(lifecycle.token), status(404));
    assert.equal(
      (await links.list(principal, patient.id)).links.find(
        (l) => l.id === lifecycle.link.id,
      ).state,
      'source-invalid',
    );
    const expiry = await links.create(
      principal,
      patient.id,
      body(await prepare()),
    );
    // Controlled owner-side fixture time travel; runtime cannot alter expiry or bypass the guard.
    await owner.query(
      'ALTER TABLE fmv.temporary_links DISABLE TRIGGER temporary_link_guard',
    );
    try {
      await owner.query(
        "UPDATE fmv.temporary_links SET created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1::uuid",
        [expiry.link.id],
      );
    } finally {
      await owner.query(
        'ALTER TABLE fmv.temporary_links ENABLE TRIGGER temporary_link_guard',
      );
    }
    await assert.rejects(links.inspect(expiry.token), status(404));
    const delivery = await links.create(
        principal,
        patient.id,
        body(await prepare()),
      ),
      objects = links.objects;
    links.objects = {
      ready: true,
      get: async (key) => {
        const result = await objects.get(key);
        await other.revoke(principal, patient.id, delivery.link.id);
        return result;
      },
    };
    try {
      await assert.rejects(
        links.readOriginal(
          delivery.token,
          id,
          new globalThis.AbortController().signal,
        ),
        status(404),
      );
    } finally {
      links.objects = objects;
    }
    const intact = await links.create(
      principal,
      patient.id,
      body(await prepare()),
    );
    links.objects = {
      ready: true,
      get: async (key) => (await objects.get(key)).subarray(1),
    };
    try {
      await assert.rejects(
        links.readOriginal(
          intact.token,
          id,
          new globalThis.AbortController().signal,
        ),
        status(503),
      );
    } finally {
      links.objects = objects;
    }
    for (const sql of [
      'DELETE FROM fmv.temporary_links',
      'TRUNCATE fmv.temporary_links',
      'UPDATE fmv.temporary_links SET expires_at=clock_timestamp()',
      'UPDATE fmv.temporary_link_access_events SET kind=kind',
      'DELETE FROM fmv.temporary_link_access_events',
    ])
      await assert.rejects(runtime.query(sql), (e) => e.code === '42501');
    await assert.rejects(
      runtime.query(
        'UPDATE fmv.temporary_links SET revoked_at=NULL,revoker_account_id=NULL WHERE id=$1::uuid',
        [created.link.id],
      ),
      (e) => e.code === '23514',
    );
  } finally {
    await links.onModuleDestroy();
    await other.onModuleDestroy();
  }
}
