import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import type { AuthConfig } from './auth.config.js';
import {
  challenge,
  digest,
  opaque,
  seal,
  unseal,
  validOpaque,
} from './auth.crypto.js';
import { AuthStore } from './auth.store.js';
import type { SessionTransaction, StoredSession } from './auth.store.js';
import { AuthProvider } from './supabase.provider.js';
import type { ProviderSession } from './supabase.provider.js';
import { createHmac } from 'node:crypto';

type FlowKind = 'signup' | 'recover' | 'google';
type Flow = { kind: FlowKind; verifier: string; state: string; email?: string };
type LoginSession = {
  kind: 'account' | 'recovery';
  provider: ProviderSession;
  until: number;
  idleUntil: number;
};
type Outcome<T> = { value: T; error?: never } | { error: Error; value?: never };
const IDLE = 30 * 60_000;
const ABSOLUTE = 12 * 60 * 60_000;
const FLOW = 30 * 60_000;

@Injectable()
export class AuthService implements OnModuleDestroy {
  readonly config: AuthConfig | null;
  private readonly cleanupTimer: NodeJS.Timeout | undefined;
  constructor(
    config: AuthConfig | null,
    private readonly store: AuthStore | null,
    private readonly provider: AuthProvider | null,
  ) {
    this.config = config;
    if (store) {
      this.cleanupTimer = setInterval(() => {
        void store.cleanup().catch(() => {
          /* No connection details in logs; expiry is enforced on every request. */
        });
      }, 60_000);
      this.cleanupTimer.unref();
    }
  }
  private ready() {
    if (!this.config || !this.store || !this.provider)
      throw new ServiceUnavailableException();
    return { config: this.config, store: this.store, provider: this.provider };
  }
  async onModuleDestroy() {
    clearInterval(this.cleanupTimer);
    await this.store?.close();
  }
  private record(
    id: string,
    payload: Flow | LoginSession,
    expiresAt: number,
  ): StoredSession {
    const { config } = this.ready();
    const idHash = digest(id);
    return {
      idHash,
      userId: 'provider' in payload ? payload.provider.user.id : null,
      payload: seal(payload, config.encryptionKey, idHash),
      expiresAt: new Date(expiresAt),
    };
  }
  async limit(
    scope: string,
    subject: string,
    maximum: number,
    period = 15 * 60_000,
  ) {
    const { store } = this.ready();
    const bucket = Math.floor(Date.now() / period);
    return store.limit(
      digest(`${scope}:${subject}:${bucket}`),
      new Date((bucket + 1) * period),
      maximum,
    );
  }
  async discard(id: string | undefined) {
    if (!validOpaque(id)) return;
    const { store } = this.ready();
    await store.locked(digest(id), async (_, tx) => tx.remove(digest(id)));
  }
  async login(email: string, password: string, previous?: string) {
    const { provider, store } = this.ready();
    const session = await provider.login(email, password);
    await this.discard(previous);
    const id = opaque();
    const now = Date.now();
    await store.insert(
      this.record(
        id,
        {
          kind: 'account',
          provider: session,
          until: now + ABSOLUTE,
          idleUntil: now + IDLE,
        },
        now + ABSOLUTE,
      ),
    );
    return id;
  }
  async begin(
    kind: FlowKind,
    email = '',
    password?: string,
    previous?: string,
  ) {
    const { config, store, provider } = this.ready();
    await this.discard(previous);
    const id = opaque();
    const flow: Flow = {
      kind,
      verifier: opaque(),
      state: opaque(),
      ...(email ? { email } : {}),
    };
    await store.insert(this.record(id, flow, Date.now() + FLOW));
    const redirect = `${config.origin}/api/auth/callback?state=${flow.state}`;
    if (kind === 'google')
      return { id, url: provider.google(redirect, challenge(flow.verifier)) };
    try {
      await provider.email(
        kind,
        email,
        redirect,
        challenge(flow.verifier),
        password,
      );
    } catch (error) {
      // Account-existence/verification/provider validation differences are hidden.
      if (!(error instanceof UnauthorizedException)) {
        await this.discard(id);
        throw error;
      }
    }
    return { id };
  }
  async resend(id: string | undefined, email: string) {
    const { config, store, provider } = this.ready();
    if (!validOpaque(id)) return;
    const result = await store.locked(
      digest(id),
      async (record): Promise<Outcome<void>> => {
        if (!record || record.expiresAt.getTime() <= Date.now())
          return { value: undefined };
        let flow: Flow;
        try {
          flow = unseal<Flow>(
            record.payload,
            config.encryptionKey,
            record.idHash,
          );
        } catch {
          return { value: undefined };
        }
        if (flow.kind !== 'signup' || flow.email !== email)
          return { value: undefined };
        try {
          await provider.email(
            'resend',
            email,
            `${config.origin}/api/auth/callback?state=${flow.state}`,
            challenge(flow.verifier),
          );
        } catch (error) {
          if (!(error instanceof UnauthorizedException))
            return { error: new ServiceUnavailableException() };
        }
        return { value: undefined };
      },
    );
    if (result.error) throw result.error;
  }
  async callback(
    id: string | undefined,
    code: unknown,
    state: unknown,
    previous?: string,
  ) {
    const { config, store, provider } = this.ready();
    if (
      !validOpaque(id) ||
      !validOpaque(state) ||
      typeof code !== 'string' ||
      code.length < 1 ||
      code.length > 2048
    )
      throw new UnauthorizedException();
    // Validate state before consuming; commit the one-time flow deletion before
    // calling the provider, so DB rollback cannot resurrect an exchanged flow.
    const outcome = await store.locked(
      digest(id),
      async (record, tx): Promise<Outcome<Flow>> => {
        if (!record || record.expiresAt.getTime() <= Date.now())
          return { error: new UnauthorizedException() };
        let flow: Flow;
        try {
          flow = unseal<Flow>(
            record.payload,
            config.encryptionKey,
            record.idHash,
          );
        } catch {
          await tx.remove(record.idHash);
          return { error: new UnauthorizedException() };
        }
        if (
          !['signup', 'recover', 'google'].includes(flow.kind) ||
          flow.state !== state
        )
          return { error: new UnauthorizedException() };
        await tx.remove(record.idHash);
        return { value: flow };
      },
    );
    if (outcome.error) throw outcome.error;
    const flow = outcome.value;
    const session = await provider.exchange(code, flow.verifier);
    if (flow.email && session.user.email.toLowerCase() !== flow.email)
      throw new UnauthorizedException();
    await this.discard(previous);
    const next = opaque();
    const now = Date.now();
    const recovery = flow.kind === 'recover';
    const until = now + (recovery ? 10 * 60_000 : ABSOLUTE);
    await store.insert(
      this.record(
        next,
        {
          kind: recovery ? 'recovery' : 'account',
          provider: session,
          until,
          idleUntil: now + IDLE,
        },
        until,
      ),
    );
    return { id: next, recovery };
  }
  private async session<T>(
    id: string | undefined,
    kind: LoginSession['kind'],
    work: (
      session: LoginSession,
      tx: SessionTransaction,
      hash: string,
    ) => Promise<T>,
  ) {
    const { config, store, provider } = this.ready();
    if (!validOpaque(id)) throw new UnauthorizedException();
    const result = await store.locked(
      digest(id),
      async (record, tx): Promise<Outcome<T>> => {
        if (!record) return { error: new UnauthorizedException() };
        let session: LoginSession;
        try {
          session = unseal<LoginSession>(
            record.payload,
            config.encryptionKey,
            record.idHash,
          );
        } catch {
          await tx.remove(record.idHash);
          return { error: new UnauthorizedException() };
        }
        if (session.kind !== kind) return { error: new ForbiddenException() };
        if (
          record.expiresAt.getTime() <= Date.now() ||
          session.until <= Date.now() ||
          session.idleUntil <= Date.now()
        ) {
          await tx.remove(record.idHash);
          return { error: new UnauthorizedException() };
        }
        try {
          // Serialize refresh under a database row lock across all API processes.
          // Refresh checks the provider session and ban status, not just JWT expiry.
          const refreshed = await provider.refresh(
            session.provider.refresh_token,
          );
          if (refreshed.user.id !== session.provider.user.id)
            throw new UnauthorizedException();
          session.provider = refreshed;
          // Account/recovery probes verify liveness without extending inactivity.
          // Future protected business operations must explicitly record activity.
          await tx.put(this.record(id, session, session.until));
          return { value: await work(session, tx, record.idHash) };
        } catch (error) {
          // A timeout could have rotated the refresh token. Require a fresh login
          // rather than reusing an uncertain token after an interrupted operation.
          await tx.remove(record.idHash);
          return {
            error:
              error instanceof UnauthorizedException ||
              error instanceof ForbiddenException
                ? error
                : new ServiceUnavailableException(),
          };
        }
      },
    );
    if (result.error) throw result.error;
    return result.value;
  }
  account(id: string | undefined) {
    return this.session(id, 'account', async (session, _tx, binding) => ({
      email: session.provider.user.email,
      // Non-authorizing UI identity; changes on login/session replacement and
      // cannot reveal a provider subject, session cookie or reusable token.
      contextId: createHmac('sha256', this.config!.encryptionKey)
        .update(`ui-context\0${binding}\0${session.provider.user.id}`)
        .digest('base64url'),
    }));
  }
  // Internal account linkage uses the provider's stable subject, never email.
  principal(id: string | undefined, activity = false) {
    return this.session(id, 'account', async (session, tx) => {
      if (activity) {
        session.idleUntil = Math.min(session.until, Date.now() + IDLE);
        await tx.put(this.record(id!, session, session.until));
      }
      return {
        issuer: this.config!.providerUrl,
        subject: session.provider.user.id,
      };
    });
  }
  recovery(id: string | undefined) {
    return this.session(id, 'recovery', async () => true);
  }
  async reset(id: string | undefined, password: string) {
    const { provider, store } = this.ready();
    const session = await this.session(
      id,
      'recovery',
      async (current) => current,
    );
    // Commit invalidation BEFORE any password change or logout request. If this
    // fails, no provider side effect occurs; if the provider times out afterwards,
    // all prior app cookies and this recovery have already been invalidated.
    if (!(await store.takeUser(digest(id!)))) throw new UnauthorizedException();
    await provider.password(session.provider.access_token, password);
    try {
      await provider.logout(session.provider.access_token, true);
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
    }
  }
  async logout(id: string | undefined) {
    const { config, store, provider } = this.ready();
    if (!validOpaque(id)) return;
    const record = await store.take(digest(id));
    if (!record) return;
    let session: LoginSession;
    try {
      session = unseal<LoginSession>(
        record.payload,
        config.encryptionKey,
        record.idHash,
      );
    } catch {
      return;
    }
    if (!session.provider) return;
    try {
      await provider.logout(session.provider.access_token);
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
    }
  }
}
