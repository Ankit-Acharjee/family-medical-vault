import { AccessStore } from '../../dist/access/access.store.js';
import { config } from './auth-fixture.mjs';

export const actions = ['view', 'upload', 'edit', 'export', 'manage'];
export const ids = {
  owner: '10000000-0000-4000-8000-000000000001',
  caregiver: '10000000-0000-4000-8000-000000000002',
  stranger: '10000000-0000-4000-8000-000000000003',
  patient: '20000000-0000-4000-8000-000000000001',
  otherPatient: '20000000-0000-4000-8000-000000000002',
  unknownPatient: '20000000-0000-4000-8000-000000000003',
  document: '30000000-0000-4000-8000-000000000001',
  sameCategoryDocument: '30000000-0000-4000-8000-000000000002',
  otherCategoryDocument: '30000000-0000-4000-8000-000000000003',
  otherPatientDocument: '30000000-0000-4000-8000-000000000004',
  unknownDocument: '30000000-0000-4000-8000-000000000005',
  category: '50000000-0000-4000-8000-000000000001',
  otherCategory: '50000000-0000-4000-8000-000000000002',
  unknownCategory: '50000000-0000-4000-8000-000000000003',
};
export const principals = {
  owner: { issuer: config.providerUrl, subject: 'owner-subject' },
  caregiver: { issuer: config.providerUrl, subject: 'caregiver-subject' },
  stranger: { issuer: config.providerUrl, subject: 'stranger-subject' },
  unknown: { issuer: config.providerUrl, subject: 'unknown-subject' },
};
const key = ({ issuer, subject }) => JSON.stringify([issuer, subject]);

// Synthetic authoritative-store contract, not a substitute for PostgreSQL tests.
export class MemoryAccess extends AccessStore {
  now = new Date('2030-01-01T00:00:00.000Z');
  accounts = new Map([
    [key(principals.owner), ids.owner],
    [key(principals.caregiver), ids.caregiver],
    [key(principals.stranger), ids.stranger],
  ]);
  people = new Map([
    [
      ids.patient,
      {
        id: ids.patient,
        displayName: 'Private Patient A',
        ownerAccountId: ids.owner,
      },
    ],
    [
      ids.otherPatient,
      {
        id: ids.otherPatient,
        displayName: 'Private Patient B',
        ownerAccountId: ids.stranger,
      },
    ],
  ]);
  grants = [];
  categories = new Set([ids.category, ids.otherCategory]);
  documents = new Map([
    [
      ids.document,
      {
        id: ids.document,
        patientId: ids.patient,
        categoryId: ids.category,
        state: 'ready',
      },
    ],
    [
      ids.sameCategoryDocument,
      {
        id: ids.sameCategoryDocument,
        patientId: ids.patient,
        categoryId: ids.category,
        state: 'ready',
      },
    ],
    [
      ids.otherCategoryDocument,
      {
        id: ids.otherCategoryDocument,
        patientId: ids.patient,
        categoryId: ids.otherCategory,
        state: 'ready',
      },
    ],
    [
      ids.otherPatientDocument,
      {
        id: ids.otherPatientDocument,
        patientId: ids.otherPatient,
        categoryId: ids.category,
        state: 'ready',
      },
    ],
  ]);
  calls = [];
  fail = null;
  serial = 0;

  check(operation, ...args) {
    this.calls.push({ operation, args: globalThis.structuredClone(args) });
    if (this.fail === operation || this.fail === '*')
      throw new Error('synthetic sensitive database failure');
  }
  grant(overrides = {}) {
    const grant = {
      id: `40000000-0000-4000-8000-${String(++this.serial).padStart(12, '0')}`,
      patientId: ids.patient,
      granteeAccountId: ids.caregiver,
      actions: ['view'],
      scope: { kind: 'patient' },
      expiresAt: null,
      revokedAt: null,
      ...overrides,
    };
    this.grants.push(grant);
    return grant;
  }
  async load(principal, patientId) {
    this.check('load', principal, patientId);
    return globalThis.structuredClone({
      accountId: this.accounts.get(key(principal)) ?? null,
      patient: this.people.get(patientId) ?? null,
      grants: this.grants,
      now: this.now,
    });
  }
  async list(principal) {
    this.check('list', principal);
    const accountId = this.accounts.get(key(principal));
    if (!accountId) return [];
    return globalThis.structuredClone(
      [...this.people.values()].flatMap((patient) => {
        const owner = patient.ownerAccountId === accountId;
        const grants = this.grants.filter(
          (grant) =>
            grant.patientId === patient.id &&
            grant.granteeAccountId === accountId &&
            !grant.revokedAt &&
            (!grant.expiresAt || grant.expiresAt > this.now),
        );
        if (!owner && !grants.length) return [];
        return [
          {
            id: patient.id,
            displayName: patient.displayName,
            relationship: owner ? 'self' : 'caregiver',
            capabilities: owner
              ? actions.map((action) => ({
                  action,
                  scope: { kind: 'patient' },
                }))
              : grants.flatMap((grant) =>
                  grant.actions.map((action) => ({
                    action,
                    scope: grant.scope,
                  })),
                ),
          },
        ];
      }),
    );
  }
  async document(documentId) {
    this.check('document', documentId);
    return globalThis.structuredClone(this.documents.get(documentId) ?? null);
  }
  async category(categoryId) {
    this.check('category', categoryId);
    return this.categories.has(categoryId);
  }
}
