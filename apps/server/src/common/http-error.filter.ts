import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import type { RequestContext } from './request-context.js';

const errors: Record<number, [string, string]> = {
  400: ['BAD_REQUEST', 'The request is invalid.'],
  401: ['UNAUTHORIZED', 'Authentication is required.'],
  403: ['FORBIDDEN', 'This operation is not permitted.'],
  404: ['NOT_FOUND', 'The requested resource is unavailable.'],
  409: ['CONFLICT', 'The request conflicts with the current state.'],
  413: ['PAYLOAD_TOO_LARGE', 'The request is too large.'],
  415: ['UNSUPPORTED_MEDIA_TYPE', 'The request format is unsupported.'],
  429: ['TOO_MANY_REQUESTS', 'Too many requests. Try again later.'],
};

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestContext>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const [code, message] =
      errors[status] ??
      (status >= 500
        ? ['INTERNAL_ERROR', 'The request could not be completed.']
        : ['REQUEST_FAILED', 'The request could not be accepted.']);
    response
      .status(status)
      .json({ error: { code, message }, requestId: request.requestId });
  }
}
