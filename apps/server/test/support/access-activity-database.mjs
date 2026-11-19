import { CaregiverService } from '../../dist/access/caregiver.service.js';
import { retainOrdinaryAccess } from '../../../../infra/scripts/access-history-retention.mjs';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { PrismaPersonStore } from '../../dist/identity/person.store.js';
import { PrismaDocumentStore } from '../../dist/documents/document.store.js';
import { PrismaAccessStore } from '../../dist/access/access.store.js';
import { PermissionService } from '../../dist/access/permission.service.js';
import { DocumentIntake } from '../../dist/documents/intake.js';
import { MemoryObjectStore } from '../../dist/documents/memory-object-store.js';
import { TemporaryLinksService } from '../../dist/sharing/temporary-links.service.js';
import { OriginalExportService } from '../../dist/documents/original-export.service.js';
import { DocumentsService } from '../../dist/documents/documents.service.js';
import { AccessActivityService } from '../../dist/activity/access-activity.service.js';
export async function verifyAccessActivity(runtimeUrl, owner) {
  const runtime = new pg.Client({ connectionString: runtimeUrl.href }),
    people = new PrismaPersonStore(runtimeUrl.href),
    store = new PrismaDocumentStore(runtimeUrl.href),
    access = new PrismaAccessStore(runtimeUrl.href),
    service = new AccessActivityService(runtimeUrl.href),
    objects = new MemoryObjectStore(),
    links = new TemporaryLinksService(runtimeUrl.href, objects);
  await runtime.connect();
  try {
    const principal = {
        issuer: 'https://activity.example.test',
        subject: randomUUID(),
      },
      delegate = { ...principal, subject: randomUUID() },
      patient = await people.create(principal, 'SYNTHETIC activity owner'),
      other = await people.create(delegate, 'SYNTHETIC activity reader');
    const actor = (
        await runtime.query(
          'SELECT owner_account_id id FROM fmv.persons WHERE id=$1',
          [patient.id],
        )
      ).rows[0].id,
      reader = (
        await runtime.query(
          'SELECT owner_account_id id FROM fmv.persons WHERE id=$1',
          [other.id],
        )
      ).rows[0].id;
    const status = (n) => (e) => e.getStatus?.() === n;
    await assert.rejects(service.read(delegate, patient.id), status(404));
    await runtime.query(
      "INSERT INTO fmv.access_grants(id,patient_id,grantee_account_id,issuer_account_id,actions,scope_kind) VALUES($1,$2,$3,$4,ARRAY['view','manage'],'patient')",
      [randomUUID(), patient.id, reader, actor],
    );
    await assert.rejects(service.read(delegate, patient.id), status(404));
    assert.equal((await service.read(principal, patient.id)).events.length, 0);
    const bytes = Buffer.from('%PDF-1.7\nSYNTHETIC activity fixture\n%%EOF'),
      intake = new DocumentIntake(store.asActor(actor), objects),
      permissions = new PermissionService(access),
      auth = (p, a, t) => permissions.require(principal, p, a, t);
    const up = await intake.begin(
      patient.id,
      {
        title: 'SYNTHETIC private title.pdf',
        mimeType: 'application/pdf',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        idempotencyKey: randomUUID(),
      },
      auth,
    );
    await intake.content(patient.id, up.uploadId, bytes, auth);
    await intake.finalize(patient.id, up.uploadId, auth);
    const otherIntake = new DocumentIntake(store.asActor(reader), objects),
      otherAuth = (p, a, t) => permissions.require(delegate, p, a, t);
    const otherUpload = await otherIntake.begin(
      other.id,
      {
        title: 'SYNTHETIC other patient.pdf',
        mimeType: 'application/pdf',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        idempotencyKey: randomUUID(),
      },
      otherAuth,
    );
    await otherIntake.content(other.id, otherUpload.uploadId, bytes, otherAuth);
    await otherIntake.finalize(other.id, otherUpload.uploadId, otherAuth);
    const wrongResource = randomUUID();
    await owner.query(
      "INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) VALUES($1,$2,$3,$4,'document.viewed')",
      [wrongResource, patient.id, otherUpload.documentId, actor],
    );
    await assert.rejects(service.read(principal, other.id), status(404));
    const insert = async (
      kind,
      account = actor,
      at = new Date(Date.now() - 1000),
      ret = new Date(Date.now() + 86400000),
    ) => {
      const id = randomUUID();
      await owner.query(
        'INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind,occurred_at,retention_until) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [id, patient.id, up.documentId, account, kind, at, ret],
      );
      return id;
    };
    const expired = await insert(
        'document.viewed',
        actor,
        new Date(Date.now() - 91 * 86400000),
      ),
      future = await insert(
        'document.viewed',
        actor,
        new Date(Date.now() + 86400000),
      ),
      deadline = await insert(
        'document.viewed',
        actor,
        new Date(Date.now() - 10000),
        new Date(Date.now() - 1000),
      );
    const same = new Date(Date.now() - 2000),
      ids = [];
    for (let i = 0; i < 26; i++)
      ids.push(
        await insert(
          i % 2 ? 'document.viewed' : 'document.exported',
          i % 3 ? actor : reader,
          same,
        ),
      );
    const exporter = new OriginalExportService(
      runtimeUrl.href,
      new DocumentsService(permissions, store, objects),
    );
    const preview = await exporter.prepare(principal, patient.id, {
      documentIds: [up.documentId],
    });
    await exporter.onModuleDestroy();
    const share = await links.create(principal, patient.id, {
      documentIds: [up.documentId],
      requestId: randomUUID(),
      expiresInHours: 1,
      selectionSha256: preview.snapshotSha256,
      confirmed: true,
    });
    await links.inspect(share.token);
    await links.readOriginal(
      share.token,
      up.documentId,
      new globalThis.AbortController().signal,
    );
    let page = await service.read(principal, patient.id),
      all = [...page.events],
      count = 0;
    assert.equal(page.events.length, 20);
    assert.ok(page.nextCursor);
    while (page.nextCursor) {
      assert.ok(++count < 5);
      page = await service.read(principal, patient.id, page.nextCursor);
      all.push(...page.events);
    }
    assert.equal(new Set(all.map((e) => e.source + e.id)).size, all.length);
    assert.equal(all.filter((e) => ids.includes(e.id)).length, 26);
    for (const id of [expired, future, deadline, wrongResource])
      assert.ok(!all.some((e) => e.id === id));
    assert.ok(all.some((e) => e.actor === 'you'));
    assert.ok(all.some((e) => e.actor === 'authenticated-account'));
    assert.ok(
      all.some(
        (e) => e.actor === 'anonymous-link-holder' && e.kind === 'link.opened',
      ),
    );
    assert.ok(
      all.some((e) => e.documentLabel === 'SYNTHETIC private title.pdf'),
    );
    assert.ok(!JSON.stringify(all).includes(principal.subject));
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1],
        b = all[i];
      assert.ok(
        a.recordedAt > b.recordedAt ||
          (a.recordedAt === b.recordedAt &&
            (a.source > b.source || (a.source === b.source && a.id > b.id))),
      );
    }
    await runtime.query('BEGIN');
    await runtime.query('SET LOCAL enable_seqscan=off');
    const plan = await runtime.query(
      'EXPLAIN (FORMAT JSON) SELECT id FROM fmv.document_events WHERE patient_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 21',
      [patient.id],
    );
    assert.match(JSON.stringify(plan.rows), /document_events_patient_time/);
    await runtime.query('ROLLBACK');
    const before = (
      await runtime.query(
        'SELECT count(*) n FROM fmv.document_events WHERE patient_id=$1',
        [patient.id],
      )
    ).rows[0].n;
    await service.read(principal, patient.id);
    assert.equal(
      (
        await runtime.query(
          'SELECT count(*) n FROM fmv.document_events WHERE patient_id=$1',
          [patient.id],
        )
      ).rows[0].n,
      before,
      'Reading activity does not generate document-view events',
    );
    const cursor = (await service.read(principal, patient.id)).nextCursor;
    await assert.rejects(service.read(delegate, other.id, cursor), status(400));
    await assert.rejects(
      runtime.query('DELETE FROM fmv.document_events WHERE patient_id=$1', [
        patient.id,
      ]),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      service.read({ ...principal, subject: randomUUID() }, patient.id),
      status(404),
    );
    const realOwner = service.owner.bind(service);
    let checks = 0;
    service.owner = async (...args) => {
      const result = await realOwner(...args);
      return ++checks === 2 ? randomUUID() : result;
    };
    await assert.rejects(service.read(principal, patient.id), status(404));
    // SEC-04: only ordinary events after BOTH age and deadline expire.
    const old = new Date(Date.now() - 91 * 86400000),
      ended = new Date(Date.now() - 86400000);
    const oldView = await insert('document.viewed', actor, old, ended),
      oldExport = await insert('document.exported', actor, old, ended),
      critical = await insert('document.uploaded', actor, old, ended),
      recent = await insert(
        'document.viewed',
        actor,
        new Date(Date.now() - 1000),
        ended,
      );
    const oldLink = randomUUID();
    await owner.query(
      "INSERT INTO fmv.temporary_link_access_events(id,link_id,kind,recorded_at,retention_until) VALUES($1,$2,'link.opened',$3,$4)",
      [oldLink, share.link.id, old, new Date(old.getTime() + 90 * 86400000)],
    );
    const exists = async (table, id) =>
      (
        await owner.query(
          `SELECT count(*)::int n FROM fmv.${table} WHERE id=$1`,
          [id],
        )
      ).rows[0].n === 1;
    const dry = await retainOrdinaryAccess(owner, { batchSize: 1 });
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.documentAccess.eligible, 1);
    assert.equal(dry.documentAccess.limited, true);
    assert.ok(await exists('document_events', oldView));
    assert.ok(await exists('temporary_link_access_events', oldLink));
    await assert.rejects(
      retainOrdinaryAccess(runtime, { apply: true }),
      /maintenance connection/,
    );
    assert.ok(await exists('document_events', oldView));
    const broken = {
      query: (sql, args) =>
        sql.startsWith('WITH candidates') &&
        sql.includes('DELETE FROM fmv.temporary_link_access_events')
          ? Promise.reject(Error('synthetic maintenance failure'))
          : owner.query(sql, args),
    };
    await assert.rejects(
      retainOrdinaryAccess(broken, { apply: true }),
      /synthetic maintenance failure/,
    );
    assert.ok(await exists('document_events', oldView));
    assert.ok(await exists('temporary_link_access_events', oldLink));
    const contender = new pg.Client({
      host: owner.host,
      port: owner.port,
      user: owner.user,
      password: owner.password,
      database: owner.database,
      ssl: owner.ssl,
      connectionTimeoutMillis: 5000,
    });
    await contender.connect();
    await owner.query(
      "SELECT pg_advisory_lock(hashtextextended('fmv-ordinary-access-retention-v1',0))",
    );
    try {
      assert.equal(
        (await retainOrdinaryAccess(contender, { apply: true })).busy,
        true,
      );
    } finally {
      await owner.query(
        "SELECT pg_advisory_unlock(hashtextextended('fmv-ordinary-access-retention-v1',0))",
      );
      await contender.end();
    }
    const pass = await retainOrdinaryAccess(owner, {
      apply: true,
      batchSize: 1,
    });
    assert.equal(pass.documentAccess, 1);
    assert.equal(pass.anonymousLinkAccess, 1);
    assert.equal(await exists('temporary_link_access_events', oldLink), false);
    await retainOrdinaryAccess(owner, { apply: true });
    assert.equal(await exists('document_events', oldView), false);
    assert.equal(await exists('document_events', oldExport), false);
    for (const keep of [critical, recent, expired, deadline])
      assert.ok(
        await exists('document_events', keep),
        'Critical, young and unexpired-deadline records remain',
      );
    const again = await retainOrdinaryAccess(owner, { apply: true });
    assert.equal(again.documentAccess, 0);
    assert.equal(again.anonymousLinkAccess, 0);

    service.owner = realOwner;
    const grant = (
      await runtime.query(
        'SELECT id FROM fmv.access_grants WHERE patient_id=$1 AND grantee_account_id=$2',
        [patient.id, reader],
      )
    ).rows[0].id;
    const caregiverService = new CaregiverService(runtimeUrl.href);
    try {
      await caregiverService.revoke(principal, patient.id, grant);
    } finally {
      await caregiverService.onModuleDestroy();
    }
    await links.revoke(principal, patient.id, share.link.id);
    const securityIds = [];
    for (let i = 0; i < 24; i++) {
      const id = randomUUID();
      securityIds.push(id);
      await owner.query(
        "INSERT INTO fmv.access_events(id,patient_id,actor_account_id,kind,grant_id,occurred_at) VALUES($1,$2,$3,'grant.created',$4,$5)",
        [id, patient.id, i % 2 ? actor : reader, grant, old],
      );
    }
    let changes = await service.readChanges(principal, patient.id),
      changed = [...changes.events],
      pages = 0;
    assert.equal(changes.events.length, 20);
    while (changes.nextCursor) {
      assert.ok(++pages < 5);
      changes = await service.readChanges(
        principal,
        patient.id,
        changes.nextCursor,
      );
      changed.push(...changes.events);
    }
    assert.equal(
      changed.filter((e) => securityIds.includes(e.id)).length,
      24,
      'Critical events older than90 days remain visible separately',
    );
    for (const kind of [
      'grant.created',
      'grant.revoked',
      'link.created',
      'link.revoked',
    ])
      assert.ok(changed.some((e) => e.kind === kind));
    assert.equal(
      new Set(changed.map((e) => e.source + e.id)).size,
      changed.length,
    );
    assert.ok(!JSON.stringify(changed).includes(share.token));
    assert.ok(!JSON.stringify(changed).includes('private title'));
    await assert.rejects(
      service.readChanges(delegate, patient.id),
      status(404),
    );
    await assert.rejects(service.readChanges(principal, other.id), status(404));
    await retainOrdinaryAccess(owner, { apply: true });
    assert.equal(
      (
        await owner.query(
          'SELECT count(*)::int n FROM fmv.access_events WHERE id=ANY($1::uuid[])',
          [securityIds],
        )
      ).rows[0].n,
      24,
    );
    let securityChecks = 0;
    service.owner = async (...args) => {
      const id = await realOwner(...args);
      return ++securityChecks === 2 ? randomUUID() : id;
    };
    await assert.rejects(
      service.readChanges(principal, patient.id),
      status(404),
    );
    service.owner = realOwner;
  } finally {
    await Promise.allSettled([
      runtime.end(),
      people.onModuleDestroy(),
      store.onModuleDestroy(),
      access.onModuleDestroy(),
      service.onModuleDestroy(),
      links.onModuleDestroy(),
    ]);
  }
}
