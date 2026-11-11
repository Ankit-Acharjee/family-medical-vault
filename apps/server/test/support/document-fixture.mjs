import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createApplication } from '../../dist/application.js';
import { PermissionService } from '../../dist/access/permission.service.js';
import { DocumentStore } from '../../dist/documents/document.store.js';
import { DocumentsService } from '../../dist/documents/documents.service.js';
import { MemoryObjectStore } from '../../dist/documents/memory-object-store.js';
import { fixture, config } from './auth-fixture.mjs';
import { MemoryAccess, ids, principals } from './access-fixture.mjs';

export { ids, principals };
export const pdf = Buffer.from('%PDF-1.7\nPrivate synthetic original\n%%EOF\n');
const clone = (value) => globalThis.structuredClone(value);

// All state is synthetic. Locks model the adapter contract, not PostgreSQL proof.
export class MemoryDocuments extends DocumentStore {
  rows = new Map();
  locks = new Map();
  events = [];
  fail = null;
  categoryRows = [
    { id: ids.category, name: 'Unclassified' },
    { id: ids.otherCategory, name: 'Other synthetic category' },
  ];
  constructor(access) {
    super();
    this.access = access;
    access.documents.clear();
  }
  check(operation) {
    if (this.fail === operation)
      throw new Error('synthetic sensitive metadata failure');
  }
  find(patientId, predicate) {
    const row = [...this.rows.values()].find(
      (record) => record.patientId === patientId && predicate(record),
    );
    return row ? clone(row) : null;
  }
  sync(record) {
    this.access.documents.set(record.documentId, {
      id: record.documentId,
      patientId: record.patientId,
      categoryId: record.categoryId,
      state: record.state,
    });
  }
  asActor(accountId) {
    return {
      withLock: async (key, work) => {
        const previous = this.locks.get(key) ?? Promise.resolve();
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        const tail = previous.then(() => gate);
        this.locks.set(key, tail);
        await previous;
        try {
          this.check('lock');
          return await work({
            resolveCategory: async (id = ids.category) =>
              this.categoryRows.some((category) => category.id === id)
                ? id
                : null,
            findByIdempotency: async (patientId, key) =>
              this.find(patientId, (record) => record.idempotencyKey === key),
            findUpload: async (patientId, uploadId) =>
              this.find(patientId, (record) => record.uploadId === uploadId),
            findDocument: async (patientId, documentId) =>
              this.find(
                patientId,
                (record) => record.documentId === documentId,
              ),
            create: async (record) => {
              this.check('create');
              if (
                this.find(
                  record.patientId,
                  (row) => row.idempotencyKey === record.idempotencyKey,
                )
              )
                throw new Error('synthetic uniqueness conflict');
              this.rows.set(record.uploadId, clone(record));
              this.sync(record);
            },
            setState: async (uploadId, state) => {
              this.check('state');
              const record = this.rows.get(uploadId);
              if (!record) throw new Error('synthetic unknown upload');
              if (state === 'ready' && record.state !== 'ready')
                this.events.push({
                  kind: 'document.uploaded',
                  patientId: record.patientId,
                  documentId: record.documentId,
                  accountId,
                });
              record.state = state;
              this.sync(record);
            },
          });
        } finally {
          release();
          if (this.locks.get(key) === tail) this.locks.delete(key);
        }
      },
    };
  }
  async list(patientId) {
    this.check('list');
    return clone(
      [...this.rows.values()].filter(
        (record) => record.patientId === patientId && record.state === 'ready',
      ),
    );
  }
  async categories() {
    this.check('categories');
    return clone(this.categoryRows);
  }
  async audit(patientId, documentId, accountId, kind) {
    this.check('audit');
    this.events.push({ patientId, documentId, accountId, kind });
  }
}

export class TrackedObjects extends MemoryObjectStore {
  puts = [];
  gets = [];
  removes = [];
  onGet;
  failPut = false;
  async put(key, bytes, mime) {
    this.puts.push(key);
    await super.put(key, bytes, mime);
    if (this.failPut) throw new Error('synthetic sensitive object failure');
  }
  async get(key) {
    this.gets.push(key);
    const bytes = await super.get(key);
    await this.onGet?.();
    return bytes;
  }
  async remove(key) {
    this.removes.push(key);
    await super.remove(key);
  }
}

export async function documentSetup(run, objects = new TrackedObjects()) {
  const f = fixture();
  const access = new MemoryAccess();
  const metadata = new MemoryDocuments(access);
  const documents = new DocumentsService(
    new PermissionService(access),
    metadata,
    objects,
  );
  const logs = [];
  const { app } = await createApplication({
    auth: f.auth,
    access,
    documents,
    docs: false,
    log: (event) => logs.push(event),
  });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const csrf = 'c'.repeat(43);
  const path = (suffix, patientId = ids.patient) =>
    `/api/patients/${patientId}/${suffix}`;
  const request = (method, url, session, body, extra = {}) => {
    const headers = Object.fromEntries(
      Object.entries({
        Cookie: `fmv_csrf=${csrf}${session ? `; fmv_session=${session}` : ''}`,
        Origin: config.origin,
        'Content-Type': Buffer.isBuffer(body)
          ? 'application/octet-stream'
          : 'application/json',
        'X-CSRF-Token': csrf,
        ...extra,
      }).filter(([, value]) => value !== undefined),
    );
    return globalThis.fetch(`${base}${url}`, {
      method,
      headers,
      ...(body === undefined
        ? {}
        : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
    });
  };
  const login = async (subject = principals.owner.subject) => {
    f.provider.login = async (email) => f.provider.mint(email, subject);
    return f.auth.login('synthetic-documents@example.test', 'synthetic');
  };
  const input = (extra = {}) => ({
    title: 'Private synthetic original.pdf',
    mimeType: 'application/pdf',
    bytes: pdf.length,
    sha256: createHash('sha256').update(pdf).digest('hex'),
    idempotencyKey: randomUUID(),
    ...extra,
  });
  try {
    await run({
      ...f,
      access,
      metadata,
      objects,
      documents,
      logs,
      path,
      request,
      login,
      input,
    });
  } finally {
    await app.close();
  }
}
