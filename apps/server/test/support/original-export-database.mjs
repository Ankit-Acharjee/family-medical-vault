import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { OriginalExportService } from '../../dist/documents/original-export.service.js';
export async function verifyOriginalExport(f) {
  const {
    runtimeUrl,
    runtime,
    owner,
    principal,
    reader,
    patient,
    id,
    service,
    insertGrant,
    ownerAccountId,
    readerAccountId,
  } = f;
  const exporter = new OriginalExportService(runtimeUrl.href, service),
    status = (n) => (e) => e.getStatus?.() === n,
    signal = () => new globalThis.AbortController().signal;
  let grant;
  const prior = (
    await owner.query(
      'SELECT id FROM fmv.access_grants WHERE patient_id=$1::uuid AND grantee_account_id=$2::uuid AND revoked_at IS NULL',
      [patient.id, readerAccountId],
    )
  ).rows;
  await owner.query(
    'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=ANY($1::uuid[])',
    [prior.map((r) => r.id)],
  );
  const prepare = (actor) =>
    exporter.prepare(actor, patient.id, { documentIds: [id] });
  const body = (preview) => ({
    documentIds: [id],
    requestId: randomUUID(),
    confirmed: true,
    format: 'zip',
    snapshotSha256: preview.snapshotSha256,
  });
  try {
    await assert.rejects(prepare(reader), status(404));
    grant = await insertGrant(
      runtime,
      {
        patientId: patient.id,
        caregiverAccountId: readerAccountId,
        ownerAccountId,
      },
      { actions: ['export'], scopeKind: 'document', documentId: id },
    );
    await assert.rejects(
      service.read(reader, patient.id, id, 'view'),
      status(404),
    );
    const preview = await prepare(reader);
    assert.equal(preview.files.length, 1);
    const result = await exporter.export(
      reader,
      patient.id,
      body(preview),
      signal(),
    );
    assert.equal(result.bytes.readUInt32LE(0), 0x04034b50);
    await assert.rejects(
      exporter.prepare(reader, patient.id, { documentIds: [id, randomUUID()] }),
      status(404),
    );
    await assert.rejects(
      exporter.prepare(reader, randomUUID(), { documentIds: [id] }),
      status(404),
    );
    await assert.rejects(
      exporter.export(
        reader,
        patient.id,
        { ...body(preview), snapshotSha256: '0'.repeat(64) },
        signal(),
      ),
      status(409),
    );
    const originalArchive = exporter.archive;
    exporter.archive = async (...args) => {
      await owner.query(
        "UPDATE fmv.documents SET display_title='SYNTHETIC concurrent rename' WHERE id=$1::uuid",
        [id],
      );
      return originalArchive(...args);
    };
    const previous = (
      await owner.query(
        'SELECT display_title FROM fmv.documents WHERE id=$1::uuid',
        [id],
      )
    ).rows[0].display_title;
    try {
      await assert.rejects(
        exporter.export(reader, patient.id, body(preview), signal()),
        status(409),
      );
    } finally {
      exporter.archive = originalArchive;
      await owner.query(
        'UPDATE fmv.documents SET display_title=$2 WHERE id=$1::uuid',
        [id, previous],
      );
    }
    await owner.query(
      "CREATE FUNCTION fmv.synthetic_original_export_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='document.exported' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$",
    );
    await owner.query(
      'CREATE TRIGGER synthetic_original_export_failure BEFORE INSERT ON fmv.document_events FOR EACH ROW EXECUTE FUNCTION fmv.synthetic_original_export_failure()',
    );
    try {
      await assert.rejects(
        exporter.export(
          reader,
          patient.id,
          body(await prepare(reader)),
          signal(),
        ),
        status(503),
      );
    } finally {
      await owner.query(
        'DROP TRIGGER synthetic_original_export_failure ON fmv.document_events',
      );
      await owner.query(
        'DROP FUNCTION fmv.synthetic_original_export_failure()',
      );
    }
    const currentPreview = await prepare(reader);
    exporter.archive = async (...args) => {
      await owner.query(
        'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1::uuid',
        [grant.id ?? grant],
      );
      return originalArchive(...args);
    };
    try {
      await assert.rejects(
        exporter.export(reader, patient.id, body(currentPreview), signal()),
        status(404),
      );
    } finally {
      exporter.archive = originalArchive;
      await owner.query(
        'UPDATE fmv.access_grants SET revoked_at=NULL WHERE id=$1::uuid',
        [grant.id ?? grant],
      );
    }
    const originalDocuments = exporter.documents;
    exporter.documents = {
      read: async (...args) => {
        const file = await originalDocuments.read(...args);
        return { ...file, bytes: file.bytes.subarray(1) };
      },
    };
    try {
      await assert.rejects(
        exporter.export(
          principal,
          patient.id,
          body(await prepare(principal)),
          signal(),
        ),
        status(409),
      );
    } finally {
      exporter.documents = originalDocuments;
    }
    let entered, release;
    const started = new Promise((resolve) => (entered = resolve)),
      gate = new Promise((resolve) => (release = resolve));
    exporter.archive = async (...args) => {
      entered();
      await gate;
      return originalArchive(...args);
    };
    const ownerPreview = await prepare(principal),
      first = exporter.export(
        principal,
        patient.id,
        body(ownerPreview),
        signal(),
      );
    try {
      await started;
      await assert.rejects(
        exporter.export(principal, patient.id, body(ownerPreview), signal()),
        status(503),
      );
    } finally {
      release();
      await first;
      exporter.archive = originalArchive;
    }
    const cancelled = new globalThis.AbortController();
    cancelled.abort();
    await assert.rejects(
      exporter.export(
        principal,
        patient.id,
        body(await prepare(principal)),
        cancelled.signal,
      ),
      status(503),
    );
    const stale = await prepare(reader);
    await owner.query(
      'UPDATE fmv.access_grants SET revoked_at=clock_timestamp() WHERE id=$1::uuid',
      [grant.id ?? grant],
    );
    await assert.rejects(
      exporter.export(reader, patient.id, body(stale), signal()),
      status(404),
    );
    assert.equal(
      (
        await exporter.export(
          principal,
          patient.id,
          body(await prepare(principal)),
          signal(),
        )
      ).bytes.readUInt32LE(0),
      0x04034b50,
    );
  } finally {
    if (grant)
      await owner.query(
        'UPDATE fmv.access_grants SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1::uuid',
        [grant.id ?? grant],
      );
    await owner.query(
      'UPDATE fmv.access_grants SET revoked_at=NULL WHERE id=ANY($1::uuid[])',
      [prior.map((r) => r.id)],
    );
    await exporter.onModuleDestroy();
  }
}
