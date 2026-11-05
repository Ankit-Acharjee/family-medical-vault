import { randomBytes } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { AuthStore } from '../../dist/auth/auth.store.js';
import { AuthProvider } from '../../dist/auth/supabase.provider.js';
import { AuthService } from '../../dist/auth/auth.service.js';
import { challenge, unseal } from '../../dist/auth/auth.crypto.js';

export const config = {
  origin: 'http://localhost:5173',
  providerUrl: 'https://fixture.supabase.co',
  publicKey: 'sb_publishable_fixture',
  encryptionKey: randomBytes(32),
  databaseUrl: 'unused',
  secure: false,
};
export class MemoryStore extends AuthStore {
  rows = new Map();
  counters = new Map();
  queue = Promise.resolve();
  async insert(row) {
    this.rows.set(row.idHash, globalThis.structuredClone(row));
  }
  async locked(hash, run) {
    const previous = this.queue;
    let release;
    this.queue = new Promise((done) => {
      release = done;
    });
    await previous;
    try {
      return await run(
        globalThis.structuredClone(this.rows.get(hash) ?? null),
        {
          put: async (row) => {
            this.rows.set(row.idHash, globalThis.structuredClone(row));
          },
          remove: async (key) => {
            this.rows.delete(key);
          },
          removeUser: async (user) => {
            for (const [key, row] of this.rows)
              if (row.userId === user) this.rows.delete(key);
          },
        },
      );
    } finally {
      release();
    }
  }
  async limit(id, _until, max) {
    const count = (this.counters.get(id) ?? 0) + 1;
    this.counters.set(id, count);
    return count <= max;
  }
  async take(idHash) {
    return this.locked(idHash, async (row, tx) => {
      await tx.remove(idHash);
      return row;
    });
  }
  async takeUser(idHash) {
    return this.locked(idHash, async (row, tx) => {
      if (!row?.userId || row.expiresAt.getTime() <= Date.now()) return false;
      await tx.removeUser(row.userId);
      return true;
    });
  }
  async close() {}
  async cleanup() {}
}
export class FakeProvider extends AuthProvider {
  tokens = new Map();
  codes = new Map();
  sent = [];
  serial = 0;
  failure = null;
  passwordFailure = null;
  passwordCalls = 0;
  mint(email = 'fixture@example.test', id = 'fixture-user') {
    const n = ++this.serial;
    const session = {
      access_token: `synthetic-access-${n}`,
      refresh_token: `synthetic-refresh-${n}`,
      user: { id, email, email_confirmed_at: '2026-11-05T00:00:00Z' },
    };
    this.tokens.set(session.refresh_token, session);
    return session;
  }
  async login(email) {
    if (this.failure) throw this.failure;
    return this.mint(email);
  }
  async refresh(token) {
    if (this.failure) throw this.failure;
    const previous = this.tokens.get(token);
    if (!previous) throw new UnauthorizedException();
    this.tokens.delete(token);
    await new Promise((r) => globalThis.setTimeout(r, 1));
    return this.mint(previous.user.email, previous.user.id);
  }
  async exchange(code, verifier) {
    if (this.failure) throw this.failure;
    const item = this.codes.get(code);
    if (!item || item.challenge !== challenge(verifier))
      throw new UnauthorizedException();
    this.codes.delete(code);
    return this.mint(item.email);
  }
  async email(kind, email, redirect, challenge) {
    if (this.failure) throw this.failure;
    this.sent.push({ kind, email, redirect, challenge });
  }
  google(redirect, challenge) {
    this.sent.push({
      kind: 'google',
      email: 'fixture@example.test',
      redirect,
      challenge,
    });
    return `https://fixture.supabase.co/auth/v1/authorize?redirect_to=${encodeURIComponent(redirect)}&code_challenge=${challenge}`;
  }
  async logout(access, global) {
    if (this.failure) throw this.failure;
    for (const [key, value] of this.tokens)
      if (global || value.access_token === access) this.tokens.delete(key);
  }
  async password() {
    this.passwordCalls++;
    if (this.passwordFailure) throw this.passwordFailure;
  }
  issue(flow, email = 'fixture@example.test') {
    const code = `synthetic-code-${++this.serial}`;
    this.codes.set(code, { challenge: challenge(flow.verifier), email });
    return code;
  }
}
export function fixture() {
  const store = new MemoryStore();
  const provider = new FakeProvider();
  const auth = new AuthService(config, store, provider);
  return {
    store,
    provider,
    auth,
    decode: (row) => unseal(row.payload, config.encryptionKey, row.idHash),
  };
}
