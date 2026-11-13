import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Inject,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AuthService } from './auth.service.js';
import { digest, opaque, validOpaque } from './auth.crypto.js';
import { Reflector } from '@nestjs/core';

export const cookieName = (
  secure: boolean,
  kind: 'session' | 'flow' | 'csrf',
) => `${secure ? '__Host-' : ''}fmv_${kind}`;
export function cookie(request: Request, name: string): string | undefined {
  const matches = (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return;
  const value = matches[0]!.slice(name.length + 1);
  return validOpaque(value) ? value : undefined;
}
export function setCookie(
  response: Response,
  secure: boolean,
  kind: 'session' | 'flow' | 'csrf',
  value: string,
  maxAge = 12 * 60 * 60_000,
) {
  response.cookie(cookieName(secure, kind), value, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}
export function clearCookie(
  response: Response,
  secure: boolean,
  kind: 'session' | 'flow',
) {
  response.clearCookie(cookieName(secure, kind), {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
  });
}
export function csrf(request: Request, response: Response, secure: boolean) {
  const value = cookie(request, cookieName(secure, 'csrf')) ?? opaque();
  setCookie(response, secure, 'csrf', value);
  return value;
}

@Injectable()
export class AuthBoundaryGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    if (!this.auth.config) throw new HttpException('Unavailable', 503);
    const isCallback = context.getHandler().name === 'callback';
    if (
      !isCallback &&
      request.headers['sec-fetch-site'] &&
      request.headers['sec-fetch-site'] !== 'same-origin' &&
      request.headers['sec-fetch-site'] !== 'none'
    )
      throw new ForbiddenException();
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (write) {
      if (request.headers.origin !== this.auth.config.origin)
        throw new ForbiddenException();
      const binary =
        this.reflector.get<boolean>(
          'fmv.binaryUpload',
          context.getHandler(),
        ) === true;
      if (!request.is(binary ? 'application/octet-stream' : 'application/json'))
        throw new BadRequestException();
      const header = request.headers['x-csrf-token'];
      const token = cookie(
        request,
        cookieName(this.auth.config.secure, 'csrf'),
      );
      if (
        !validOpaque(header) ||
        !token ||
        !timingSafeEqual(Buffer.from(header), Buffer.from(token))
      )
        throw new ForbiddenException();
    }
    const limited = await this.auth.limit(
      `ip:${write ? 'write' : 'read'}`,
      request.ip ?? 'unknown',
      write ? 30 : 120,
      60_000,
    );
    if (!limited) {
      response.setHeader('Retry-After', '60');
      throw new HttpException('Limited', 429);
    }
    // Limits are authoritative in the database and cannot be bypassed by changing
    // user-agent, forwarded headers or the process serving a request.
    if (request.method === 'POST' && typeof request.body?.email === 'string') {
      const allowed = await this.auth.limit(
        'email',
        digest(request.body.email.trim().toLowerCase()),
        8,
      );
      if (!allowed) {
        response.setHeader('Retry-After', '900');
        throw new HttpException('Limited', 429);
      }
    }
    return true;
  }
}
