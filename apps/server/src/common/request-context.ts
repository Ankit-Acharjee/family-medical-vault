import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContext extends Request {
  requestId: string;
}

export interface RequestEvent {
  event: 'http_request';
  requestId: string;
  method: string;
  status: number;
  durationMs: number;
}

export type RequestLog = (event: RequestEvent) => void;

export function requestContext(log: RequestLog) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const requestId = randomUUID();
    const started = performance.now();
    (request as RequestContext).requestId = requestId;
    response.setHeader('X-Request-ID', requestId);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.on('finish', () => {
      log({
        event: 'http_request',
        requestId,
        method: [
          'GET',
          'POST',
          'PUT',
          'PATCH',
          'DELETE',
          'OPTIONS',
          'HEAD',
        ].includes(request.method)
          ? request.method
          : 'OTHER',
        status: response.statusCode,
        durationMs: Math.round(performance.now() - started),
      });
    });
    next();
  };
}
