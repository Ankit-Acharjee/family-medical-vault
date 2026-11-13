import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import pg from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaPersonStore } from '../../dist/identity/person.store.js';
import { PrismaAccessStore } from '../../dist/access/access.store.js';
import { PermissionService } from '../../dist/access/permission.service.js';
import { PrismaDocumentStore } from '../../dist/documents/document.store.js';
import { DocumentsService } from '../../dist/documents/documents.service.js';
import { DocumentIntake } from '../../dist/documents/intake.js';
import { MemoryObjectStore } from '../../dist/documents/memory-object-store.js';

export async function verifyExtractionSearch(runtimeUrl, owner, insertGrant) {
  const runtime = new pg.Client({ connectionString: runtimeUrl.href });
  const people = new PrismaPersonStore(runtimeUrl.href);
  const access = new PrismaAccessStore(runtimeUrl.href);
  const store = new PrismaDocumentStore(runtimeUrl.href);
  await runtime.connect();
  try {
    const principal = {
      issuer: 'https://search.example.test',
      subject: randomUUID(),
    };
    const reader = { ...principal, subject: randomUUID() };
    const patient = await people.create(principal, 'Synthetic search owner');
    const recipient = await people.create(reader, 'Synthetic search reader');
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
    const authorize = (p, a, t) => permissions.require(principal, p, a, t);
    const bytes = Buffer.from('%PDF-1.7\nSynthetic search original\n%%EOF');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const categoryId = randomUUID();
    await owner.query(
      "INSERT INTO fmv.document_categories(id,slug,name) VALUES ($1::uuid,$2,'Synthetic search category')",
      [categoryId, randomUUID()],
    );
    const makeResult = (pages) => ({
      method: 'pdf-text',
      engineVersion: 'pdfjs-6.5.438',
      pages: pages.map((text, i) => ({ page: i + 1, text })),
      partial: false,
      partialReason: null,
      downsized: false,
    });
    const save = async (id, pages) => {
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
        result: makeResult(pages),
      });
    };
    const add = async (pages, category) => {
      const d = await intake.begin(
        patient.id,
        {
          title: 'Synthetic original.pdf',
          mimeType: 'application/pdf',
          bytes: bytes.length,
          sha256,
          idempotencyKey: randomUUID(),
          ...(category ? { categoryId: category } : {}),
        },
        authorize,
      );
      await intake.content(patient.id, d.uploadId, bytes, authorize);
      await intake.finalize(patient.id, d.uploadId, authorize);
      await save(d.documentId, pages);
      return d.documentId;
    };
    const first = await add(
      ['ALPHA marker <script>unsafe</script> café', 'beta delta'],
      categoryId,
    );
    const second = await add(['alpha only']);
    const search = (query, extra = {}) =>
      service.search(principal, patient.id, { query, ...extra });
    assert.deepEqual(
      await search('alpha beta'),
      { documentIds: [first], truncated: false },
      'Terms match across pages',
    );
    assert.deepEqual(
      await search('pdfjs'),
      { documentIds: [], truncated: false },
      'Engine metadata is not indexed',
    );
    assert.deepEqual(await search('!!!'), {
      documentIds: [],
      truncated: false,
    });
    assert.deepEqual(await search('café'), {
      documentIds: [first],
      truncated: false,
    });
    assert.deepEqual(
      await search('alp'),
      { documentIds: [], truncated: false },
      'No implicit prefixes',
    );
    assert.deepEqual(await search('alpha', { categoryId }), {
      documentIds: [first],
      truncated: false,
    });
    const at = (
      await runtime.query(
        'SELECT created_at FROM fmv.documents WHERE id=$1::uuid',
        [first],
      )
    ).rows[0].created_at.toISOString();
    assert.deepEqual(await search('alpha', { categoryId, uploadedFrom: at }), {
      documentIds: [first],
      truncated: false,
    });
    assert.deepEqual(
      await search('alpha', { categoryId, uploadedBefore: at }),
      { documentIds: [], truncated: false },
    );
    await save(first, ['replacement omega']);
    assert.deepEqual(await search('alpha beta'), {
      documentIds: [],
      truncated: false,
    });
    assert.deepEqual(await search('omega'), {
      documentIds: [first],
      truncated: false,
    });
    await service.changeTrash(principal, patient.id, first, 'trash', {});
    assert.deepEqual(await search('omega'), {
      documentIds: [],
      truncated: false,
    });
    await service.changeTrash(principal, patient.id, first, 'restore', {});
    assert.deepEqual(
      await search('omega'),
      { documentIds: [first], truncated: false },
      'Restored text stays searchable despite lifecycle fence increment',
    );
    const grant = (actions, documentId) =>
      insertGrant(
        runtime,
        {
          patientId: patient.id,
          caregiverAccountId: readerAccountId,
          ownerAccountId,
        },
        { actions, scopeKind: 'document', documentId },
      );
    const exportGrant = await grant(['export'], first);
    assert.deepEqual(
      await service.search(reader, patient.id, { query: 'omega' }),
      { documentIds: [], truncated: false },
    );
    const viewGrant = await grant(['view'], second);
    assert.deepEqual(
      await service.search(reader, patient.id, { query: 'alpha' }),
      { documentIds: [second], truncated: false },
    );
    assert.deepEqual(
      await service.search(reader, patient.id, { query: 'omega' }),
      { documentIds: [], truncated: false },
    );
    await runtime.query(
      'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1::uuid',
      [viewGrant.id],
    );
    assert.deepEqual(
      await service.search(reader, patient.id, { query: 'alpha' }),
      { documentIds: [], truncated: false },
    );
    await assert.rejects(
      () => service.search(reader, randomUUID(), { query: 'omega' }),
      (e) => e.getStatus?.() === 404,
    );
    const before = (
      await runtime.query(
        "SELECT count(*)::int n FROM fmv.document_events WHERE document_id=$1::uuid AND kind='document.viewed'",
        [first],
      )
    ).rows[0].n;
    await assert.rejects(() =>
      store.searchExtractions(
        patient.id,
        { query: 'omega' },
        [first],
        async () => {
          throw new Error('synthetic denied');
        },
      ),
    );
    assert.equal(
      (
        await runtime.query(
          "SELECT count(*)::int n FROM fmv.document_events WHERE document_id=$1::uuid AND kind='document.viewed'",
          [first],
        )
      ).rows[0].n,
      before,
    );
    let checks = 0;
    await assert.rejects(() =>
      store.searchExtractions(
        patient.id,
        { query: 'omega' },
        [first],
        async () => {
          if (++checks === 2) throw new Error('synthetic revoked');
          return ownerAccountId;
        },
      ),
    );
    assert.equal(
      (
        await runtime.query(
          "SELECT count(*)::int n FROM fmv.document_events WHERE document_id=$1::uuid AND kind='document.viewed'",
          [first],
        )
      ).rows[0].n,
      before,
      'Final authorization failure rolls back audits',
    );
    await assert.rejects(
      () =>
        runtime.query(
          "UPDATE fmv.document_extractions SET search_terms=ARRAY['forged'] WHERE document_id=$1::uuid",
          [first],
        ),
      (e) => ['42501', '428C9'].includes(e.code),
    );
    // Maximum allowed high-cardinality page never constructs an oversized tsvector.
    const maximum = Array.from(
      { length: 60000 },
      (_, i) => `w${i.toString(36).padStart(6, '0')}`,
    ).join(' ');
    assert.ok(maximum.length <= 500000);
    await save(first, [maximum]);
    assert.deepEqual(await search('w000000 w001aan'), {
      documentIds: [first],
      truncated: false,
    });
    assert.deepEqual(await search('w000000'), {
      documentIds: [first],
      truncated: false,
    });
    const tokens = Array.from(
      { length: 125000 },
      (_, i) =>
        '中' +
        String.fromCharCode(0x4e00 + (i % 20000)) +
        String.fromCharCode(0x4e00 + Math.floor(i / 20000)),
    );
    const unicodeMaximum = tokens.join(' ') + ' ';
    assert.equal(unicodeMaximum.length, 500000);
    await save(first, [unicodeMaximum]);
    assert.deepEqual(
      await search(tokens[0] + ' ' + tokens.at(-1)),
      { documentIds: [first], truncated: false },
      'Maximum accepted Unicode extraction indexes all words without tsvector overflow',
    );
    assert.deepEqual(
      (
        await runtime.query(
          'SELECT sha256 FROM fmv.documents WHERE id=$1::uuid',
          [first],
        )
      ).rows[0].sha256,
      sha256,
    );
    await save(first, ['z'.repeat(3000) + ' accepted']);
    assert.deepEqual(
      await search('accepted'),
      { documentIds: [first], truncated: false },
      'Ignored long lexeme cannot break saving',
    );
    // Real concurrent access: search locks the active original until its audit
    // and final authority check commit; Trash and replacement wait behind it.
    for (const action of ['trash', 'save']) {
      let acquired, release;
      const locked = new Promise((resolve) => {
        acquired = resolve;
      });
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      let calls = 0,
        completed = false;
      const pendingSearch = store.searchExtractions(
        patient.id,
        { query: 'accepted' },
        [first],
        async () => {
          if (++calls === 1) {
            acquired();
            await gate;
          }
          return ownerAccountId;
        },
      );
      await locked;
      const pendingChange = (
        action === 'trash'
          ? service.changeTrash(principal, patient.id, first, 'trash', {})
          : save(first, ['serialized replacement'])
      ).then((value) => {
        completed = true;
        return value;
      });
      try {
        await delay(75);
        assert.equal(completed, false);
      } finally {
        release();
      }
      assert.deepEqual(await pendingSearch, {
        documentIds: [first],
        truncated: false,
      });
      await pendingChange;
      if (action === 'trash') {
        assert.deepEqual(await search('accepted'), {
          documentIds: [],
          truncated: false,
        });
        await service.changeTrash(principal, patient.id, first, 'restore', {});
      } else {
        assert.deepEqual(await search('accepted'), {
          documentIds: [],
          truncated: false,
        });
        assert.deepEqual(await search('serialized'), {
          documentIds: [first],
          truncated: false,
        });
      }
    }
    // Cap and sentinel are based only on filtered View-authorized hits.
    const many = [];
    for (let i = 0; i < 202; i++)
      many.push(await add(['capmarker'], categoryId));
    const capped = await search('capmarker');
    assert.equal(capped.documentIds.length, 200);
    assert.equal(capped.truncated, true);
    const ordered = (
      await runtime.query(
        'SELECT id FROM fmv.documents WHERE patient_id=$1::uuid AND id=ANY($2::uuid[]) ORDER BY created_at DESC,id ASC LIMIT 200',
        [patient.id, many],
      )
    ).rows.map((r) => r.id);
    assert.deepEqual(capped.documentIds, ordered);
    const last = many[0];
    await grant(['view'], last);
    assert.deepEqual(
      await service.search(reader, patient.id, { query: 'capmarker' }),
      { documentIds: [last], truncated: false },
      'Unauthorized matches never influence truncation',
    );
    const totalAudits = (
      await runtime.query(
        "SELECT count(*)::int n FROM fmv.document_events WHERE kind='document.viewed' AND document_id=ANY($1::uuid[])",
        [many],
      )
    ).rows[0].n;
    assert.equal(
      totalAudits,
      201,
      'Only returned hits, not sentinel, are audited',
    );
    const otherCategory = (
      await runtime.query(
        'SELECT category_id FROM fmv.documents WHERE id=$1::uuid',
        [second],
      )
    ).rows[0].category_id;
    assert.deepEqual(await search('capmarker', { categoryId: otherCategory }), {
      documentIds: [],
      truncated: false,
    });
    // Existing saved rows acquire the derived index on additive upgrade.
    const schema = `fmv_search_probe_${randomUUID().replaceAll('-', '')}`;
    await owner.query(`CREATE SCHEMA ${schema}`);
    try {
      await owner.query(
        `CREATE TABLE ${schema}.document_extractions(result jsonb)`,
      );
      await owner.query(
        `INSERT INTO ${schema}.document_extractions(result) VALUES ($1::jsonb)`,
        [JSON.stringify(makeResult(['retained before index']))],
      );
      await owner.query(
        `ALTER TABLE ${schema}.document_extractions ADD COLUMN search_terms text[] GENERATED ALWAYS AS(fmv.extraction_search_terms(result)) STORED`,
      );
      assert.ok(
        (
          await owner.query(
            `SELECT search_terms FROM ${schema}.document_extractions`,
          )
        ).rows[0].search_terms.includes('retained'),
      );
    } finally {
      await owner.query(`DROP SCHEMA ${schema} CASCADE`);
    }
    assert.ok(exportGrant);
  } finally {
    await runtime.end();
    await store.onModuleDestroy();
    await access.onModuleDestroy();
    await people.onModuleDestroy();
  }
}
