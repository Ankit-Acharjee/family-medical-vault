import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthConfig } from './auth.config.js';

export type ProviderSession = {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; email_confirmed_at: string };
};
export abstract class AuthProvider {
  abstract login(email: string, password: string): Promise<ProviderSession>;
  abstract refresh(token: string): Promise<ProviderSession>;
  abstract exchange(code: string, verifier: string): Promise<ProviderSession>;
  abstract email(
    kind: 'signup' | 'recover' | 'resend',
    email: string,
    redirect: string,
    challenge: string,
    password?: string,
  ): Promise<void>;
  abstract logout(access: string, global?: boolean): Promise<void>;
  abstract password(access: string, password: string): Promise<void>;
  abstract google(redirect: string, challenge: string): string;
}

// Stateless REST adapter to official GoTrue endpoints. No persisted SDK session,
// administrative key, browser client, or provider error text crosses this boundary.
export class SupabaseProvider extends AuthProvider {
  constructor(
    private readonly config: AuthConfig,
    private readonly request: typeof fetch = fetch,
  ) {
    super();
  }
  private async call(
    path: string,
    body?: unknown,
    access?: string,
    method = 'POST',
  ): Promise<unknown> {
    try {
      const response = await this.request(
        `${this.config.providerUrl}/auth/v1${path}`,
        {
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(8000),
          headers: {
            apikey: this.config.publicKey,
            'Content-Type': 'application/json',
            ...(access ? { Authorization: `Bearer ${access}` } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      );
      if (response.status === 429 || response.status >= 500)
        throw new ServiceUnavailableException();
      if (!response.ok) throw new UnauthorizedException();
      if (response.status === 204) return null;
      return await response.json();
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException();
    }
  }
  private async session(path: string, body: unknown): Promise<ProviderSession> {
    const value = (await this.call(
      path,
      body,
    )) as Partial<ProviderSession> | null;
    if (
      !value?.user ||
      typeof value.user.id !== 'string' ||
      typeof value.user.email !== 'string' ||
      !value.user.email_confirmed_at ||
      typeof value.access_token !== 'string' ||
      typeof value.refresh_token !== 'string'
    )
      throw new UnauthorizedException();
    return {
      access_token: value.access_token,
      refresh_token: value.refresh_token,
      user: {
        id: value.user.id,
        email: value.user.email,
        email_confirmed_at: value.user.email_confirmed_at,
      },
    };
  }
  login(email: string, password: string) {
    return this.session('/token?grant_type=password', { email, password });
  }
  refresh(refresh_token: string) {
    return this.session('/token?grant_type=refresh_token', { refresh_token });
  }
  exchange(auth_code: string, code_verifier: string) {
    return this.session('/token?grant_type=pkce', { auth_code, code_verifier });
  }
  async email(
    kind: 'signup' | 'recover' | 'resend',
    email: string,
    redirect: string,
    codeChallenge: string,
    password?: string,
  ) {
    await this.call(
      `/${kind}?redirect_to=${encodeURIComponent(redirect)}`,
      kind === 'resend'
        ? {
            email,
            type: 'signup',
            code_challenge: codeChallenge,
            code_challenge_method: 's256',
          }
        : {
            email,
            ...(password ? { password } : {}),
            code_challenge: codeChallenge,
            code_challenge_method: 's256',
          },
    );
  }
  async logout(access: string, global = false) {
    await this.call(
      `/logout?scope=${global ? 'global' : 'local'}`,
      undefined,
      access,
    );
  }
  async password(access: string, password: string) {
    await this.call('/user', { password }, access, 'PUT');
  }
  google(redirect: string, codeChallenge: string) {
    const url = new URL(`${this.config.providerUrl}/auth/v1/authorize`);
    url.search = new URLSearchParams({
      provider: 'google',
      redirect_to: redirect,
      code_challenge: codeChallenge,
      code_challenge_method: 's256',
    }).toString();
    return url.href;
  }
}
