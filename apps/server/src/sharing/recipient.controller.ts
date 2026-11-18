import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthBoundaryGuard } from '../auth/auth.http.js';
import { TemporaryLinksService } from './temporary-links.service.js';
import { validOpaque } from '../auth/auth.crypto.js';
function request(body: unknown, original = false) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== (original ? 2 : 1) ||
    !('token' in body) ||
    !validOpaque(body.token) ||
    (original &&
      (!('documentId' in body) || typeof body.documentId !== 'string'))
  )
    throw new BadRequestException();
  return body as { token: string; documentId: string };
}
// Same-origin/CSRF and authoritative database IP limits, without an account principal.
// The secret capability is mandatory for each request; cookies never confer source access.
@Controller('api/sharing')
@UseGuards(AuthBoundaryGuard)
export class RecipientController {
  constructor(private readonly links: TemporaryLinksService) {}
  @Post('open') @HttpCode(200) open(@Body() body: unknown) {
    return this.links.inspect(request(body).token);
  }
  @Post('original') @HttpCode(200) async original(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ) {
    const input = request(body, true),
      abort = new AbortController(),
      cancel = () => abort.abort(),
      closed = () => {
        if (!res.writableEnded) cancel();
      },
      timer = setTimeout(cancel, 45000);
    req.once('aborted', cancel);
    res.once('close', closed);
    try {
      const result = await this.links.readOriginal(
        input.token,
        input.documentId,
        abort.signal,
      );
      abort.signal.throwIfAborted();
      const extension = {
        'application/pdf': 'pdf',
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
      }[result.mimeType];
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="shared-original.${extension}"`,
      );
      res.setHeader(
        'Content-Security-Policy',
        "sandbox; default-src 'none'; frame-ancestors 'none'",
      );
      res.send(result.bytes);
    } finally {
      clearTimeout(timer);
      req.removeListener('aborted', cancel);
      res.removeListener('close', closed);
    }
  }
}
